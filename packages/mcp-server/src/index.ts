// Public API for @pennivo/mcp-server. The desktop host imports
// `createPennivoMcpServer` + the sink/config helpers to run the server
// in-process; the standalone CLI (src/bin/cli.ts) is the other consumer.

export { PENNIVO_MCP_VERSION } from "./version.js";

export { createPennivoMcpServer } from "./server.js";

export { runStdio } from "./transports/stdio.js";

export {
  runHttp,
  type HttpOptions,
  type RunningHttpServer,
} from "./transports/http.js";

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

export {
  WorkspacePathError,
  type WorkspacePathErrorCode,
  resolveInWorkspace,
  toWorkspaceRelative,
} from "./fs/pathSafety.js";

export { mtimeRecentSource } from "./resources/recent.js";

export {
  type McpServerDefinition,
  mergeServerIntoConfig,
  buildConfigSnippet,
} from "./clientConfig.js";
