// Permission model for the Pennivo MCP server.
//
// Read-only by default: list/read/search are on, every write tool is off.
// Nothing in the server flips a write tool on — only the host (the desktop
// Settings UI, or an explicit CLI `--allow`) can. A corrupt or partial config
// always degrades DOWN to the read-only defaults, never up to all-on.

import type { PermissionProvider } from "./deps.js";

export const READ_TOOLS = [
  "list_files",
  "read_file",
  "search",
  "find_backlinks",
  "get_outline",
  "list_workspaces",
  "list_snapshots",
  "list_trash",
] as const;
export const WRITE_TOOLS = [
  "write_file",
  "create_file",
  "append_to_file",
  "delete_file",
  "rename_file",
  "create_folder",
  "move_folder",
  "replace_in_file",
  "edit_file",
  "restore_snapshot",
  "restore_from_trash",
  "stream_into_file",
] as const;
export const ALL_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS] as const;

export type ToolName = (typeof ALL_TOOLS)[number];

export interface PermissionConfig {
  /** Master switch. When false, every tool is denied. */
  enabled: boolean;
  /** Per-tool allow flags. */
  tools: Record<ToolName, boolean>;
}

export const DEFAULT_PERMISSIONS: PermissionConfig = {
  enabled: true,
  tools: {
    list_files: true,
    read_file: true,
    search: true,
    find_backlinks: true,
    get_outline: true,
    list_workspaces: true,
    list_snapshots: true,
    list_trash: true,
    write_file: false,
    create_file: false,
    append_to_file: false,
    delete_file: false,
    rename_file: false,
    create_folder: false,
    move_folder: false,
    replace_in_file: false,
    edit_file: false,
    restore_snapshot: false,
    restore_from_trash: false,
    stream_into_file: false,
  },
};

function defaultTools(): Record<ToolName, boolean> {
  return { ...DEFAULT_PERMISSIONS.tools };
}

/**
 * Coerce arbitrary (possibly corrupt) input into a valid PermissionConfig.
 * Only explicitly-boolean fields override the defaults, so unknown keys,
 * wrong types, or a missing `tools` object all collapse to read-only.
 */
export function mergeAndValidate(input: unknown): PermissionConfig {
  const result: PermissionConfig = { enabled: true, tools: defaultTools() };
  if (typeof input !== "object" || input === null) {
    return result;
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.enabled === "boolean") {
    result.enabled = obj.enabled;
  }
  const tools =
    typeof obj.tools === "object" && obj.tools !== null
      ? (obj.tools as Record<string, unknown>)
      : {};
  for (const tool of ALL_TOOLS) {
    if (typeof tools[tool] === "boolean") {
      result.tools[tool] = tools[tool] as boolean;
    }
  }
  return result;
}

/** A permission provider backed by a fixed config snapshot. */
export function staticPermissionProvider(
  config: PermissionConfig,
): PermissionProvider {
  return {
    isEnabled: () => config.enabled,
    isAllowed: (tool: string) =>
      config.enabled && config.tools[tool as ToolName] === true,
  };
}
