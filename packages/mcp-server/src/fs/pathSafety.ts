// The security boundary. `@pennivo/core` deliberately ships no path-traversal
// guard (it's a pure data layer), so every filesystem-touching tool MUST funnel
// its incoming path through `resolveInWorkspace` before doing anything. This is
// the single most test-critical module in the package.

import path from "node:path";
import { realpathSync } from "node:fs";
import { normalizeAbsolutePath } from "@pennivo/core";

export type WorkspacePathErrorCode = "OUTSIDE_WORKSPACE" | "INVALID_PATH";

export class WorkspacePathError extends Error {
  constructor(
    public readonly code: WorkspacePathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export interface ResolveOptions {
  /**
   * For write/create paths whose target may not exist yet: also validate the
   * nearest existing ancestor's realpath so a symlinked parent can't smuggle
   * a write outside the workspace.
   */
  followSymlinks?: boolean;
}

function assertInsideRoot(root: string, candidate: string): void {
  let nRoot = normalizeAbsolutePath(root);
  let nCandidate = normalizeAbsolutePath(candidate);
  // Windows filesystems are case-insensitive, and realpath can return a
  // different case than the user typed. Fold case there so we don't reject a
  // legitimately-inside path; case-folding only ever widens containment within
  // the same root, never lets an escape through.
  if (process.platform === "win32") {
    nRoot = nRoot.toLowerCase();
    nCandidate = nCandidate.toLowerCase();
  }
  if (nCandidate === nRoot) return;
  // Both are forward-slash normalized, so posix.relative is the right tool
  // on every OS. A leading ".." (or an absolute result, which happens across
  // Windows drive letters) means the candidate escaped the root.
  const rel = path.posix.relative(nRoot, nCandidate);
  if (rel === "") return;
  if (rel === ".." || rel.startsWith("../") || path.posix.isAbsolute(rel)) {
    // Deliberately do NOT echo the resolved absolute path — that would reveal
    // the workspace's location on disk to the calling agent.
    throw new WorkspacePathError(
      "OUTSIDE_WORKSPACE",
      "Path is outside the workspace.",
    );
  }
}

function safeRealpath(target: string): string | null {
  try {
    return realpathSync.native(target);
  } catch {
    return null;
  }
}

/**
 * Resolve `input` (relative to `root`, or absolute) to an absolute path that is
 * provably inside `root`, or throw `WorkspacePathError`. Containment is checked
 * twice: once on the lexical path, and again on the realpath of the target (or
 * its nearest existing ancestor) so an in-workspace symlink pointing OUT is
 * rejected. Fails closed.
 */
export function resolveInWorkspace(
  root: string,
  input: string,
  opts: ResolveOptions = {},
): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new WorkspacePathError(
      "INVALID_PATH",
      "Path must be a non-empty string",
    );
  }
  if (input.includes("\0")) {
    throw new WorkspacePathError("INVALID_PATH", "Path contains a null byte");
  }

  const resolved = path.isAbsolute(input)
    ? path.resolve(input)
    : path.resolve(root, input);

  // 1. Lexical containment (cheap, always).
  assertInsideRoot(root, resolved);

  // 2. Realpath containment (catches symlink escapes).
  const real = safeRealpath(resolved);
  if (real) {
    assertInsideRoot(root, real);
  } else if (opts.followSymlinks) {
    const parentReal = safeRealpath(path.dirname(resolved));
    if (parentReal) {
      assertInsideRoot(root, parentReal);
    }
  }

  return resolved;
}

/**
 * Express `absolute` as a path relative to `root` (forward slashes, never
 * absolute). Used for every agent-facing path and every audit entry.
 */
export function toWorkspaceRelative(root: string, absolute: string): string {
  const rel = path.posix.relative(
    normalizeAbsolutePath(root),
    normalizeAbsolutePath(absolute),
  );
  return rel === "" ? "." : rel;
}
