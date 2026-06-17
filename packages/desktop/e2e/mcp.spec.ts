import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SERVER_JS = path.join(REPO_PACKAGE_DIR, "dist", "mcp", "server.js");

const ALL_TOOLS_ON = {
  enabled: true,
  tools: {
    list_files: true,
    read_file: true,
    search: true,
    write_file: true,
    create_file: true,
    append_to_file: true,
    delete_file: true,
    rename_file: true,
  },
};

async function electronBinary(): Promise<string> {
  const mod = (await import("electron")) as unknown as { default?: string };
  return (mod.default ?? (mod as unknown)) as string;
}

/** Spawn the bundled server via the Electron binary AS NODE and connect a real
 * MCP client — exactly how Connect-to-Claude launches it in production. */
async function connectViaBinary(
  workspace: string,
  settingsPath: string,
  auditPath: string,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const electronPath = await electronBinary();
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
  await client.connect(transport);
  return { client, close: () => client.close() };
}

async function seed(settings: unknown): Promise<{
  workspace: string;
  userData: string;
  settingsPath: string;
  auditPath: string;
}> {
  const workspace = await mkdtemp(path.join(tmpdir(), "pennivo-mcp-ws-"));
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-mcp-ud-"));
  const settingsPath = path.join(userData, "settings.json");
  const auditPath = path.join(userData, "mcp-audit.jsonl");
  await writeFile(settingsPath, JSON.stringify(settings), "utf-8");
  return { workspace, userData, settingsPath, auditPath };
}

// Proves the full desktop path: the bundle loads, live permissions are read
// from settings.json, audit is written, and tool calls hit the real filesystem
// with the workspace boundary enforced.
test("bundled MCP server (run as Node) serves stdio with live, settings-driven permissions", async () => {
  // write_file enabled, delete_file NOT — proves the live permission gate.
  const { workspace, userData, settingsPath, auditPath } = await seed({
    mcp: {
      enabled: true,
      tools: {
        ...ALL_TOOLS_ON.tools,
        delete_file: false,
        create_file: false,
        append_to_file: false,
        rename_file: false,
      },
    },
  });
  await writeFile(
    path.join(workspace, "hello.md"),
    "# Hello\n\nthe quick brown fox.\n",
    "utf-8",
  );

  const { client, close } = await connectViaBinary(
    workspace,
    settingsPath,
    auditPath,
  );
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["read_file", "write_file", "delete_file"]),
    );

    const read = (await client.callTool({
      name: "read_file",
      arguments: { path: "hello.md" },
    })) as CallToolResult;
    expect((read.content[0] as { text: string }).text).toContain(
      "the quick brown fox.",
    );

    const wrote = (await client.callTool({
      name: "write_file",
      arguments: { path: "created.md", content: "# Created\n\nby an agent.\n" },
    })) as CallToolResult;
    expect(wrote.isError).toBeFalsy();
    expect(readFileSync(path.join(workspace, "created.md"), "utf-8")).toContain(
      "by an agent.",
    );

    const deleted = (await client.callTool({
      name: "delete_file",
      arguments: { path: "hello.md" },
    })) as CallToolResult;
    expect(deleted.isError).toBe(true); // not enabled

    const escape = (await client.callTool({
      name: "read_file",
      arguments: { path: "../../etc/hosts" },
    })) as CallToolResult;
    expect(escape.isError).toBe(true);

    const auditRaw = readFileSync(auditPath, "utf-8");
    expect(auditRaw).toContain("write_file");
    expect(auditRaw).toContain("denied");
    // Privacy: the audit never leaks the workspace's absolute path.
    expect(auditRaw).not.toContain(workspace);
  } finally {
    await close();
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});

// Exercises the write/asset/notification code paths through the BUNDLED binary
// (create/append/rename + the per-file image folder following a rename + the
// file watcher emitting list_changed).
test("bundled MCP server handles create/append/rename-with-assets and emits list_changed", async () => {
  const { workspace, userData, settingsPath, auditPath } = await seed({
    mcp: ALL_TOOLS_ON,
  });
  await writeFile(
    path.join(workspace, "doc.md"),
    "# Doc\n\n![p](./doc-md-images/p.png)\n",
    "utf-8",
  );
  await mkdir(path.join(workspace, "doc-md-images"), { recursive: true });
  await writeFile(
    path.join(workspace, "doc-md-images", "p.png"),
    "img",
    "utf-8",
  );

  const { client, close } = await connectViaBinary(
    workspace,
    settingsPath,
    auditPath,
  );
  try {
    // create_file with a derived name (no path).
    const created = (await client.callTool({
      name: "create_file",
      arguments: { content: "# Meeting Notes\n\nbody\n" },
    })) as CallToolResult;
    expect(created.isError).toBeFalsy();
    expect(existsSync(path.join(workspace, "Meeting Notes.md"))).toBe(true);

    // append_to_file.
    await client.callTool({
      name: "append_to_file",
      arguments: { path: "doc.md", content: "\nappended.\n" },
    });
    expect(readFileSync(path.join(workspace, "doc.md"), "utf-8")).toContain(
      "appended.",
    );

    // rename_file moves the per-file image folder and rewrites references.
    const renamed = (await client.callTool({
      name: "rename_file",
      arguments: { oldPath: "doc.md", newPath: "report.md" },
    })) as CallToolResult;
    expect(renamed.isError).toBeFalsy();
    expect(existsSync(path.join(workspace, "report-md-images", "p.png"))).toBe(
      true,
    );
    expect(existsSync(path.join(workspace, "doc-md-images"))).toBe(false);
    expect(readFileSync(path.join(workspace, "report.md"), "utf-8")).toContain(
      "report-md-images/p.png",
    );

    // The file watcher fires list_changed when a new file appears on disk.
    let notified = 0;
    client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        notified++;
      },
    );
    writeFileSync(path.join(workspace, "external.md"), "# External\n");
    const deadline = Date.now() + 20_000;
    while (notified === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(notified).toBeGreaterThanOrEqual(1);
  } finally {
    await close();
    await rm(workspace, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  }
});
