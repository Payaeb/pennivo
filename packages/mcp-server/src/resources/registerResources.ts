// Resources: a workspace overview, recent files, and a per-file template.
// Resource reads are audited (as `resource:<name>`) but, like the read tools,
// are governed by the master `enabled` switch via the read-tool permissions —
// resources mirror read access, so we gate them on the `enabled` flag only.

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { decodeImageUrlSpaces } from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import {
  readDirTree,
  countMarkdown,
  readFileText,
  isMarkdown,
} from "../fs/workspaceFs.js";

export function registerResources(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  server.registerResource(
    "workspace",
    "pennivo://workspace",
    {
      title: "Pennivo workspace",
      description:
        "Overview of the configured Pennivo workspace: root, file count, and top-level tree.",
      mimeType: "application/json",
    },
    async (uri) => {
      const entries = await readDirTree(deps.root, false, deps.root);
      const fileCount = await countMarkdown(deps.root);
      deps.audit.record({
        ts: deps.now(),
        agent: getAgent(),
        tool: "resource:workspace",
        path: ".",
        outcome: "ok",
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                root: toWorkspaceRelative(deps.root, deps.root),
                fileCount,
                entries,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "recent",
    "pennivo://recent",
    {
      title: "Recent files",
      description: "Recently used markdown files in the Pennivo workspace.",
      mimeType: "application/json",
    },
    async (uri) => {
      const files = await deps.recent.list(20);
      deps.audit.record({
        ts: deps.now(),
        agent: getAgent(),
        tool: "resource:recent",
        outcome: "ok",
      });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                files: files.map((f) => ({
                  path: toWorkspaceRelative(deps.root, f.path),
                  mtimeMs: f.mtimeMs,
                })),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "file",
    new ResourceTemplate("pennivo://file/{+path}", { list: undefined }),
    {
      title: "Workspace file",
      description:
        "Read a single markdown file by its workspace-relative path.",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const raw = Array.isArray(variables.path)
        ? variables.path.join("/")
        : (variables.path ?? "");
      const rel = decodeURIComponent(raw);
      const abs = resolveInWorkspace(deps.root, rel);
      if (!isMarkdown(abs)) {
        throw new Error(`Not a markdown file: ${rel}`);
      }
      const text = decodeImageUrlSpaces(await readFileText(abs));
      deps.audit.record({
        ts: deps.now(),
        agent: getAgent(),
        tool: "resource:file",
        path: toWorkspaceRelative(deps.root, abs),
        outcome: "ok",
      });
      return {
        contents: [{ uri: uri.href, mimeType: "text/markdown", text }],
      };
    },
  );
}
