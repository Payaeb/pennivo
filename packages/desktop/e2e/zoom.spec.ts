import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

async function getZoomLevel(): Promise<number> {
  return app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows();
    return wins[0]?.webContents.zoomLevel ?? 0;
  });
}

async function setZoomLevel(level: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, lvl) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins[0]) wins[0].webContents.zoomLevel = lvl;
  }, level);
}

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-zoom-"));
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
  await setZoomLevel(0);
});

test.afterEach(async () => {
  if (app) await app.close();
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("Ctrl+= zooms in", async () => {
  const before = await getZoomLevel();
  await window.keyboard.press("Control+=");
  await window.waitForTimeout(150);
  const after = await getZoomLevel();
  expect(after).toBeGreaterThan(before);
});

test("Ctrl+Shift+= (i.e. Ctrl++) zooms in", async () => {
  const before = await getZoomLevel();
  await window.keyboard.press("Control+Shift+=");
  await window.waitForTimeout(150);
  const after = await getZoomLevel();
  expect(after).toBeGreaterThan(before);
});

test("Ctrl+- zooms out", async () => {
  await setZoomLevel(1);
  const before = await getZoomLevel();
  await window.keyboard.press("Control+-");
  await window.waitForTimeout(150);
  const after = await getZoomLevel();
  expect(after).toBeLessThan(before);
});

test("Ctrl+0 resets zoom", async () => {
  await setZoomLevel(2);
  await window.keyboard.press("Control+0");
  await window.waitForTimeout(150);
  expect(await getZoomLevel()).toBe(0);
});

test("Ctrl+wheel up zooms in, Ctrl+wheel down zooms out", async () => {
  const start = await getZoomLevel();

  await window.evaluate(() => {
    window.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await window.waitForTimeout(150);
  const afterUp = await getZoomLevel();
  expect(afterUp).toBeGreaterThan(start);

  await window.evaluate(() => {
    window.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await window.waitForTimeout(150);
  const afterDown = await getZoomLevel();
  expect(afterDown).toBeLessThan(afterUp);
});

test("wheel without Ctrl does not change zoom", async () => {
  const before = await getZoomLevel();
  await window.evaluate(() => {
    window.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }),
    );
  });
  await window.waitForTimeout(150);
  expect(await getZoomLevel()).toBe(before);
});
