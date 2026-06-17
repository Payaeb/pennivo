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
  suggestFilenameFromContent,
} from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import { isMarkdown } from "../fs/workspaceFs.js";
import {
  findAssetFoldersForFile,
  normalizeAssetsForFile,
} from "../fs/assetCoherence.js";
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
interface DeleteFileArgs {
  path: string;
  includeAssets?: boolean;
}
interface RenameFileArgs {
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

/** Atomic-ish write: temp file in the same dir, then rename over the target. */
async function writeFileAtomic(abs: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.pennivo-tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf-8");
  try {
    await fs.rename(tmp, abs);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
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
        "Rename or move a markdown file within the workspace. The file's per-file image folder follows it and content references stay coherent.",
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
        await fs.mkdir(path.dirname(newAbs), { recursive: true });
        await fs.rename(oldAbs, newAbs);
        const { healed } = await normalizeAssetsForFile(newAbs);
        return jsonResult({
          renamed: {
            from: toWorkspaceRelative(deps.root, oldAbs),
            to: toWorkspaceRelative(deps.root, newAbs),
          },
          assetsHealed: healed,
        });
      },
    ),
  );
}
