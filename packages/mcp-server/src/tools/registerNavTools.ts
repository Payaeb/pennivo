// Navigation tools: find_backlinks, get_outline. Both readOnlyHint and wrapped
// in the permission/audit gate. Paths are funneled through the workspace safety
// boundary before any fs access, and every returned path is workspace-relative.

import { promises as fs } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  decodeImageUrlSpaces,
  findInboundLinks,
  extractOutline,
  type ScanFile,
} from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import {
  walkMarkdown,
  readFileText,
  isMarkdown,
  MAX_READ_BYTES,
} from "../fs/workspaceFs.js";
import { guardedTool, jsonResult, errorResult } from "./shared.js";

/** Hard cap on backlinks returned in one call (shared with search's cap). */
const SEARCH_MATCH_CAP = 200;

interface FindBacklinksArgs {
  path: string;
}
interface GetOutlineArgs {
  path: string;
}

export function registerNavTools(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  server.registerTool(
    "find_backlinks",
    {
      title: "Find backlinks",
      description:
        "List every markdown file in the workspace that links to the given file via a relative link, image, or reference-style definition. Anchors, external URLs, and absolute paths are ignored. Returns the referring path, line number, link text, and the raw URL.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to the file to find links to."),
      },
      annotations: { readOnlyHint: true },
    },
    guardedTool<FindBacklinksArgs>(
      deps,
      getAgent,
      "find_backlinks",
      (a) => a.path,
      async (a) => {
        const targetAbs = resolveInWorkspace(deps.root, a.path);
        const targetRel = toWorkspaceRelative(deps.root, targetAbs);

        // Enumerate every markdown file and build scanner input. Each read is
        // guarded so an unreadable file is skipped, never aborting the scan;
        // files over the read cap are skipped to avoid a huge buffer.
        const files: ScanFile[] = [];
        for await (const abs of walkMarkdown(deps.root)) {
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

        const all = findInboundLinks(targetRel, files);
        const capped = all.length > SEARCH_MATCH_CAP;
        const backlinks = capped ? all.slice(0, SEARCH_MATCH_CAP) : all;

        return jsonResult({
          path: targetRel,
          count: all.length,
          capped,
          backlinks,
        });
      },
    ),
  );

  server.registerTool(
    "get_outline",
    {
      title: "Get outline",
      description:
        "Extract the heading outline (ATX `#`..`######`) of a markdown file. Headings inside fenced code blocks are ignored. Returns each heading's level, text, and 1-based line number.",
      inputSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to a .md / .markdown / .txt file."),
      },
      annotations: { readOnlyHint: true },
    },
    guardedTool<GetOutlineArgs>(
      deps,
      getAgent,
      "get_outline",
      (a) => a.path,
      async (a) => {
        const abs = resolveInWorkspace(deps.root, a.path);
        if (!isMarkdown(abs)) {
          return errorResult(`Not a markdown file: ${a.path}`);
        }
        const raw = await readFileText(abs);
        const headings = extractOutline(decodeImageUrlSpaces(raw));
        return jsonResult({
          path: toWorkspaceRelative(deps.root, abs),
          headings,
        });
      },
    ),
  );
}
