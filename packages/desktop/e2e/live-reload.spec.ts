// E2E coverage for Phase 12d-pre: live-reload the open document on external
// change. When the file open in Pennivo is changed on disk by an external
// writer (Claude via MCP write_file, another editor, a sync client):
//   - no unsaved edits  → the editor reloads the new content in place;
//   - unsaved edits      → an amber conflict toast offers Compare & merge
//                          instead of clobbering the user's work.
//
// Substitutes for visual UAT against the real Electron host (Chrome MCP is not
// available in this environment).

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-livereload-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nbaseline body.\n",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-livereload-ud-"));
  // Point the sidebar at the workspace so the recursive folderWatcher covers it.
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

// Open via the sidebar UI (not the raw preload bridge) so the React app runs
// its open flow — which reports the open path to the main process so the
// watcher knows which file to live-reload.
async function openViaSidebar(window: Page, filename: string): Promise<void> {
  await window
    .locator(".tree-item", { hasText: filename })
    .first()
    .click();
  await window.waitForFunction(
    () => document.querySelector(".ProseMirror") !== null,
    { timeout: 10_000 },
  );
}

// Wait until the baseline snapshot has been taken for the open file, so a
// subsequent external write is classified as `external` (not `first-seen`).
async function waitForBaselineSnapshot(
  window: Page,
  filePath: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const list = await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath);
    if (Array.isArray(list) && list.length >= 1) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("baseline snapshot never appeared");
}

let app: ElectronApplication | null = null;
let workspaceDir = "";
let userDataDir = "";

async function setup(): Promise<{ app: ElectronApplication; window: Page }> {
  workspaceDir = await makeWorkspace();
  userDataDir = await makeUserData(workspaceDir);
  const launched = await launchApp(userDataDir);
  app = launched.app;
  return launched;
}

test.afterEach(async () => {
  if (app) {
    // The dirty-conflict test deliberately leaves the editor with unsaved
    // edits, which makes the main process show a native "Unsaved Changes"
    // dialog on close — blocking app.close(). Neutralize it to "Don't Save".
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBox = (async () => ({
          response: 1,
          checkboxChecked: false,
        })) as typeof dialog.showMessageBox;
      })
      .catch(() => {});
    await app.close();
    app = null;
  }
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("clean: external write to the open file reloads the editor in place", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await openViaSidebar(window, "alpha.md");
  await expect(window.locator(".ProseMirror")).toContainText("baseline body");
  await waitForBaselineSnapshot(window, filePath);

  // Simulate Claude (or any external writer) overwriting the open file.
  await writeFile(
    filePath,
    "# Alpha\n\nrewritten by an external writer.\n",
    "utf-8",
  );

  // The editor swaps to the new content with no manual re-open.
  await expect(window.locator(".ProseMirror")).toContainText(
    "rewritten by an external writer",
    { timeout: 10_000 },
  );
  await expect(window.locator(".ProseMirror")).not.toContainText(
    "baseline body",
  );

  // Clean reload → no conflict toast.
  await expect(window.locator(".external-change-toast")).toHaveCount(0);
});

test("dirty: external write surfaces a conflict toast → Compare & merge", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await openViaSidebar(window, "alpha.md");
  await waitForBaselineSnapshot(window, filePath);

  // Make an in-app edit so the document has unsaved changes.
  await window.locator(".ProseMirror").click();
  await window.keyboard.type(" my unsaved sentence");
  await expect(window.locator(".status-save--unsaved")).toBeVisible({
    timeout: 5000,
  });

  // External writer overwrites the file while we have unsaved edits.
  await writeFile(
    filePath,
    "# Alpha\n\nchanged on disk under the user.\n",
    "utf-8",
  );

  // We must NOT clobber — instead, the conflict toast appears.
  const toast = window.locator(".external-change-toast");
  await expect(toast).toBeVisible({ timeout: 10_000 });
  await expect(window.locator(".external-change-toast-message")).toContainText(
    /unsaved edits/i,
  );
  // The user's in-app text is still in the editor (not clobbered).
  await expect(window.locator(".ProseMirror")).toContainText(
    "my unsaved sentence",
  );

  // Clicking Compare & merge opens the Phase 13a merge view.
  await window
    .locator(".external-change-toast-btn", { hasText: /Compare & merge/i })
    .click();
  await expect(window.locator(".compare-merge-view")).toBeVisible({
    timeout: 10_000,
  });
  await expect(window.locator(".recovery-modal-title")).toContainText(
    "Compare & merge",
  );
});
