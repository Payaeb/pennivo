// Shared test harness: connect a real MCP `Client` to a fresh server over an
// in-memory transport pair. This exercises the genuine SDK protocol
// (initialize handshake, tools/list, tool calls, resource reads) without a
// child process or build step.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createPennivoMcpServer } from "../server.js";
import {
  DEFAULT_PERMISSIONS,
  staticPermissionProvider,
  type PermissionConfig,
} from "../config.js";
import { InMemoryAuditSink } from "../audit/auditLog.js";
import { mtimeRecentSource } from "../resources/recent.js";
import type { ServerDeps } from "../deps.js";

export interface Harness {
  client: Client;
  audit: InMemoryAuditSink;
  deps: ServerDeps;
  close: () => Promise<void>;
}

export interface ConnectOptions {
  config?: PermissionConfig;
  now?: () => number;
  clientName?: string;
  deleteFile?: ServerDeps["deleteFile"];
  subscribeToChanges?: ServerDeps["subscribeToChanges"];
  workspaces?: ServerDeps["workspaces"];
  activeWorkspaceId?: ServerDeps["activeWorkspaceId"];
  snapshots?: ServerDeps["snapshots"];
  trash?: ServerDeps["trash"];
}

/** A config with every tool enabled — convenient for exercising write tools. */
export const ALL_ENABLED: PermissionConfig = {
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
    write_file: true,
    create_file: true,
    append_to_file: true,
    delete_file: true,
    rename_file: true,
    create_folder: true,
    move_folder: true,
    replace_in_file: true,
    edit_file: true,
    restore_snapshot: true,
    restore_from_trash: true,
    stream_into_file: true,
  },
};

export async function connect(
  root: string,
  opts: ConnectOptions = {},
): Promise<Harness> {
  const audit = new InMemoryAuditSink();
  const deps: ServerDeps = {
    root,
    permissions: staticPermissionProvider(opts.config ?? DEFAULT_PERMISSIONS),
    audit,
    now: opts.now ?? (() => 1_700_000_000_000),
    recent: mtimeRecentSource(root),
    deleteFile: opts.deleteFile,
    subscribeToChanges: opts.subscribeToChanges,
    workspaces: opts.workspaces,
    activeWorkspaceId: opts.activeWorkspaceId,
    snapshots: opts.snapshots,
    trash: opts.trash,
  };
  const server = createPennivoMcpServer(deps);

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: opts.clientName ?? "test-client",
    version: "0.0.0",
  });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return {
    client,
    audit,
    deps,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Call a tool and return its result in the strongly-typed CallToolResult shape. */
export async function callTool(
  h: Harness,
  name: string,
  args: Record<string, unknown> = {},
): Promise<CallToolResult> {
  return (await h.client.callTool({ name, arguments: args })) as CallToolResult;
}

/** Extract the first text content block from a tool/resource result. */
export function firstText(result: unknown): string {
  const content = ((result as { content?: unknown }).content ?? []) as {
    type: string;
    text?: string;
  }[];
  const block = content.find((c) => c.type === "text");
  return block?.text ?? "";
}
