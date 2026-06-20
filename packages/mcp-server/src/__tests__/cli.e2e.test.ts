import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { build } from "esbuild";
import { spawnSync, spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// Real end-to-end: spawn the BUILT CLI as a separate Node process and drive it
// with a genuine MCP client. The bundle is produced fresh in beforeAll so this
// runs as part of `pnpm test` with no external build step.

const PKG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const CLI = path.join(PKG_DIR, "dist", "bin", "cli.js");

const SENTINEL = "AUDIT-LEAK-CANARY-91x";

// These tests spawn real child processes and (for the watcher) wait on
// fs.watch, which is timing-sensitive under CPU load. Give them generous
// headroom so a busy machine doesn't produce false failures.
vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  await build({
    entryPoints: [path.join(PKG_DIR, "src/bin/cli.ts")],
    outfile: CLI,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    external: [
      "@modelcontextprotocol/sdk",
      "@modelcontextprotocol/sdk/*",
      "zod",
      "zod/*",
    ],
    banner: { js: "#!/usr/bin/env node" },
    logLevel: "silent",
    allowOverwrite: true,
  });
}, 30_000);

function seed(): { workspace: string; userData: string } {
  const workspace = mkdtempSync(path.join(tmpdir(), "pennivo-cli-ws-"));
  const userData = mkdtempSync(path.join(tmpdir(), "pennivo-cli-ud-"));
  writeFileSync(path.join(workspace, "hello.md"), `# Hello\n\n${SENTINEL}\n`);
  return { workspace, userData };
}

function writeSettings(file: string, writeEnabled: boolean): void {
  writeFileSync(
    file,
    JSON.stringify({
      mcp: {
        enabled: true,
        tools: {
          list_files: true,
          read_file: true,
          search: true,
          write_file: writeEnabled,
          create_file: false,
          append_to_file: false,
          delete_file: false,
          rename_file: false,
        },
      },
    }),
  );
}

async function connectStdio(
  args: string[],
): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, ...args],
  });
  const client = new Client({ name: "cli-e2e", version: "0.0.0" });
  await client.connect(transport);
  return { client, close: () => client.close() };
}

describe("CLI argument handling (exit codes)", () => {
  it("exits 2 with no --workspace", () => {
    const r = spawnSync(process.execPath, [CLI], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/workspace/i);
  });

  it("exits 2 for a non-existent workspace", () => {
    const r = spawnSync(
      process.execPath,
      [CLI, "--workspace", path.join(tmpdir(), "definitely-not-here-zzz")],
      { encoding: "utf8", timeout: 15_000 },
    );
    expect(r.status).toBe(2);
  });

  it("prints version and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "--version"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("prints help and exits 0", () => {
    const r = spawnSync(process.execPath, [CLI, "--help"], {
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/--workspace/);
    expect(r.stdout).toMatch(/--settings/);
  });
});

describe("CLI over stdio (real process)", () => {
  let workspace: string;
  let userData: string;

  beforeEach(() => {
    ({ workspace, userData } = seed());
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  });

  it("serves read tools and denies writes under read-only defaults", async () => {
    const { client, close } = await connectStdio(["--workspace", workspace]);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining(["read_file", "write_file"]),
      );

      const read = (await client.callTool({
        name: "read_file",
        arguments: { path: "hello.md" },
      })) as CallToolResult;
      expect((read.content[0] as { text: string }).text).toContain(SENTINEL);

      const denied = (await client.callTool({
        name: "write_file",
        arguments: { path: "x.md", content: "x" },
      })) as CallToolResult;
      expect(denied.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("--allow enables a specific write tool", async () => {
    const { client, close } = await connectStdio([
      "--workspace",
      workspace,
      "--allow",
      "write_file",
    ]);
    try {
      const w = (await client.callTool({
        name: "write_file",
        arguments: { path: "new.md", content: "# New\n" },
      })) as CallToolResult;
      expect(w.isError).toBeFalsy();
      expect(existsSync(path.join(workspace, "new.md"))).toBe(true);
    } finally {
      await close();
    }
  });

  it("--settings is re-read live: a toggle takes effect WITHOUT restarting the server", async () => {
    const settingsFile = path.join(userData, "settings.json");
    writeSettings(settingsFile, /* writeEnabled */ false);
    const { client, close } = await connectStdio([
      "--workspace",
      workspace,
      "--settings",
      settingsFile,
    ]);
    try {
      const before = (await client.callTool({
        name: "write_file",
        arguments: { path: "live.md", content: "# Live\n" },
      })) as CallToolResult;
      expect(before.isError).toBe(true); // denied

      // Flip the setting on disk while the server keeps running.
      writeSettings(settingsFile, /* writeEnabled */ true);

      const after = (await client.callTool({
        name: "write_file",
        arguments: { path: "live.md", content: "# Live\n" },
      })) as CallToolResult;
      expect(after.isError).toBeFalsy(); // allowed now, no restart
      expect(existsSync(path.join(workspace, "live.md"))).toBe(true);
    } finally {
      await close();
    }
  });

  it("enforces the workspace boundary over the process boundary", async () => {
    const { client, close } = await connectStdio([
      "--workspace",
      workspace,
      "--allow",
      "write_file",
    ]);
    try {
      const escape = (await client.callTool({
        name: "read_file",
        arguments: { path: "../../etc/hosts" },
      })) as CallToolResult;
      expect(escape.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("emits resources/list_changed when a file appears in the workspace", async () => {
    const { client, close } = await connectStdio(["--workspace", workspace]);
    try {
      let notified = 0;
      client.setNotificationHandler(
        ResourceListChangedNotificationSchema,
        async () => {
          notified++;
        },
      );
      writeFileSync(path.join(workspace, "fresh.md"), "# Fresh\n");
      // Allow fs.watch + the 200ms debounce to fire (generous for CPU load).
      const deadline = Date.now() + 20_000;
      while (notified === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(notified).toBeGreaterThanOrEqual(1);
    } finally {
      await close();
    }
  });

  it("--audit-log records only workspace-relative paths and never file content", async () => {
    const auditFile = path.join(userData, "audit.jsonl");
    const { client, close } = await connectStdio([
      "--workspace",
      workspace,
      "--audit-log",
      auditFile,
      "--allow",
      "write_file",
    ]);
    try {
      await client.callTool({
        name: "read_file",
        arguments: { path: "hello.md" },
      });
      await client.callTool({
        name: "write_file",
        arguments: { path: "copy.md", content: `# Copy\n\n${SENTINEL}\n` },
      });
      await client.callTool({
        name: "read_file",
        arguments: { path: "../../etc/hosts" },
      });
    } finally {
      await close();
    }
    const lines = readFileSync(auditFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const events = lines.map(
      (l) => JSON.parse(l) as { path?: string; detail?: string },
    );
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      if (e.path !== undefined) {
        // Never an ABSOLUTE path (a rejected traversal is logged verbatim as a
        // relative `../…` for forensics — that's intended, not a leak).
        expect(e.path).not.toMatch(/^[/\\]/);
        expect(e.path).not.toMatch(/[A-Za-z]:[\\/]/);
      }
    }
    // The written content never lands in the audit log.
    expect(readFileSync(auditFile, "utf8")).not.toContain(SENTINEL);
    // The workspace's absolute path is never leaked in any detail.
    expect(readFileSync(auditFile, "utf8")).not.toContain(workspace);
  });
});

describe("CLI --stream (real process)", () => {
  let workspace: string;
  let userData: string;

  beforeEach(() => {
    ({ workspace, userData } = seed());
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  });

  // Spawn the CLI in stream mode, feed stdin in two writes with a small gap so
  // the file grows progressively, close stdin, and resolve on exit.
  function streamInto(
    into: string | undefined,
    chunks: string[],
  ): Promise<{ status: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const args = [CLI, "--workspace", workspace, "--stream"];
      if (into) args.push("--into", into);
      const child = spawn(process.execPath, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout!.on("data", (d) => (stdout += d.toString()));
      child.stderr!.on("data", (d) => (stderr += d.toString()));
      child.on("error", reject);
      child.on("exit", (code) =>
        resolve({ status: code ?? -1, stdout, stderr }),
      );

      // Write chunks with a brief delay between them, then end stdin.
      let i = 0;
      const writeNext = (): void => {
        if (i < chunks.length) {
          child.stdin!.write(chunks[i++]);
          setTimeout(writeNext, 60);
        } else {
          child.stdin!.end();
        }
      };
      writeNext();
    });
  }

  it("appends piped stdin into --into and exits 0", async () => {
    const r = await streamInto("note.md", [
      "# Streamed note\n\n",
      "line one\n",
      "line two\n",
    ]);
    expect(r.status).toBe(0);
    const target = path.join(workspace, "note.md");
    expect(existsSync(target)).toBe(true);
    const content = readFileSync(target, "utf8");
    expect(content).toContain("# Streamed note");
    expect(content).toContain("line one");
    expect(content).toContain("line two");
  });

  it("encodes image-url spaces in streamed content", async () => {
    const r = await streamInto("img.md", [
      "![a](./img-md-images/my photo.png)\n",
    ]);
    expect(r.status).toBe(0);
    expect(readFileSync(path.join(workspace, "img.md"), "utf8")).toContain(
      "my%20photo.png",
    );
  });

  it("derives a filename from content when --into is omitted", async () => {
    const r = await streamInto(undefined, [
      "# Derived Title\n\n",
      "body content here\n",
    ]);
    expect(r.status).toBe(0);
    // The chosen filename is printed to stdout and the file exists on disk.
    const chosen = r.stdout.trim();
    expect(chosen).toBe("Derived Title.md");
    expect(existsSync(path.join(workspace, "Derived Title.md"))).toBe(true);
    expect(
      readFileSync(path.join(workspace, "Derived Title.md"), "utf8"),
    ).toContain("body content here");
  });

  it("rejects an --into target outside the workspace (exit 2)", async () => {
    const r = await streamInto("../escape.md", ["malicious\n"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/outside the workspace/i);
    expect(existsSync(path.join(path.dirname(workspace), "escape.md"))).toBe(
      false,
    );
  });
});

describe("CLI over loopback HTTP (real process)", () => {
  let workspace: string;
  let userData: string;
  let child: ChildProcess | null = null;

  beforeEach(() => {
    ({ workspace, userData } = seed());
  });
  afterEach(() => {
    if (child) child.kill();
    child = null;
    rmSync(workspace, { recursive: true, force: true });
    rmSync(userData, { recursive: true, force: true });
  });

  it("serves MCP over an ephemeral loopback HTTP port", async () => {
    child = spawn(
      process.execPath,
      [CLI, "--workspace", workspace, "--http", "--port", "0"],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    // The chosen URL is printed to stderr.
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("server did not report a URL")),
        15_000,
      );
      let buf = "";
      child!.stderr!.on("data", (d) => {
        buf += d.toString();
        const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/);
        if (m) {
          clearTimeout(timer);
          resolve(m[0]);
        }
      });
      child!.on("exit", () => {
        clearTimeout(timer);
        reject(new Error("server exited before reporting a URL"));
      });
    });

    const client = new Client({ name: "cli-http-e2e", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("read_file");
      const read = (await client.callTool({
        name: "read_file",
        arguments: { path: "hello.md" },
      })) as CallToolResult;
      expect((read.content[0] as { text: string }).text).toContain(SENTINEL);
    } finally {
      await client.close();
    }
  });
});
