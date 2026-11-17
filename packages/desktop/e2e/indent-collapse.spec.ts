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
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-indent-ws-"));
  await writeFile(path.join(workspaceDir, "indent.md"), DOC, "utf-8");
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-indent-ud-"));
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
  await window.locator('.tree-item[title$="indent.md"]').click();
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

test("Enter + Tab on a middle bullet keeps the new bullet visible", async () => {
  // User collapses Gamma (a later item) first.
  await window.locator(".collapse-toggle").first().click();
  await expect(window.locator(".list-item--collapsed")).toHaveCount(1);

  // Middle bullet: caret at end of Alpha, Enter, Tab, type.
  await window.waitForTimeout(300);
  await window.keyboard.press("Control+Home");
  await window.keyboard.press("End");
  await window.keyboard.press("Enter");
  await window.keyboard.press("Tab");
  await window.keyboard.type("Nested new");

  const nested = window.locator(".ProseMirror li li p", {
    hasText: "Nested new",
  });
  await expect(nested).toBeVisible();
  // Only Gamma stays collapsed; Alpha (the new parent) is expanded.
  const collapsed = window.locator(".list-item--collapsed");
  await expect(collapsed).toHaveCount(1);
  await expect(collapsed.first()).toContainText("Gamma");
  if (SHOT_DIR) {
    await window.screenshot({
      path: path.join(SHOT_DIR, "indent-collapse.png"),
    });
  }
});
