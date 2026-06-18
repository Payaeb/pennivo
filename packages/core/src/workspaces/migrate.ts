// Defaults + migration helpers for the multiple-workspaces feature (Phase 1).
//
// Pure: no DOM, React, Electron, or Node.js imports. The host injects an id
// generator so this module stays deterministic and dependency-free.
//
// Migration is idempotent and non-destructive: re-running it on already
// migrated state returns that state unchanged, and the legacy single-folder
// path is lifted into one workspace seeded from the old global settings keys.

import type { Workspace, WorkspacePrefs, WorkspacesState } from "./types";

/** The default sidebar sort key, mirroring `DEFAULT_SORT` in the UI package. */
const DEFAULT_SORT_KEY = "name-asc";

/** Fresh per-workspace preferences with no open file and an empty timestamp map. */
export function defaultWorkspacePrefs(): WorkspacePrefs {
  return {
    lastOpenFile: null,
    sortKey: DEFAULT_SORT_KEY,
    fileOpenTimestamps: {},
  };
}

/**
 * Derive a workspace display name from its root path. Handles both `/` and
 * `\` separators and trailing slashes. Falls back to the full path, then to
 * `"Workspace"` when the input is empty.
 */
export function workspaceNameFromPath(rootPath: string): string {
  if (!rootPath) return "Workspace";
  // Strip any trailing separators, then take the last path segment.
  const trimmed = rootPath.replace(/[/\\]+$/, "");
  if (!trimmed) return "Workspace";
  const segments = trimmed.split(/[/\\]+/);
  const last = segments[segments.length - 1];
  if (last && last.length > 0) return last;
  return trimmed || rootPath || "Workspace";
}

/** Normalize a path the way App.tsx does: backslashes to slashes, lowercased. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Find the workspace whose `rootPath` is the longest path-segment prefix of
 * `absPath`. Comparison is normalized (backslashes to slashes, lowercased).
 *
 * The match must align on a segment boundary, so root `/foo/ba` does not match
 * `/foo/bar`. A root equal to `absPath` itself counts as a match. When roots
 * nest, the longest matching root wins.
 *
 * Returns null when no workspace contains `absPath`.
 */
export function findWorkspaceForPath(
  state: WorkspacesState,
  absPath: string,
): Workspace | null {
  const target = normalizePath(absPath);
  let best: Workspace | null = null;
  let bestLength = -1;

  for (const ws of state.workspaces) {
    // Normalize the root and drop any trailing slash so the boundary check is
    // consistent regardless of how the root was stored.
    const root = normalizePath(ws.rootPath).replace(/\/+$/, "");
    if (root.length === 0) continue;

    const isExact = target === root;
    const isPrefix =
      target.length > root.length && target.startsWith(root + "/");

    if ((isExact || isPrefix) && root.length > bestLength) {
      best = ws;
      bestLength = root.length;
    }
  }

  return best;
}

/**
 * Decide whether a path belongs to the active workspace. Used by the trash
 * render-side filter (Phase 5) so both the sidebar count badge and the trash
 * list agree on what "this workspace's trash" means.
 *
 * A path belongs to the active workspace when the longest-prefix workspace that
 * contains it (see {@link findWorkspaceForPath}) is the active one. Returns
 * false when there is no active workspace, when no workspace contains the path,
 * or when the containing workspace is a different one.
 */
export function trashEntryInWorkspace(
  workspaces: Workspace[],
  activeWorkspaceId: string | null,
  absPath: string,
): boolean {
  if (!activeWorkspaceId) return false;
  const owner = findWorkspaceForPath(
    { workspaces, activeWorkspaceId, prefs: {} },
    absPath,
  );
  return owner?.id === activeWorkspaceId;
}

/** A `WorkspacesState` is well-formed when its three core fields are present. */
function isWellFormedState(value: unknown): value is WorkspacesState {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.workspaces) &&
    typeof v.prefs === "object" &&
    v.prefs !== null &&
    "activeWorkspaceId" in v
  );
}

/**
 * Migrate raw persisted settings into a `WorkspacesState`. Idempotent and
 * non-destructive:
 *
 * - If `rawSettings.workspaces` is already a well-formed state, return it as-is.
 * - Else if `legacySidebarFolder` is a non-empty string, create one workspace
 *   for it and seed its prefs from the legacy global keys (`sidebarSort`,
 *   `fileOpenTimestamps`).
 * - Else return an empty state.
 *
 * `generateId` is injected so core stays pure and tests stay deterministic.
 */
export function migrateWorkspaces(
  rawSettings: Record<string, unknown>,
  legacySidebarFolder: string | null,
  generateId: () => string,
): WorkspacesState {
  // Already migrated: pass the well-formed state through untouched.
  const existing = rawSettings.workspaces;
  if (isWellFormedState(existing)) {
    return existing;
  }

  // Legacy single-folder path: lift the open folder into one workspace and
  // seed its prefs from the old global settings keys.
  if (typeof legacySidebarFolder === "string" && legacySidebarFolder.length > 0) {
    const id = generateId();
    const workspace: Workspace = {
      id,
      name: workspaceNameFromPath(legacySidebarFolder),
      rootPath: legacySidebarFolder,
    };

    const sortKey =
      typeof rawSettings.sidebarSort === "string"
        ? rawSettings.sidebarSort
        : DEFAULT_SORT_KEY;

    const fileOpenTimestamps =
      rawSettings.fileOpenTimestamps &&
      typeof rawSettings.fileOpenTimestamps === "object"
        ? (rawSettings.fileOpenTimestamps as Record<string, number>)
        : {};

    const prefs: WorkspacePrefs = {
      lastOpenFile: null,
      sortKey,
      fileOpenTimestamps,
    };

    return {
      workspaces: [workspace],
      activeWorkspaceId: id,
      prefs: { [id]: prefs },
    };
  }

  // No prior state and no legacy folder: start empty.
  return { workspaces: [], activeWorkspaceId: null, prefs: {} };
}
