// UI-side mirror of the @pennivo/mcp-server PermissionConfig contract. Kept
// local so @pennivo/ui doesn't depend on the Node MCP server package (which
// pulls the MCP SDK). The headless `pennivo --mcp` process re-validates this
// slice through the package's `mergeAndValidate` on read, so a malformed value
// can never escalate permissions — this type just shapes what the UI writes.

export const MCP_READ_TOOLS = ["list_files", "read_file", "search"] as const;
export const MCP_WRITE_TOOLS = [
  "write_file",
  "create_file",
  "append_to_file",
  "delete_file",
  "rename_file",
] as const;

export type McpToolName =
  | (typeof MCP_READ_TOOLS)[number]
  | (typeof MCP_WRITE_TOOLS)[number];

export interface McpSettings {
  enabled: boolean;
  tools: Record<McpToolName, boolean>;
}

export const MCP_TOOL_LABELS: Record<McpToolName, string> = {
  list_files: "List files",
  read_file: "Read file",
  search: "Search",
  write_file: "Write file",
  create_file: "Create file",
  append_to_file: "Append to file",
  delete_file: "Delete file",
  rename_file: "Rename / move file",
};

export function defaultMcpSettings(): McpSettings {
  return {
    enabled: true,
    tools: {
      list_files: true,
      read_file: true,
      search: true,
      write_file: false,
      create_file: false,
      append_to_file: false,
      delete_file: false,
      rename_file: false,
    },
  };
}

/**
 * Coerce a possibly-missing/corrupt persisted value into valid McpSettings,
 * degrading DOWN to read-only defaults (mirrors the server's mergeAndValidate).
 */
export function migrateMcpSettings(raw: unknown): McpSettings {
  const result = defaultMcpSettings();
  if (typeof raw !== "object" || raw === null) return result;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.enabled === "boolean") result.enabled = obj.enabled;
  const tools =
    typeof obj.tools === "object" && obj.tools !== null
      ? (obj.tools as Record<string, unknown>)
      : {};
  for (const name of [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS]) {
    if (typeof tools[name] === "boolean")
      result.tools[name] = tools[name] as boolean;
  }
  return result;
}
