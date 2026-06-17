// Shared tool plumbing: result builders + the permission/audit gate every tool
// is wrapped in. The gate never throws past the MCP boundary — denials and
// errors come back as `isError: true` results and are always audited.

import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { normalizeAbsolutePath } from "@pennivo/core";
import type { ServerDeps } from "../deps.js";
import type { ToolName } from "../config.js";
import { WorkspacePathError, toWorkspaceRelative } from "../fs/pathSafety.js";

/**
 * Replace any occurrence of the workspace root's absolute path with
 * "<workspace>" so error messages (which can come from raw fs errors like
 * ENOENT/EPERM and would otherwise echo `C:\Users\…`) never reveal where the
 * workspace lives on disk. Privacy guard for everything returned to the agent
 * AND written to the audit log.
 */
export function redactRoot(message: string, root: string): string {
  const variants = [
    root,
    root.replace(/\\/g, "/"),
    root.replace(/\//g, "\\"),
    normalizeAbsolutePath(root),
  ];
  let out = message;
  for (const v of variants) {
    if (v) out = out.split(v).join("<workspace>");
  }
  return out;
}

/** A tool result in the exact shape the MCP SDK expects. */
export type ToolResult = CallToolResult;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Best-effort workspace-relative form of a raw path arg, for audit entries. */
function auditPathFor(
  root: string,
  input: string | undefined,
): string | undefined {
  if (!input) return undefined;
  try {
    const abs = path.isAbsolute(input) ? input : path.resolve(root, input);
    return toWorkspaceRelative(root, abs);
  } catch {
    return input;
  }
}

/**
 * Wrap a tool handler with permission gating and audit logging. Returns a
 * callback in the shape the MCP SDK expects (it ignores the extra `extra`
 * argument the SDK passes).
 */
export function guardedTool<Args>(
  deps: ServerDeps,
  getAgent: () => string,
  tool: ToolName,
  pathOf: (args: Args) => string | undefined,
  handler: (args: Args) => Promise<ToolResult>,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args): Promise<ToolResult> => {
    const agent = getAgent();
    const auditPath = auditPathFor(deps.root, pathOf(args));

    if (!deps.permissions.isEnabled() || !deps.permissions.isAllowed(tool)) {
      deps.audit.record({
        ts: deps.now(),
        agent,
        tool,
        path: auditPath,
        outcome: "denied",
      });
      return errorResult(`Tool \`${tool}\` is disabled in Pennivo settings.`);
    }

    try {
      const result = await handler(args);
      deps.audit.record({
        ts: deps.now(),
        agent,
        tool,
        path: auditPath,
        outcome: result.isError ? "error" : "ok",
      });
      return result;
    } catch (err) {
      const raw =
        err instanceof WorkspacePathError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      // Scrub the workspace's absolute path out of any raw fs error before it
      // reaches the agent or the audit log.
      const detail = redactRoot(raw, deps.root);
      deps.audit.record({
        ts: deps.now(),
        agent,
        tool,
        path: auditPath,
        outcome: "error",
        detail,
      });
      return errorResult(detail);
    }
  };
}
