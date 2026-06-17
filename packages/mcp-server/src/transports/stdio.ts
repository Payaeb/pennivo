// stdio transport — the local-integration path used by Claude Desktop and
// Claude Code. The client spawns the process and speaks JSON-RPC over
// stdin/stdout; nothing is written to stdout except protocol frames.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function runStdio(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
