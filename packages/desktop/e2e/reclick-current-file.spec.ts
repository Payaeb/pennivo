import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-reclick-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-reclick-ws-"));
  await writeFile(path.join(workspaceDir, "alpha.md"), "# Alpha\n\nstart.\n");
  userDataDir = await seedUserData(workspaceDir);
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env,
    timeout: 30_000,
  });
  window = await app.firstWindow();
  await window.waitForSelector(".sidebar", { timeout: 20_000 });
});

test.afterEach(async () => {
  // The test leaves the editor in a dirty state (unsaved sentinel text). The
  // main process blocks `app.close()` on the unsaved-changes prompt; destroy
  // each window directly to bypass the prompt, then quit.
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.destroy();
        } catch {
          // ignore
        }
      }
    });
  } catch {
    // app may be gone already
  }
  try {
    if (app) await app.close();
  } catch {
    // ignore
  }
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

// Regression guard for the image-disappears-on-reclick bug. Repro: the user
// pastes an image into a file (autosave is debounced 3s, so the disk doesn't
// have the image ref yet) and clicks the same file in the sidebar. The old
// behavior re-read the file from disk and silently dropped the in-flight
// in-memory changes — image vanished from the editor even though the image
// file was still saved on disk. Fix: clicking the file you're already on is
// a no-op.
test("clicking the currently-open file in the sidebar does not reload and drop unsaved edits", async () => {
  // Open alpha.md by clicking it in the sidebar
  await window.getByText("alpha.md").first().click();
  await window.waitForSelector(".ProseMirror", { timeout: 10_000 });

  // Type a sentinel string into the editor — represents an unsaved edit
  const editor = window.locator(".ProseMirror").first();
  await editor.click();
  // Move to end of doc and add a new line
  await window.keyboard.press("Control+End");
  await window.keyboard.press("Enter");
  const SENTINEL = "UNSAVED-EDIT-MUST-SURVIVE-RECLICK";
  await window.keyboard.type(SENTINEL);

  await expect(editor).toContainText(SENTINEL, { timeout: 2_000 });

  // Click the same file in the sidebar
  await window.getByText("alpha.md").first().click();

  // Give any reload a moment to fire if it's going to
  await window.waitForTimeout(500);

  // The sentinel should still be there — the click should have been a no-op.
  await expect(editor).toContainText(SENTINEL);
});
