// Read tools: list_files, read_file, search. All marked readOnlyHint and
// wrapped in the permission/audit gate. Paths are resolved through the
// workspace safety boundary before any fs access.

import { promises as fs } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodeImageUrlSpaces } from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import {
  readDirTree,
  walkMarkdown,
  readFileText,
  isMarkdown,
} from "../fs/workspaceFs.js";
import { guardedTool, jsonResult, textResult, errorResult } from "./shared.js";

/** Hard cap on search matches returned in one call. */
const SEARCH_MATCH_CAP = 200;

interface ListFilesArgs {
  path?: string;
  recursive?: boolean;
}
interface ReadFileArgs {
  path: string;
}
interface SearchArgs {
  query: string;
  scope?: string;
}

export function registerReadTools(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  server.registerTool(
    "list_files",
    {
      title: "List files",
      description:
        "List markdown files and folders in the Pennivo workspace. Omit `path` for the workspace root. Set `recursive` to walk all subfolders. Paths are workspace-relative.",
      inputSchema: {
        path: z
          .string()
          .optional()
          .describe("Workspace-relative folder to list. Defaults to the root."),
        recursive: z
          .boolean()
          .optional()
          .describe("Walk subfolders recursively. Default false."),
      },
      annotations: { readOnlyHint: true },
    },
    guardedTool<ListFilesArgs>(
      deps,
      getAgent,
      "list_files",
      (a) => a.path,
      async (a) => {
        const dir = a.path ? resolveInWorkspace(deps.root, a.path) : deps.root;
        const entries = await readDirTree(dir, a.recursive ?? false, deps.root);
        return jsonResult({
          root: toWorkspaceRelative(deps.root, dir),
          recursive: a.recursive ?? false,
          entries,
        });
      },
    ),
  );

  server.registerTool(
    "read_file",
    {
      title: "Read file",
      description:
        "Read a markdown file from the Pennivo workspace as UTF-8 text. Image URLs are returned in human-readable form.",
      inputSchema: {
        path: z
          .string()
          .describe(
            "Workspace-relative path to a .md / .markdown / .txt file.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    guardedTool<ReadFileArgs>(
      deps,
      getAgent,
      "read_file",
      (a) => a.path,
      async (a) => {
        const abs = resolveInWorkspace(deps.root, a.path);
        if (!isMarkdown(abs)) {
          return errorResult(`Not a markdown file: ${a.path}`);
        }
        const raw = await readFileText(abs);
        return textResult(decodeImageUrlSpaces(raw));
      },
    ),
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Case-insensitive substring search across markdown files in the workspace. Returns matching lines with their file path and line number. Optionally scope to a subfolder.",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for."),
        scope: z
          .string()
          .optional()
          .describe(
            "Workspace-relative folder to search within. Defaults to the root.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    guardedTool<SearchArgs>(
      deps,
      getAgent,
      "search",
      (a) => a.scope,
      async (a) => {
        const base = a.scope
          ? resolveInWorkspace(deps.root, a.scope)
          : deps.root;
        const needle = a.query.toLowerCase();
        const matches: { path: string; line: number; preview: string }[] = [];

        outer: for await (const file of walkMarkdown(base)) {
          let content: string;
          try {
            content = await fs.readFile(file, "utf-8");
          } catch {
            continue;
          }
          const lines = content.split(/\r?\n/);
          const rel = toWorkspaceRelative(deps.root, file);
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(needle)) {
              matches.push({
                path: rel,
                line: i + 1,
                preview: lines[i].trim().slice(0, 200),
              });
              if (matches.length >= SEARCH_MATCH_CAP) break outer;
            }
          }
        }

        return jsonResult({
          query: a.query,
          scope: toWorkspaceRelative(deps.root, base),
          matchCount: matches.length,
          capped: matches.length >= SEARCH_MATCH_CAP,
          matches,
        });
      },
    ),
  );
}
