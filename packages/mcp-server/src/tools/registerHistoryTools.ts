// History tools: list_snapshots, restore_snapshot, list_trash,
// restore_from_trash. Unlike every other tool group these are NOT self-contained
// in the server process. The snapshot/trash STORES live in the Pennivo desktop
// main process (they import electron `app`), so the server reaches them over a
// loopback control bridge through `deps.snapshots` / `deps.trash`.
//
// Conditional registration mirrors the `deleteFile`-present pattern: each tool
// is registered ONLY when its host capability is present. A standalone server
// (no bridge descriptor) therefore never advertises these tools at all.
//
// When the bridge call fails (app not running / stale descriptor) the host
// methods throw; here we catch that and return a clean "app is not running"
// errorResult rather than letting it cross the MCP boundary as a raw error.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import { guardedTool, jsonResult, errorResult } from "./shared.js";

const APP_NOT_RUNNING = "history unavailable: Pennivo app is not running";

interface ListSnapshotsArgs {
  path: string;
}
interface RestoreSnapshotArgs {
  path: string;
  snapshotId: string;
  mode?: "overwrite" | "as-new-file";
}
interface RestoreFromTrashArgs {
  trashId: string;
}

export function registerHistoryTools(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  // ---- Snapshot tools (only when the host exposes the snapshot bridge) ----
  if (deps.snapshots) {
    const snapshots = deps.snapshots;

    server.registerTool(
      "list_snapshots",
      {
        title: "List snapshots",
        description:
          "List the saved version-history snapshots for a markdown file, newest first. Requires the Pennivo desktop app to be running.",
        inputSchema: {
          path: z
            .string()
            .describe("Workspace-relative path to a markdown file."),
        },
        annotations: { readOnlyHint: true },
      },
      guardedTool<ListSnapshotsArgs>(
        deps,
        getAgent,
        "list_snapshots",
        (a) => a.path,
        async (a) => {
          const abs = resolveInWorkspace(deps.root, a.path);
          let list;
          try {
            list = await snapshots.list(abs);
          } catch {
            return errorResult(APP_NOT_RUNNING);
          }
          return jsonResult({
            path: toWorkspaceRelative(deps.root, abs),
            snapshots: list,
          });
        },
      ),
    );

    server.registerTool(
      "restore_snapshot",
      {
        title: "Restore snapshot",
        description:
          "Restore a snapshot of a markdown file. Default mode `as-new-file` writes a sibling copy (safe, non-destructive); `overwrite` replaces the file's current content after taking a pre-restore snapshot. Requires the Pennivo desktop app to be running.",
        inputSchema: {
          path: z
            .string()
            .describe("Workspace-relative path to the markdown file."),
          snapshotId: z
            .string()
            .describe("Id of the snapshot to restore (from list_snapshots)."),
          mode: z
            .enum(["overwrite", "as-new-file"])
            .optional()
            .describe(
              "`as-new-file` (default) writes a sibling copy; `overwrite` replaces the file.",
            ),
        },
        annotations: { readOnlyHint: false },
      },
      guardedTool<RestoreSnapshotArgs>(
        deps,
        getAgent,
        "restore_snapshot",
        (a) => a.path,
        async (a) => {
          const abs = resolveInWorkspace(deps.root, a.path);
          // The SAFER default: a non-destructive sibling copy.
          const mode = a.mode ?? "as-new-file";
          let result;
          try {
            result = await snapshots.restore(abs, a.snapshotId, mode);
          } catch {
            return errorResult(APP_NOT_RUNNING);
          }
          if ("error" in result) return errorResult(result.error);
          // Re-validate the host-reported path is inside the workspace before
          // reporting it back to the agent.
          let rel: string;
          try {
            const restoredAbs = resolveInWorkspace(deps.root, result.newPath);
            rel = toWorkspaceRelative(deps.root, restoredAbs);
          } catch {
            return errorResult("Restored path is outside the workspace.");
          }
          return jsonResult({ restoredTo: rel });
        },
      ),
    );
  }

  // ---- Trash tools (only when the host exposes the trash bridge) ----
  if (deps.trash) {
    const trash = deps.trash;

    server.registerTool(
      "list_trash",
      {
        title: "List trash",
        description:
          "List soft-deleted files in the trash that belong to this workspace, newest first. Requires the Pennivo desktop app to be running.",
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      guardedTool<Record<string, never>>(
        deps,
        getAgent,
        "list_trash",
        () => undefined,
        async () => {
          let entries;
          try {
            entries = await trash.list();
          } catch {
            return errorResult(APP_NOT_RUNNING);
          }
          // Only surface entries whose original path resolves inside this
          // workspace — never leak another workspace's trash. Map the original
          // path to its workspace-relative form for the agent.
          const scoped: Array<{
            trashId: string;
            originalPath: string;
            deletedAtMs: number;
            expiresAtMs: number | null;
          }> = [];
          for (const e of entries) {
            let rel: string;
            try {
              const abs = resolveInWorkspace(deps.root, e.originalPath);
              rel = toWorkspaceRelative(deps.root, abs);
            } catch {
              // Outside this workspace — skip.
              continue;
            }
            scoped.push({
              trashId: e.trashId,
              originalPath: rel,
              deletedAtMs: e.deletedAtMs,
              expiresAtMs: e.expiresAtMs,
            });
          }
          return jsonResult({ entries: scoped });
        },
      ),
    );

    server.registerTool(
      "restore_from_trash",
      {
        title: "Restore from trash",
        description:
          "Restore a soft-deleted file from the trash to its original location (or a non-colliding sibling). Requires the Pennivo desktop app to be running.",
        inputSchema: {
          trashId: z
            .string()
            .describe("Id of the trash entry to restore (from list_trash)."),
        },
        annotations: { readOnlyHint: false },
      },
      guardedTool<RestoreFromTrashArgs>(
        deps,
        getAgent,
        "restore_from_trash",
        () => undefined,
        async (a) => {
          let result;
          try {
            result = await trash.restore(a.trashId);
          } catch {
            return errorResult(APP_NOT_RUNNING);
          }
          if ("error" in result) return errorResult(result.error);
          // Re-validate the restored path is inside this workspace before
          // reporting success — a trash entry from another workspace must not
          // round-trip a path outside `root`.
          let rel: string;
          try {
            const restoredAbs = resolveInWorkspace(deps.root, result.newPath);
            rel = toWorkspaceRelative(deps.root, restoredAbs);
          } catch {
            return errorResult("Restored path is outside the workspace.");
          }
          return jsonResult({ restoredTo: rel });
        },
      ),
    );
  }
}
