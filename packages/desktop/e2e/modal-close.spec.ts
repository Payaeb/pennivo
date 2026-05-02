import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-modal-"));
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
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
});

test.afterEach(async () => {
  if (app) await app.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

// Regression guard: when modal overlays render across the top 36px of the
// window, Electron's titlebar drag-region was swallowing clicks. The fix is
// `-webkit-app-region: no-drag` on each overlay. This test opens Settings,
// clicks the X (which sits inside the former drag zone), and verifies the
// panel closes.
test("Settings close button closes the panel even though it overlaps the titlebar drag zone", async () => {
  // Open via the command palette so we don't depend on titlebar UI layout.
  await window.keyboard.press("Control+Shift+P");
  await window.waitForSelector(".command-palette", { timeout: 3000 });
  await window.keyboard.type("settings");
  await window.keyboard.press("Enter");

  const closeBtn = window.locator(".settings-close-btn");
  await expect(closeBtn).toBeVisible({ timeout: 3000 });

  // Confirm the button geometry does straddle the titlebar drag zone (top 36px).
  // If this assertion ever fails because layout changed, the test premise is
  // gone and the assertion below isn't proving what we think it's proving.
  const box = await closeBtn.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThan(36);

  await closeBtn.click();
  await expect(window.locator(".settings-overlay")).toHaveCount(0, {
    timeout: 2000,
  });
});

test("Shortcuts sheet close button closes the sheet", async () => {
  await window.keyboard.press("Control+Shift+P");
  await window.waitForSelector(".command-palette", { timeout: 3000 });
  await window.keyboard.type("shortcuts");
  await window.keyboard.press("Enter");

  await expect(window.locator(".shortcuts-overlay")).toBeVisible({
    timeout: 3000,
  });
  await window.locator(".shortcuts-close-btn").click();
  await expect(window.locator(".shortcuts-overlay")).toHaveCount(0, {
    timeout: 2000,
  });
});

test("About dialog close button closes the dialog", async () => {
  await window.keyboard.press("Control+Shift+P");
  await window.waitForSelector(".command-palette", { timeout: 3000 });
  await window.keyboard.type("about");
  await window.keyboard.press("Enter");

  await expect(window.locator(".about-overlay")).toBeVisible({ timeout: 3000 });
  await window.locator(".about-close").click();
  await expect(window.locator(".about-overlay")).toHaveCount(0, {
    timeout: 2000,
  });
});
