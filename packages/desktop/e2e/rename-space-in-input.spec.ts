import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-rsi-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-rsi-ws-"));
  await writeFile(path.join(workspaceDir, "alpha.md"), "# Alpha\n");
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
    // ignore
  }
  try {
    if (app) await app.close();
  } catch {
    // ignore
  }
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

// User reported "can't add a space in the file name when adding a string to
// the end of the file name." This test types a name with spaces using real
// keystrokes (not .fill()) to make sure no global listener swallows them.
test("rename input accepts spaces typed via real keystrokes", async () => {
  const alphaPath = path.join(workspaceDir, "alpha.md").replace(/\\/g, "/");
  const alphaRow = window.locator(`[data-path="${alphaPath}"]`);
  await alphaRow.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Rename" })
    .click();
  const input = window.locator('input[aria-label="New name"]');
  await expect(input).toBeVisible();

  // Clear, then type a name with multiple spaces using real keystrokes.
  await input.press("Control+a");
  await input.press("Delete");
  await input.type("hello world example.md", { delay: 10 });

  expect(await input.inputValue()).toBe("hello world example.md");

  await input.press("Enter");

  // Wait for disk state
  await expect
    .poll(
      async () => {
        const entries = await readdir(workspaceDir);
        return entries.includes("hello world example.md") ? "renamed" : "pending";
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("renamed");
});
