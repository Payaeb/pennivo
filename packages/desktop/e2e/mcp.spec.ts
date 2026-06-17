import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SERVER_JS = path.join(REPO_PACKAGE_DIR, "dist", "mcp", "server.js");

// Runs the bundled standalone MCP server via the Electron binary AS NODE — the
// exact mechanism the Connect-to-Claude config uses in production — and drives
// it with a genuine MCP stdio client. Proves the full desktop path: the bundle
// loads, live permissions are read from settings.json, audit is written, and
// tool calls hit the real filesystem with the workspace boundary enforced.
test("bundled MCP server (run as Node) serves stdio with live, settings-driven permissions", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "pennivo-mcp-ws-"));
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-mcp-ud-"));
  const settingsPath = path.join(userData, "settings.json");
  const auditPath = path.join(userData, "mcp-audit.jsonl");

  await writeFile(
    path.join(workspace, "hello.md"),
    "# Hello\n\nthe quick brown fox.\n",
    "utf-8",
  );
  // write_file enabled, delete_file NOT — proves the live permission gate.
  await writeFile(
    settingsPath,
    JSON.stringify({
      mcp: {
        enabled: true,
        tools: {
          list_files: true,
          read_file: true,
          search: true,
          write_file: true,
          create_file: false,
          append_to_file: false,
          delete_file: false,
          rename_file: false,
        },
      },
    }),
    "utf-8",
  );

  const electronMod = (await import("electron")) as unknown as {
    default?: string;
  };
  const electronPath = (electronMod.default ??
    (electronMod as unknown)) as string;

  const transport = new StdioClientTransport({
    command: electronPath,
    args: [
      SERVER_JS,
      "--workspace",
      workspace,
      "--settings",
      settingsPath,
      "--audit-log",
      auditPath,
    ],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } as Record<
      string,
      string
    >,
  });
  const client = new Client({ name: "pennivo-e2e-client", version: "0.0.0" });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["read_file", "write_file", "delete_file"]),
    );

    const read = (await client.callTool({
      name: "read_file",
      arguments: { path: "hello.md" },
    })) as CallToolResult;
    expect((read.content[0] as { text: string }).text).toContain(
      "the quick brown fox.",
    );

    // write_file enabled in settings.json → succeeds and hits disk.
    const wrote = (await client.callTool({
      name: "write_file",
      arguments: { path: "created.md", content: "# Created\n\nby an agent.\n" },
    })) as CallToolResult;
    expect(wrote.isError).toBeFalsy();
    expect(readFileSync(path.join(workspace, "created.md"), "utf-8")).toContain(
      "by an agent.",
    );

    // delete_file NOT enabled → denied by the live permission gate.
    const deleted = (await client.callTool({
      name: "delete_file",
      arguments: { path: "hello.md" },
    })) as CallToolResult;
    expect(deleted.isError).toBe(true);

    // Path traversal is rejected by the workspace boundary.
    const escape = (await client.callTool({
      name: "read_file",
      arguments: { path: "../../etc/hosts" },
    })) as CallToolResult;
    expect(escape.isError).toBe(true);

    // The audit log captured the calls.
    const auditRaw = readFileSync(auditPath, "utf-8");
    expect(auditRaw).toContain("write_file");
    expect(auditRaw).toContain("denied");
  } finally {
    await client.close().catch(() => {});
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
