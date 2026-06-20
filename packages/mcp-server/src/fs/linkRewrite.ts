// Cross-document link integrity for agent-driven moves and renames. This is a
// self-contained port of the desktop main process's `linkRewriteIntegration`
// (enumerate + apply) onto core's pure `planLinkRewrite`. The standalone npx
// MCP server cannot import from `packages/desktop`, so the enumeration and
// apply logic live here, reusing the package's own `walkMarkdown` walk rather
// than re-implementing it.
//
// The flow is: snapshot every markdown doc (pre-move, POSIX workspace-relative),
// let core compute the content rewrites, then write each update to its POST-move
// absolute path behind a safety re-scan that skips files which vanished between
// snapshot and write. Kept free of any renderer self-write hook (the desktop's
// only extra concern), so the two callers share identical link semantics.

import { promises as fs } from "node:fs";
import path from "node:path";
import { planLinkRewrite, type WorkspaceFile } from "@pennivo/core";
import { writeFileAtomic } from "./atomicWrite.js";
import { walkMarkdown, MAX_READ_BYTES } from "./workspaceFs.js";
import { toWorkspaceRelative } from "./pathSafety.js";

/** Normalize any path to forward slashes (POSIX) for plan input/output. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Enumerate every markdown document under `root` and return `{ path, content }`
 * with POSIX paths relative to the root. Reuses the package's `walkMarkdown`
 * generator (which already skips hidden entries, `node_modules`, and non
 * markdown files) rather than re-implementing the walk. Every read is guarded:
 * a file that is unreadable or larger than `MAX_READ_BYTES` is skipped so one
 * bad file never aborts the whole snapshot.
 */
export async function enumerateMarkdownFilesAbs(
  root: string,
): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];
  for await (const abs of walkMarkdown(root)) {
    let content: string;
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_READ_BYTES) continue;
      content = await fs.readFile(abs, "utf-8");
    } catch {
      // Unreadable file (gone, locked, permissions). Skip it; never abort.
      continue;
    }
    const rel = toPosix(toWorkspaceRelative(root, abs));
    if (rel === "" || rel === ".") continue;
    out.push({ path: rel, content });
  }
  return out;
}

export interface ApplyLinkRewriteArgs {
  /** Absolute workspace root the move happened inside. */
  root: string;
  /** Pre-move snapshot of every markdown doc (POSIX workspace-relative). */
  files: WorkspaceFile[];
  /** Pre-move POSIX path relative to root. */
  oldPath: string;
  /** Post-move POSIX path relative to root. */
  newPath: string;
  /** True when the moved entity is a directory. */
  isDirectory: boolean;
}

export interface ApplyLinkRewriteResult {
  /** How many files had their content rewritten on disk. */
  linksRewritten: number;
  /** Set when the planner refused the move (illegal dir move). */
  error?: string;
}

/**
 * Run the pure planner against the pre-move snapshot and apply each resulting
 * write to its POST-move absolute path, behind a final safety re-scan: skip the
 * write when the file no longer exists. The planned content is authoritative
 * for link targets (computed from the correct pre-move snapshot), so it is
 * applied as-is when the file is present. Mirrors the desktop's `applyLinkRewrite`
 * minus the renderer self-write hook. One failed write does not abort the rest.
 */
export async function applyLinkRewriteMcp(
  args: ApplyLinkRewriteArgs,
): Promise<ApplyLinkRewriteResult> {
  const { root, files, oldPath, newPath, isDirectory } = args;

  const plan = planLinkRewrite({ files, oldPath, newPath, isDirectory });
  if (plan.error) {
    return { linksRewritten: 0, error: plan.error };
  }
  if (!plan.changed) {
    return { linksRewritten: 0 };
  }

  let linksRewritten = 0;
  for (const update of plan.updates) {
    const abs = path.join(root, update.path);

    // Safety re-scan: only write if the file still exists. The planned content
    // is correct for link targets regardless of unrelated edits, so apply it
    // directly when present.
    try {
      await fs.access(abs);
    } catch {
      // File vanished between snapshot and write (deleted/renamed). Skip.
      continue;
    }

    try {
      await writeFileAtomic(abs, update.newContent);
      linksRewritten++;
    } catch {
      // One failed write must not abort the rest of the rewrite.
    }
  }

  return { linksRewritten };
}
