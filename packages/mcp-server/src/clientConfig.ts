// Pure helpers for generating / merging MCP client config (e.g. Claude
// Desktop's claude_desktop_config.json). The desktop app handles path
// detection + fs + clipboard; this keeps the JSON-shaping logic pure and
// unit-tested, and guarantees we never clobber a user's other MCP servers.

export interface McpServerDefinition {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function buildEntry(def: McpServerDefinition): Record<string, unknown> {
  const entry: Record<string, unknown> = { command: def.command };
  if (def.args && def.args.length > 0) entry.args = def.args;
  if (def.env && Object.keys(def.env).length > 0) entry.env = def.env;
  return entry;
}

/**
 * Return a new config object with `name` set under `mcpServers`, preserving any
 * other servers and top-level keys already present. Tolerates a missing or
 * malformed `existing` / `mcpServers`.
 */
export function mergeServerIntoConfig(
  existing: unknown,
  name: string,
  def: McpServerDefinition,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const prevServers = base.mcpServers;
  const servers =
    prevServers &&
    typeof prevServers === "object" &&
    !Array.isArray(prevServers)
      ? { ...(prevServers as Record<string, unknown>) }
      : {};
  servers[name] = buildEntry(def);
  base.mcpServers = servers;
  return base;
}

/** A ready-to-paste config snippet containing only the named server. */
export function buildConfigSnippet(
  name: string,
  def: McpServerDefinition,
): string {
  return JSON.stringify(mergeServerIntoConfig({}, name, def), null, 2);
}
