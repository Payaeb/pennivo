// Embed entry for the Pennivo desktop app (monorepo-internal).
//
// Unlike the public "." entry, this deliberately does NOT re-export the HTTP
// transport, so bundling it into the Electron main process never pulls in the
// SDK's HTTP stack (express/hono). The desktop only ever runs the server over
// stdio (`pennivo --mcp`). Resolves to source — consumed by the desktop's vite
// build the same way `@pennivo/core` is.

export { createPennivoMcpServer } from "./server.js";
export { runStdio } from "./transports/stdio.js";

export type {
  ServerDeps,
  PermissionProvider,
  RecentFile,
  RecentSource,
  DeleteRequest,
} from "./deps.js";

export {
  type PermissionConfig,
  type ToolName,
  READ_TOOLS,
  WRITE_TOOLS,
  ALL_TOOLS,
  DEFAULT_PERMISSIONS,
  mergeAndValidate,
  staticPermissionProvider,
} from "./config.js";

export {
  type AuditEvent,
  type AuditOutcome,
  type AuditSink,
  InMemoryAuditSink,
  JsonlAuditSink,
  NullAuditSink,
} from "./audit/auditLog.js";

export { mtimeRecentSource } from "./resources/recent.js";

export {
  type McpServerDefinition,
  mergeServerIntoConfig,
  buildConfigSnippet,
} from "./clientConfig.js";
