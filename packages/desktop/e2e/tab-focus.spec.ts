import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SHOT_DIR = process.env.PENNIVO_SHOT_DIR ?? "";

const DOC = ["- Alpha", "- Beta", "- Gamma", "  - Gamma child", ""].join("\n");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

test.beforeAll(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-tabfocus-ws-"));
  await writeFile(path.join(workspaceDir, "tabfocus.md"), DOC, "utf-8");
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-tabfocus-ud-"));
  await writeFile(
    path.join(userDataDir, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
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
  await window.locator('.tree-item[title$="tabfocus.md"]').click();
  await expect(window.locator(".ProseMirror")).toContainText("Gamma child", {
    timeout: 10_000,
  });
  await window.waitForTimeout(3500);
});

test.afterAll(async () => {
  // The edited document may raise an unsaved-changes prompt on close; do not
  // hang on it.
  await Promise.race([app?.close(), new Promise((r) => setTimeout(r, 5000))]);
  try {
    app?.process().kill();
  } catch {
    // already closed
  }
  await rm(workspaceDir, { recursive: true, force: true });
  await rm(userDataDir, { recursive: true, force: true });
});

const focusInsideEditor = () =>
  window.evaluate(() => {
    const ae = document.activeElement;
    return !!ae && !!ae.closest(".ProseMirror");
  });

// Regression: Tab with the caret in a bullet that cannot be indented used to
// fall through to the browser's focus traversal and land on the status bar's
// "Streaming animation" checkbox.
test("Tab never moves focus out of the editor when indent is impossible", async () => {
  const pm = window.locator(".ProseMirror");
  const docText = () => pm.innerText();
  const before = await docText();
  const firstBullet = pm.locator("li > p", { hasText: "Alpha" }).first();

  // ProseMirror syncs the DOM selection a beat after a click.
  await firstBullet.click();
  await window.waitForTimeout(300);
  await window.keyboard.press("Tab");
  expect(await focusInsideEditor()).toBe(true);
  expect(await docText()).toBe(before);
  expect(await pm.locator("li li").count()).toBe(1); // only Gamma child

  // The caret was never lost: typing still lands in the document.
  await window.keyboard.type("x");
  await expect(firstBullet).toContainText("Alphax");
  await window.keyboard.press("Backspace");
  await expect(firstBullet).toHaveText("Alpha");

  // Nested first child (Gamma child) cannot sink either.
  await pm.locator("li li p", { hasText: "Gamma child" }).click();
  await window.waitForTimeout(300);
  await window.keyboard.press("Tab");
  expect(await focusInsideEditor()).toBe(true);
  expect(await pm.locator("li li").count()).toBe(1);

  // An indent that IS possible still works: Beta nests under Alpha.
  await pm.locator("li > p", { hasText: "Beta" }).first().click();
  await window.waitForTimeout(300);
  await window.keyboard.press("Tab");
  await expect(pm.locator("li li p", { hasText: "Beta" })).toHaveCount(1);
  expect(await focusInsideEditor()).toBe(true);
  await window.keyboard.press("Shift+Tab");
  await expect(pm.locator("li li p", { hasText: "Beta" })).toHaveCount(0);
  expect(await focusInsideEditor()).toBe(true);

  // After clicking a collapse chevron (a widget), Tab must not escape either.
  await window.locator(".collapse-toggle").first().click();
  await window.keyboard.press("Tab");
  expect(await focusInsideEditor()).toBe(true);
});
