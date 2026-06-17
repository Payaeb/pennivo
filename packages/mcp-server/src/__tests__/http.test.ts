import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createPennivoMcpServer } from "../server.js";
import { runHttp, type RunningHttpServer } from "../transports/http.js";
import { staticPermissionProvider } from "../config.js";
import { ALL_ENABLED } from "./harness.js";
import { NullAuditSink } from "../audit/auditLog.js";
import { mtimeRecentSource } from "../resources/recent.js";
import { seedWorkspace, cleanup } from "./fixtures.js";

describe("HTTP transport (loopback)", () => {
  let root: string;
  let running: RunningHttpServer;
  let client: Client;

  beforeEach(async () => {
    root = seedWorkspace();
    running = await runHttp(
      () =>
        createPennivoMcpServer({
          root,
          permissions: staticPermissionProvider(ALL_ENABLED),
          audit: new NullAuditSink(),
          now: () => 0,
          recent: mtimeRecentSource(root),
          // No watcher in this test — avoid a real fs.watch handle.
          subscribeToChanges: () => () => {},
        }),
      { host: "127.0.0.1" },
    );
    client = new Client({ name: "http-test-client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(running.url)),
    );
  });

  afterEach(async () => {
    await client.close();
    await running.close();
    cleanup(root);
  });

  it("binds to loopback and reports a URL", () => {
    expect(running.host).toBe("127.0.0.1");
    expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(running.port).toBeGreaterThan(0);
  });

  it("serves tools/list over HTTP", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("read_file");
    expect(tools.map((t) => t.name)).toContain("write_file");
  });

  it("serves a read_file tool call over HTTP", async () => {
    const res = (await client.callTool({
      name: "read_file",
      arguments: { path: "notes.md" },
    })) as CallToolResult;
    const text = (res.content[0] as { text: string }).text;
    expect(text).toContain("The quick brown fox.");
  });

  it("enforces path safety over HTTP", async () => {
    const res = (await client.callTool({
      name: "read_file",
      arguments: { path: "../../etc/hosts" },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});
