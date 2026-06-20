// Prompts: ready-made instructions an agent can fetch and run against workspace
// notes (summarize, outline, rewrite, extract action items, draft). Prompts are
// NOT tools, so they are not gated by the per-tool permission model. They DO
// honor the master `enabled` switch (like resources), funnel every file-path
// argument through the same workspace path-safety boundary as `read_file`, and
// audit each use as `resource:prompt:<name>` so prompt activity shows up in the
// log next to resource reads.

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetPromptResult } from "@modelcontextprotocol/sdk/types.js";
import { decodeImageUrlSpaces } from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import { resolveInWorkspace, toWorkspaceRelative } from "../fs/pathSafety.js";
import { readFileText, isMarkdown } from "../fs/workspaceFs.js";
import { redactRoot } from "../tools/shared.js";

/** Wrap a single instruction + body into the user-message shape the SDK wants. */
function userMessage(text: string): GetPromptResult {
  return {
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

/** Error result surfaced to the client when a prompt cannot be served. */
function errorMessage(text: string): GetPromptResult {
  return userMessage(text);
}

/**
 * Read a workspace file through the exact `read_file` safety path: resolve
 * inside the workspace, require a markdown extension, read as UTF-8, and decode
 * image URL spaces. Throws `WorkspacePathError` on a traversal/escape.
 */
async function readWorkspaceFile(
  deps: ServerDeps,
  rel: string,
): Promise<string> {
  const abs = resolveInWorkspace(deps.root, rel);
  if (!isMarkdown(abs)) {
    throw new Error(`Not a markdown file: ${rel}`);
  }
  return decodeImageUrlSpaces(await readFileText(abs));
}

/** Split a paths argument that may be an array OR a comma-separated string. */
function splitPaths(input: string): string[] {
  return input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function registerPrompts(
  server: McpServer,
  deps: ServerDeps,
  getAgent: () => string,
): void {
  // Audit + master-switch helper shared by every prompt handler. Mirrors how
  // resources record `resource:<name>`; prompts record `resource:prompt:<name>`.
  // Returns true when the prompt may proceed; records a `denied` event and
  // returns false when the master switch is off.
  const gate = (name: string, auditPath?: string): boolean => {
    if (!deps.permissions.isEnabled()) {
      deps.audit.record({
        ts: deps.now(),
        agent: getAgent(),
        tool: `resource:prompt:${name}`,
        path: auditPath,
        outcome: "denied",
      });
      return false;
    }
    return true;
  };

  const auditOk = (name: string, auditPath?: string): void => {
    deps.audit.record({
      ts: deps.now(),
      agent: getAgent(),
      tool: `resource:prompt:${name}`,
      path: auditPath,
      outcome: "ok",
    });
  };

  const auditError = (
    name: string,
    detail: string,
    auditPath?: string,
  ): void => {
    deps.audit.record({
      ts: deps.now(),
      agent: getAgent(),
      tool: `resource:prompt:${name}`,
      path: auditPath,
      outcome: "error",
      detail,
    });
  };

  // Best-effort workspace-relative form of a raw path arg, for audit entries.
  const auditPathFor = (input: string | undefined): string | undefined => {
    if (!input) return undefined;
    try {
      const abs = resolveInWorkspace(deps.root, input);
      return toWorkspaceRelative(deps.root, abs);
    } catch {
      return input;
    }
  };

  // A single-file prompt: gate, read through path safety, audit, build message.
  const singleFilePrompt =
    (name: string, template: (content: string) => string) =>
    async (args: { path: string }): Promise<GetPromptResult> => {
      const auditPath = auditPathFor(args.path);
      if (!gate(name, auditPath)) {
        return errorMessage("Pennivo MCP access is disabled in settings.");
      }
      try {
        const content = await readWorkspaceFile(deps, args.path);
        auditOk(name, auditPath);
        return userMessage(template(content));
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const detail = redactRoot(raw, deps.root);
        auditError(name, detail, auditPath);
        throw new Error(detail, { cause: err });
      }
    };

  server.registerPrompt(
    "summarize_note",
    {
      title: "Summarize note",
      description: "Summarize a workspace note in 3-5 concise bullet points.",
      argsSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to the markdown note."),
      },
    },
    singleFilePrompt(
      "summarize_note",
      (content) =>
        `Summarize the following note in 3-5 concise bullet points:\n\n${content}`,
    ),
  );

  server.registerPrompt(
    "make_outline",
    {
      title: "Make outline",
      description: "Produce a hierarchical outline of a workspace note.",
      argsSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to the markdown note."),
      },
    },
    singleFilePrompt(
      "make_outline",
      (content) =>
        `Produce a hierarchical outline (headings and sub-points) of the following note:\n\n${content}`,
    ),
  );

  server.registerPrompt(
    "extract_action_items",
    {
      title: "Extract action items",
      description:
        "Extract every action item, task, or TODO from a note as a checklist.",
      argsSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to the markdown note."),
      },
    },
    singleFilePrompt(
      "extract_action_items",
      (content) =>
        `Extract every action item, task, or TODO from this note as a markdown checklist:\n\n${content}`,
    ),
  );

  // rewrite_concise: operate on the optional selection if given, else the whole
  // file. The selection text is used verbatim and never touches the filesystem.
  server.registerPrompt(
    "rewrite_concise",
    {
      title: "Rewrite concise",
      description:
        "Rewrite a note (or a provided selection) to be more concise while preserving meaning and tone.",
      argsSchema: {
        path: z
          .string()
          .describe("Workspace-relative path to the markdown note."),
        selection: z
          .string()
          .optional()
          .describe(
            "Optional text to rewrite. When omitted, the whole file is used.",
          ),
      },
    },
    async (args: {
      path: string;
      selection?: string;
    }): Promise<GetPromptResult> => {
      const auditPath = auditPathFor(args.path);
      if (!gate("rewrite_concise", auditPath)) {
        return errorMessage("Pennivo MCP access is disabled in settings.");
      }
      try {
        const hasSelection =
          typeof args.selection === "string" && args.selection.length > 0;
        const text = hasSelection
          ? (args.selection as string)
          : await readWorkspaceFile(deps, args.path);
        auditOk("rewrite_concise", auditPath);
        return userMessage(
          `Rewrite the following to be more concise while preserving meaning and tone:\n\n${text}`,
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const detail = redactRoot(raw, deps.root);
        auditError("rewrite_concise", detail, auditPath);
        throw new Error(detail, { cause: err });
      }
    },
  );

  // draft_from_notes: accepts an array OR a comma-separated string of paths.
  // Over the MCP wire prompt args are always strings, so the schema is a string
  // and we split on commas. Each path is resolved + validated independently.
  server.registerPrompt(
    "draft_from_notes",
    {
      title: "Draft from notes",
      description:
        "Draft a document on a topic from one or more workspace notes.",
      argsSchema: {
        paths: z
          .string()
          .describe(
            "Comma-separated list of workspace-relative note paths to draw from.",
          ),
        topic: z.string().describe("What to draft (for example, a blog post)."),
      },
    },
    async (args: {
      paths: string | string[];
      topic: string;
    }): Promise<GetPromptResult> => {
      const name = "draft_from_notes";
      const list = Array.isArray(args.paths)
        ? args.paths
        : splitPaths(args.paths);
      const auditPath = list.length > 0 ? auditPathFor(list[0]) : undefined;
      if (!gate(name, auditPath)) {
        return errorMessage("Pennivo MCP access is disabled in settings.");
      }
      try {
        if (list.length === 0) {
          throw new Error("No note paths provided.");
        }
        const sections: string[] = [];
        for (const rel of list) {
          const content = await readWorkspaceFile(deps, rel);
          const shown = toWorkspaceRelative(
            deps.root,
            resolveInWorkspace(deps.root, rel),
          );
          sections.push(`--- ${shown} ---\n${content}`);
        }
        const combined = sections.join("\n\n");
        auditOk(name, auditPath);
        return userMessage(
          `Draft a ${args.topic} from these notes:\n\n${combined}`,
        );
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const detail = redactRoot(raw, deps.root);
        auditError(name, detail, auditPath);
        throw new Error(detail, { cause: err });
      }
    },
  );
}
