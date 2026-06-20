// Navigation tools: find_backlinks, get_outline, list_workspaces. All
// readOnlyHint and wrapped in the permission/audit gate. find_backlinks and
// get_outline funnel paths through the workspace safety boundary before any fs
// access and return workspace-relative paths. list_workspaces is the one
// deliberate exception: it returns ABSOLUTE workspace roots (see below).

import path from "node:path";
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
// list_workspaces takes no arguments.
type ListWorkspacesArgs = Record<string, never>;

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

  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description:
        "List the workspace roots the host has opened, plus which one is active. Each entry has a stable id, a display name, and an ABSOLUTE root path so a multi-workspace agent can pick a workspace to operate in. A standalone single-workspace server reports just its own --workspace root as id `default`.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    guardedTool<ListWorkspacesArgs>(
      deps,
      getAgent,
      "list_workspaces",
      // No path argument: this tool is workspace-scoped, not file-scoped.
      () => undefined,
      async () => {
        // Host injection: the desktop provides the real multi-workspace list.
        if (deps.workspaces) {
          const workspaces = await deps.workspaces();
          const active =
            deps.activeWorkspaceId ?? workspaces[0]?.id ?? null;
          // rootPath is intentionally ABSOLUTE here. This is the one deliberate
          // absolute-path exposure in the server: a multi-workspace agent needs
          // the real root to address a workspace. Standalone users only ever see
          // their own --workspace root (the fallback branch below).
          return jsonResult({ active, workspaces });
        }

        // Standalone fallback: synthesize a single entry from `root`. The
        // absolute root is the same path the caller passed via --workspace, so
        // nothing new is revealed.
        return jsonResult({
          active: "default",
          workspaces: [
            {
              id: "default",
              name: path.basename(deps.root),
              rootPath: deps.root,
            },
          ],
        });
      },
    ),
  );
}
