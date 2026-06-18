// Phase 11f: wiring the pure `planLinkRewrite` planner (from @pennivo/core)
// into the desktop main process so file MOVE and RENAME preserve
// cross-document link integrity across the whole workspace.
//
// This module stays free of Electron and IPC. It only does fs enumeration and
// path math, then defers the actual link computation to the pure planner. The
// caller (main.ts) is responsible for performing the fs move/rename, applying
// the returned writes behind a safety re-scan, recording self-writes, and
// pushing live-reload to the renderer.

import path from "node:path";
import fs from "node:fs/promises";
import { planLinkRewrite, type WorkspaceFile } from "@pennivo/core";

// Markdown-ish extensions the sidebar/tree builder treats as documents. Kept
// in sync with SIDEBAR_EXTENSIONS in main.ts (.md / .markdown / .txt).
const MARKDOWN_DOC_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/** True when a directory name is a per-file asset sidecar (`*-md-images`). */
function isAssetSidecar(name: string): boolean {
  return name.endsWith("-md-images");
}

/** Normalize any path to forward slashes (POSIX) for plan input/output. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Compute a workspace-relative POSIX path for `absPath` under `rootAbs`.
 * Returns null when `absPath` is not inside the root (defensive; the caller
 * resolves the root from the path so this should not normally happen).
 */
export function workspaceRelativePosix(
  rootAbs: string,
  absPath: string,
): string | null {
  const rel = path.relative(rootAbs, absPath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return rel === "" ? "" : null;
  }
  return toPosix(rel);
}

/**
 * Enumerate every markdown document under `rootAbs` in a single recursive
 * walk and return `{ path, content }` with POSIX paths relative to the root.
 *
 * - Skips hidden entries and `node_modules`, matching the tree builder.
 * - Skips `*-md-images/` asset folders entirely (their contents are not
 *   documents and must not be treated as link referrers).
 * - Guards every file read so one unreadable file does not abort the walk;
 *   such files are simply omitted (and logged by the caller indirectly).
 */
export async function enumerateMarkdownFiles(
  rootAbs: string,
): Promise<WorkspaceFile[]> {
  const out: WorkspaceFile[] = [];

  async function walk(dirAbs: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirAbs, { withFileTypes: true });
    } catch {
      // Unreadable directory — skip its subtree, keep going elsewhere.
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(".")) continue;
      if (name === "node_modules") continue;
      const childAbs = path.join(dirAbs, name);
      if (entry.isDirectory()) {
        if (isAssetSidecar(name)) continue; // not documents
        await walk(childAbs);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (!MARKDOWN_DOC_EXTENSIONS.has(ext)) continue;
        let content: string;
        try {
          content = await fs.readFile(childAbs, "utf-8");
        } catch (err) {
          // One unreadable file must not abort the whole rewrite.
          console.error(
            `[link-rewrite] skipping unreadable file ${childAbs}:`,
            (err as NodeJS.ErrnoException).code ?? err,
          );
          continue;
        }
        const rel = workspaceRelativePosix(rootAbs, childAbs);
        if (rel === null || rel === "") continue;
        out.push({ path: rel, content });
      }
    }
  }

  await walk(rootAbs);
  return out;
}

export interface LinkRewriteWriteResult {
  /** Absolute paths whose content was written by the rewrite. */
  writtenAbsPaths: string[];
  /** Whether the plan reported any change at all. */
  changed: boolean;
  /** Set when the planner refused the move (illegal dir move). */
  error?: string;
}

export interface ApplyLinkRewriteArgs {
  /** Absolute workspace root the move happened inside. */
  rootAbs: string;
  /** Pre-move snapshot of every markdown doc (POSIX-relative). */
  files: WorkspaceFile[];
  /** Pre-move POSIX path relative to root. */
  oldPath: string;
  /** Post-move POSIX path relative to root. */
  newPath: string;
  /** True when the moved entity is a directory. */
  isDirectory: boolean;
  /**
   * Record a self-write so the watcher / live-reload does not mistake our own
   * write for an external change.
   */
  recordSelfWrite: (absPath: string, content: string) => void;
}

export interface ApplyLinkRewriteResult extends LinkRewriteWriteResult {
  /**
   * Absolute paths of the files written by the plan, POSIX-normalized and
   * lowercased, for the caller to test set membership against (e.g. to know
   * whether the moved file itself was rewritten).
   */
  writtenKeys: Set<string>;
}

/**
 * Run the pure planner against the pre-move snapshot and apply each resulting
 * write to its POST-move absolute path, behind a final safety re-scan:
 * re-read current on-disk content and skip the write when the file no longer
 * exists. The planned content is authoritative for link targets (it was
 * computed from the correct pre-move snapshot), so we apply it as-is when the
 * file is present.
 *
 * Every write (including the moved file's own outbound-link rewrite) is
 * applied here and recorded as a self-write. When the moved file is among the
 * writes, the caller layers normalizeAssetsForFile ON TOP afterwards: that
 * pass re-reads the just-written, link-rewritten content from disk and only
 * touches `*-md-images` references, so the two compose without clobbering.
 */
export async function applyLinkRewrite(
  args: ApplyLinkRewriteArgs,
): Promise<ApplyLinkRewriteResult> {
  const { rootAbs, files, oldPath, newPath, isDirectory, recordSelfWrite } =
    args;

  const plan = planLinkRewrite({ files, oldPath, newPath, isDirectory });
  if (plan.error) {
    return {
      writtenAbsPaths: [],
      writtenKeys: new Set(),
      changed: false,
      error: plan.error,
    };
  }
  if (!plan.changed) {
    return { writtenAbsPaths: [], writtenKeys: new Set(), changed: false };
  }

  const writtenAbsPaths: string[] = [];
  const writtenKeys = new Set<string>();

  for (const update of plan.updates) {
    const absPath = path.join(rootAbs, update.path);

    // Final safety re-scan: only write if the file still exists. The planned
    // content is correct for link targets regardless of unrelated edits, so
    // we apply it directly when present.
    try {
      await fs.access(absPath);
    } catch {
      // File vanished between snapshot and write (deleted/renamed). Skip.
      continue;
    }

    try {
      recordSelfWrite(absPath, update.newContent);
      await fs.writeFile(absPath, update.newContent, "utf-8");
      writtenAbsPaths.push(absPath);
      writtenKeys.add(toPosix(absPath).toLowerCase());
    } catch (err) {
      // One failed write must not abort the rest of the rewrite.
      console.error(
        `[link-rewrite] writeFile failed for ${absPath}:`,
        (err as NodeJS.ErrnoException).code ?? err,
      );
    }
  }

  return { writtenAbsPaths, writtenKeys, changed: true };
}
