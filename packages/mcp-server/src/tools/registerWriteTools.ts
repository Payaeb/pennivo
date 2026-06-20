// Write tools: write_file, create_file, append_to_file, delete_file,
// rename_file. All gated by the permission/audit wrapper (off by default) and
// resolved through the workspace safety boundary with symlink-aware checks.
// rename_file reuses the asset-coherence port so a renamed doc's image folder
// follows it; delete_file routes through an injected deleter when the host
// provides one (the desktop sends deletes to its trash).

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  encodeImageUrlSpaces,
  planLinkRewrite,
  suggestFilenameFromContent,
} from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import { writeFileAtomic } from "../fs/atomicWrite.js";
import { appendChunk, AppendChunkError } from "../fs/streamAppend.js";
import { isMarkdown } from "../fs/workspaceFs.js";
import {
  findAssetFoldersForFile,
  normalizeAssetsForFile,
} from "../fs/assetCoherence.js";
import {
  enumerateMarkdownFilesAbs,
  applyLinkRewriteMcp,
  toPosix,
} from "../fs/linkRewrite.js";
import {
  guardedTool,
  jsonResult,
  errorResult,
  type ToolResult,
} from "./shared.js";

interface WriteFileArgs {
  path: string;
  content: string;
}
interface CreateFileArgs {
  path?: string;
  content: string;
}
interface AppendFileArgs {
  path: string;
  content: string;
}
interface StreamIntoFileArgs {
  path: string;
  chunk: string;
  done?: boolean;
}
interface DeleteFileArgs {
  path: string;
  includeAssets?: boolean;
}
interface RenameFileArgs {
  oldPath: string;
  newPath: string;
}
interface CreateFolderArgs {
  path: string;
}
interface MoveFolderArgs {
  oldPath: string;
  newPath: string;
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}

export function registerWriteTools(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  server.registerTool(
    "write_file",
    {
      title: "Write file",
      description:
        "Overwrite (or create) a markdown file with the given content. Image URLs with spaces are stored in the editor's %20-encoded form.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Workspace-relative path to a .md / .markdown / .txt file.",
          ),
        content: z.string().describe("Full file content to write."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<WriteFileArgs>(
      deps,
      getAgent,
      "write_file",
      (a) => a.path,
      async (a) => {
        const abs = resolveInWorkspace(deps.root, a.path, {
          followSymlinks: true,
        });
        if (!isMarkdown(abs))
          return errorResult(`Not a markdown file: ${a.path}`);
        await writeFileAtomic(abs, encodeImageUrlSpaces(a.content));
        return jsonResult({
          written: toWorkspaceRelative(deps.root, abs),
          bytes: Buffer.byteLength(a.content),
        });
      },
    ),
  );

  server.registerTool(
    "create_file",
    {
      title: "Create file",
      description:
        "Create a NEW markdown file. Omit `path` to derive a filename from the content's first line. Fails if the target already exists.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe(
            "Workspace-relative path. If omitted, derived from the first line of content.",
          ),
        content: z.string().describe("Initial file content."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<CreateFileArgs>(
      deps,
      getAgent,
      "create_file",
      (a) => a.path,
      async (a) => {
        const relOrName =
          a.path ?? `${suggestFilenameFromContent(a.content)}.md`;
        const abs = resolveInWorkspace(deps.root, relOrName, {
          followSymlinks: true,
        });
        if (!isMarkdown(abs))
          return errorResult(`Not a markdown file: ${relOrName}`);
        if (await exists(abs)) {
          return errorResult(
            `File already exists: ${toWorkspaceRelative(deps.root, abs)}`,
          );
        }
        await writeFileAtomic(abs, encodeImageUrlSpaces(a.content));
        return jsonResult({
          created: toWorkspaceRelative(deps.root, abs),
          bytes: Buffer.byteLength(a.content),
        });
      },
    ),
  );

  server.registerTool(
    "append_to_file",
    {
      title: "Append to file",
      description: "Append content to the end of an existing markdown file.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to an existing markdown file."),
        content: z.string().describe("Content to append."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<AppendFileArgs>(
      deps,
      getAgent,
      "append_to_file",
      (a) => a.path,
      async (a) => {
        const abs = resolveInWorkspace(deps.root, a.path, {
          followSymlinks: true,
        });
        if (!isMarkdown(abs))
          return errorResult(`Not a markdown file: ${a.path}`);
        if (!(await exists(abs))) {
          return errorResult(
            `File does not exist (use create_file): ${a.path}`,
          );
        }
        await fs.appendFile(abs, encodeImageUrlSpaces(a.content), "utf-8");
        return jsonResult({
          appended: toWorkspaceRelative(deps.root, abs),
          bytes: Buffer.byteLength(a.content),
        });
      },
    ),
  );

  server.registerTool(
    "stream_into_file",
    {
      title: "Stream into file",
      description:
        "Append a chunk to the end of a markdown file, creating the file if it does not yet exist. Intended for incremental/streamed writes: call repeatedly with successive chunks and a final call with `done: true`. A Pennivo window watching this workspace renders the growth live. Image URLs with spaces are stored in the %20-encoded form.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Workspace-relative path to a .md / .markdown / .txt file.",
          ),
        chunk: z.string().describe("Content to append to the end of the file."),
        done: z
          .boolean()
          .optional()
          .describe(
            "Advisory stream-end signal. Reflected in the output; v1 takes no special action besides reporting it.",
          ),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<StreamIntoFileArgs>(
      deps,
      getAgent,
      "stream_into_file",
      (a) => a.path,
      async (a) => {
        try {
          const { path: rel, bytesAppended } = await appendChunk(
            deps.root,
            a.path,
            a.chunk,
          );
          return jsonResult({
            path: rel,
            bytesAppended,
            done: !!a.done,
          });
        } catch (err) {
          if (err instanceof AppendChunkError) return errorResult(err.message);
          throw err;
        }
      },
    ),
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete file",
      description:
        "Permanently delete a markdown file. Set `includeAssets` to also remove its per-file image folder. (Hosts may route deletes elsewhere, e.g. a trash.)",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to a markdown file."),
        includeAssets: z
          .boolean()
          .optional()
          .describe(
            "Also delete the file's *-md-images folder(s). Default false.",
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    guardedTool<DeleteFileArgs>(
      deps,
      getAgent,
      "delete_file",
      (a) => a.path,
      async (a) => {
        const abs = resolveInWorkspace(deps.root, a.path, {
          followSymlinks: true,
        });
        if (!isMarkdown(abs))
          return errorResult(`Not a markdown file: ${a.path}`);
        if (!(await exists(abs)))
          return errorResult(`File does not exist: ${a.path}`);

        const includeAssets = a.includeAssets ?? false;
        const assetFolderNames = includeAssets
          ? await findAssetFoldersForFile(abs)
          : [];

        if (deps.deleteFile) {
          await deps.deleteFile({
            absolutePath: abs,
            includeAssets,
            assetFolderNames,
          });
        } else {
          // Default: permanent removal.
          await fs.rm(abs, { force: true });
          if (includeAssets) {
            const dir = path.dirname(abs);
            for (const name of assetFolderNames) {
              await fs
                .rm(path.join(dir, name), { recursive: true, force: true })
                .catch(() => {});
            }
          }
        }
        return jsonResult({
          deleted: toWorkspaceRelative(deps.root, abs),
          assetFoldersRemoved: includeAssets ? assetFolderNames : [],
        });
      },
    ),
  );

  server.registerTool(
    "rename_file",
    {
      title: "Rename / move file",
      description:
        "Rename or move a markdown file within the workspace. The file's per-file image folder follows it, inbound and outbound relative links across every document are rewritten, and content references stay coherent.",
      inputSchema: {
        oldPath: z.string().describe("Current workspace-relative path."),
        newPath: z.string().describe("New workspace-relative path."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<RenameFileArgs>(
      deps,
      getAgent,
      "rename_file",
      (a) => a.oldPath,
      async (a): Promise<ToolResult> => {
        const oldAbs = resolveInWorkspace(deps.root, a.oldPath);
        const newAbs = resolveInWorkspace(deps.root, a.newPath, {
          followSymlinks: true,
        });
        if (!isMarkdown(oldAbs))
          return errorResult(`Not a markdown file: ${a.oldPath}`);
        if (!isMarkdown(newAbs))
          return errorResult(`Target is not a markdown file: ${a.newPath}`);
        if (!(await exists(oldAbs)))
          return errorResult(`File does not exist: ${a.oldPath}`);
        if (await exists(newAbs)) {
          return errorResult(
            `Target already exists: ${toWorkspaceRelative(deps.root, newAbs)}`,
          );
        }

        // 1. PRE-MOVE snapshot of every markdown doc so the planner computes
        //    rewrites against the pre-move world.
        const files = await enumerateMarkdownFilesAbs(deps.root);
        const oldRel = toPosix(toWorkspaceRelative(deps.root, oldAbs));
        const newRel = toPosix(toWorkspaceRelative(deps.root, newAbs));

        // 2. Apply the physical move.
        await fs.mkdir(path.dirname(newAbs), { recursive: true });
        await fs.rename(oldAbs, newAbs);

        // 3. Run asset-coherence FIRST so the moved file's `*-md-images` sidecar
        //    is promoted to its canonical name and its sidecar refs rewritten.
        //    Then patch the snapshot's entry for the moved file (keyed by its
        //    PRE-move path) with this normalized content BEFORE planning, so the
        //    pure planner sees already-canonical sidecar refs (and leaves them
        //    alone) and only recomputes inter-document / outbound links. This is
        //    how the two passes compose without clobbering: asset-coherence owns
        //    the sidecar, the planner owns inter-doc links. (Mirrors the desktop
        //    rename handler's documented order.)
        const { healed, newContent: movedFileNormalizedContent } =
          await normalizeAssetsForFile(newAbs);
        const snapshot =
          movedFileNormalizedContent === undefined
            ? files
            : files.map((f) =>
                f.path === oldRel
                  ? { path: f.path, content: movedFileNormalizedContent }
                  : f,
              );

        // 4. Rewrite cross-document links workspace-wide. This writes the moved
        //    file's own outbound-link rewrite too (to its new path).
        const { linksRewritten, error: linkRewriteError } =
          await applyLinkRewriteMcp({
            root: deps.root,
            files: snapshot,
            oldPath: oldRel,
            newPath: newRel,
            isDirectory: false,
          });

        return jsonResult({
          renamed: {
            from: oldRel,
            to: newRel,
          },
          assetsHealed: healed,
          linksRewritten,
          ...(linkRewriteError ? { linkRewriteError } : {}),
        });
      },
    ),
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create folder",
      description:
        "Create a new folder (and any missing parents) within the workspace. Fails if the path already exists.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path of the folder to create."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<CreateFolderArgs>(
      deps,
      getAgent,
      "create_folder",
      (a) => a.path,
      async (a): Promise<ToolResult> => {
        const abs = resolveInWorkspace(deps.root, a.path, {
          followSymlinks: true,
        });
        if (await exists(abs)) {
          return errorResult(
            `Already exists: ${toWorkspaceRelative(deps.root, abs)}`,
          );
        }
        await fs.mkdir(abs, { recursive: true });
        return jsonResult({ created: toWorkspaceRelative(deps.root, abs) });
      },
    ),
  );

  server.registerTool(
    "move_folder",
    {
      title: "Move / rename folder",
      description:
        "Move or rename a folder within the workspace. Relative links across every document that point into or out of the folder are rewritten. A folder cannot be moved into itself or one of its own descendants.",
      inputSchema: {
        oldPath: z.string().describe("Current workspace-relative folder path."),
        newPath: z.string().describe("New workspace-relative folder path."),
      },
      annotations: { readOnlyHint: false },
    },
    guardedTool<MoveFolderArgs>(
      deps,
      getAgent,
      "move_folder",
      (a) => a.oldPath,
      async (a): Promise<ToolResult> => {
        const oldAbs = resolveInWorkspace(deps.root, a.oldPath);
        const newAbs = resolveInWorkspace(deps.root, a.newPath, {
          followSymlinks: true,
        });

        let stat;
        try {
          stat = await fs.stat(oldAbs);
        } catch {
          return errorResult(`Folder does not exist: ${a.oldPath}`);
        }
        if (!stat.isDirectory())
          return errorResult(`Not a folder: ${a.oldPath}`);
        if (await exists(newAbs)) {
          return errorResult(
            `Target already exists: ${toWorkspaceRelative(deps.root, newAbs)}`,
          );
        }

        // PRE-MOVE snapshot, used both for the self/descendant guard and the
        // post-move link rewrite.
        const files = await enumerateMarkdownFilesAbs(deps.root);
        const oldRel = toPosix(toWorkspaceRelative(deps.root, oldAbs));
        const newRel = toPosix(toWorkspaceRelative(deps.root, newAbs));

        // SELF/DESCENDANT GUARD: run the planner once on the pre-move snapshot
        // purely to read its `.error`, BEFORE touching the filesystem. A folder
        // moved into itself or a descendant is rejected with no fs change.
        const guard = planLinkRewrite({
          files,
          oldPath: oldRel,
          newPath: newRel,
          isDirectory: true,
        });
        if (guard.error === "self-into-descendant") {
          return errorResult(
            "Cannot move a folder into itself or one of its descendants.",
          );
        }

        await fs.mkdir(path.dirname(newAbs), { recursive: true });
        await fs.rename(oldAbs, newAbs);

        const { linksRewritten, error: linkRewriteError } =
          await applyLinkRewriteMcp({
            root: deps.root,
            files,
            oldPath: oldRel,
            newPath: newRel,
            isDirectory: true,
          });

        return jsonResult({
          moved: { from: oldRel, to: newRel },
          linksRewritten,
          ...(linkRewriteError ? { linkRewriteError } : {}),
        });
      },
    ),
  );
}
