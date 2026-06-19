// Read tools: list_files, read_file, search. All marked readOnlyHint and
// wrapped in the permission/audit gate. Paths are resolved through the
// workspace safety boundary before any fs access.

import { promises as fs } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  decodeImageUrlSpaces,
  searchFiles,
  type SearchInputFile,
} from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import {
  readDirTree,
  walkMarkdown,
  readFileText,
  isMarkdown,
  MAX_READ_BYTES,
} from "../fs/workspaceFs.js";
import { guardedTool, jsonResult, textResult, errorResult } from "./shared.js";

/** Hard cap on search result lines returned in one call (global cap). */
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
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
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
        "Search markdown files in the workspace. Whitespace splits the query into terms and a file must contain EVERY term (multi-term AND); a 2-character minimum applies. Case-insensitive by default. Returns ranked per-file groups plus a flat list of matching lines; each `preview`/`snippet` is a windowed excerpt around the first match on the line. Optionally scope to a subfolder, or set `caseSensitive`, `wholeWord`, or `regex`.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe(
            "Text to search for. Whitespace splits into terms (AND); 2-char minimum.",
          ),
        scope: z
          .string()
          .optional()
          .describe(
            "Workspace-relative folder to search within. Defaults to the root.",
          ),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Match case exactly. Default false (case-insensitive)."),
        wholeWord: z
          .boolean()
          .optional()
          .describe(
            "Each term must be a whole word (\\b boundaries). Default false.",
          ),
        regex: z
          .boolean()
          .optional()
          .describe(
            "Treat each term as a RegExp pattern. Invalid patterns return no matches. Default false.",
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

        // Enumerate markdown within the scope and build matcher input. Each read
        // is guarded so an unreadable file is skipped, never aborting the scan.
        // Files over the read cap are skipped to avoid loading a huge buffer.
        const files: SearchInputFile[] = [];
        for await (const abs of walkMarkdown(base)) {
          let raw: string;
          try {
            const stat = await fs.stat(abs);
            if (stat.size > MAX_READ_BYTES) continue;
            raw = await fs.readFile(abs, "utf-8");
          } catch {
            continue;
          }
          files.push({
            path: toWorkspaceRelative(deps.root, abs),
            content: decodeImageUrlSpaces(raw),
          });
        }

        const results = searchFiles(a.query, files, {
          caseSensitive: a.caseSensitive,
          wholeWord: a.wholeWord,
          regex: a.regex,
          maxTotalResults: SEARCH_MATCH_CAP,
        });

        // Flatten the ranked per-file groups into the legacy `matches[]` shape so
        // existing clients keep working: one entry per emitted result line, with
        // `preview` mapped from the windowed `snippet`.
        const matches: { path: string; line: number; preview: string }[] = [];
        for (const file of results.files) {
          for (const ln of file.lines) {
            matches.push({
              path: file.path,
              line: ln.line,
              preview: ln.snippet,
            });
          }
        }

        return jsonResult({
          query: a.query,
          scope: toWorkspaceRelative(deps.root, base),
          matchCount: results.totalMatches,
          capped: results.capped,
          files: results.files,
          matches,
        });
      },
    ),
  );
}
