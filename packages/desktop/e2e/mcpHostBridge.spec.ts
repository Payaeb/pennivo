// E2E tests for the MCP host control bridge (A4b), against real Electron.
//
// The app starts a loopback HTTP control endpoint on launch and writes its url
// + per-run token to `${userData}/mcp-host-bridge.json`. These tests read that
// descriptor and exercise the security boundary + a real snapshot/list call:
//   - an authorized POST /snapshot/list returns 200 with a snapshots array
//   - an UNauthorized POST (no/garbage token) returns 401
//   - a POST with a non-loopback Host header returns 403 (DNS-rebinding guard)
//
// The bridge forwards to the same snapshotStore/trashStore the IPC handlers use,
// so a 200 here proves the end-to-end path the spawned MCP server relies on.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-bridge-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nfirst version.\n",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-bridge-ud-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  return env;
}

async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env: buildEnv(),
    timeout: 30_000,
  });
  const window = await app.firstWindow();
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
  return { app, window };
}

interface Descriptor {
  url: string;
  token: string;
}

async function readDescriptor(userData: string): Promise<Descriptor> {
  const descPath = path.join(userData, "mcp-host-bridge.json");
  // The descriptor is written asynchronously once the server `listen` callback
  // fires; poll briefly for it.
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const raw = await readFile(descPath, "utf-8");
      const parsed = JSON.parse(raw) as Descriptor;
      if (parsed.url && parsed.token) return parsed;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("bridge descriptor never appeared");
}

test.describe("MCP host control bridge", () => {
  let app: ElectronApplication | undefined;
  let workspace: string;
  let userData: string;

  test.beforeEach(async () => {
    workspace = await makeWorkspace();
    userData = await makeUserData(workspace);
    const launched = await launchApp(userData);
    app = launched.app;
  });

  test.afterEach(async () => {
    if (app) await app.close();
    app = undefined;
    await rm(workspace, { recursive: true, force: true }).catch(() => {});
    await rm(userData, { recursive: true, force: true }).catch(() => {});
  });

  test("authorized POST /snapshot/list returns 200", async () => {
    const desc = await readDescriptor(userData);
    const res = await fetch(`${desc.url}/snapshot/list`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${desc.token}`,
      },
      body: JSON.stringify({ absPath: path.join(workspace, "alpha.md") }),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { snapshots: unknown[] };
    expect(Array.isArray(data.snapshots)).toBe(true);
  });

  test("unauthorized POST returns 401", async () => {
    const desc = await readDescriptor(userData);
    const noToken = await fetch(`${desc.url}/snapshot/list`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ absPath: path.join(workspace, "alpha.md") }),
    });
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`${desc.url}/snapshot/list`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer not-the-real-token",
      },
      body: JSON.stringify({ absPath: path.join(workspace, "alpha.md") }),
    });
    expect(badToken.status).toBe(401);
  });

  test("non-loopback Host header is rejected (403)", async () => {
    const desc = await readDescriptor(userData);
    const res = await fetch(`${desc.url}/snapshot/list`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${desc.token}`,
        // Spoof a rebound attacker domain — the bridge must reject it even with
        // a valid token, before doing any work.
        host: "evil.example.com",
      },
      body: JSON.stringify({ absPath: path.join(workspace, "alpha.md") }),
    });
    expect(res.status).toBe(403);
  });
});
