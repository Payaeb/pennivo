// The host-agnostic server factory. stdio bin, the future HTTP bin, and the
// future desktop in-process host all call this with their own `ServerDeps`.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerDeps } from "./deps.js";
import { registerReadTools } from "./tools/registerReadTools.js";
import { registerNavTools } from "./tools/registerNavTools.js";
import { registerWriteTools } from "./tools/registerWriteTools.js";
import { registerEditTools } from "./tools/registerEditTools.js";
import { registerResources } from "./resources/registerResources.js";
import { createWorkspaceWatcher } from "./watch/watcher.js";
import { PENNIVO_MCP_VERSION } from "./version.js";

export function createPennivoMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({
    name: "pennivo",
    version: PENNIVO_MCP_VERSION,
  });

  // Capture the connecting client's name from the initialize handshake so the
  // audit log can attribute each call. Falls back to "unknown".
  let agentName = "unknown";
  const underlying = server.server;
  const priorOnInit = underlying.oninitialized;
  underlying.oninitialized = () => {
    const info = underlying.getClientVersion();
    if (info?.name) {
      agentName = info.name;
    }
    priorOnInit?.();
  };
  const getAgent = () => agentName;

  registerReadTools(server, deps, getAgent);
  registerNavTools(server, deps, getAgent);
  registerWriteTools(server, deps, getAgent);
  registerEditTools(server, deps, getAgent);
  registerResources(server, deps, getAgent);

  // Emit resources/list_changed on workspace changes. Reuse an injected
  // watcher (desktop) or fall back to watching `root` directly (standalone).
  const onChange = () => {
    try {
      server.sendResourceListChanged();
    } catch {
      // Not connected / already closed — ignore.
    }
  };
  const unsubscribe = deps.subscribeToChanges
    ? deps.subscribeToChanges(onChange)
    : createWorkspaceWatcher(deps.root, onChange);

  const priorOnClose = underlying.onclose;
  underlying.onclose = () => {
    unsubscribe();
    priorOnClose?.();
  };

  return server;
}
