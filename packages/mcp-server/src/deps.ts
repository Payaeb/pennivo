// Dependencies injected into the server factory. Keeping the factory
// host-agnostic (clock, permissions, audit sink, recent source all injected)
// is what makes it unit-testable against a temp dir + in-memory sinks, and
// lets the desktop host later wire in live settings and the trash-routed
// delete without the server package knowing anything about Electron.

import type { PermissionConfig } from "./config.js";
import type { AuditSink } from "./audit/auditLog.js";

export interface PermissionProvider {
  /** Master switch state. */
  isEnabled(): boolean;
  /** Whether a specific tool is currently permitted. */
  isAllowed(tool: string): boolean;
}

export interface RecentFile {
  /** Absolute path on disk. */
  path: string;
  /** Last-modified time (ms), when known. */
  mtimeMs?: number;
}

export interface RecentSource {
  list(limit: number): Promise<RecentFile[]>;
}

/** Request passed to a custom delete strategy. */
export interface DeleteRequest {
  absolutePath: string;
  includeAssets: boolean;
  /** Asset folder names the file owns (already discovered by the tool). */
  assetFolderNames: string[];
}

export interface ServerDeps {
  /** Absolute workspace root. All tool paths resolve relative to this. */
  root: string;
  /** Permission gate for every tool call. */
  permissions: PermissionProvider;
  /** Where audit events go. */
  audit: AuditSink;
  /** Clock injection (tests pass a fixed clock; CLI/host pass Date.now). */
  now: () => number;
  /** Source for the `pennivo://recent` resource. */
  recent: RecentSource;
  /**
   * Optional custom delete (e.g. the desktop routes deletes through its trash
   * soft-delete). When absent, `delete_file` permanently removes the file (and
   * asset folders when `includeAssets`).
   */
  deleteFile?: (request: DeleteRequest) => Promise<void>;
  /**
   * Optional change subscription (e.g. reuse the desktop folder watcher).
   * Called with a callback to invoke on any workspace change; returns an
   * unsubscribe. When absent, the server watches `root` itself. The factory
   * uses this to emit `notifications/resources/list_changed`.
   */
  subscribeToChanges?: (onChange: () => void) => () => void;
}

export type { PermissionConfig };
