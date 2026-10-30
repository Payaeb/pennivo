import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
// Optional: set PENNIVO_SHOT_DIR to also save screenshots for visual review.
const SHOT_DIR = process.env.PENNIVO_SHOT_DIR ?? "";

async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-collapse-"));
  await writeFile(path.join(dir, "root.md"), "# Root\n\nroot file.\n");
  await mkdir(path.join(dir, "outer", "inner"), { recursive: true });
  await writeFile(path.join(dir, "outer", "outer-file.md"), "# Outer\n");
  await writeFile(
    path.join(dir, "outer", "inner", "deep.md"),
    "# Deep\n\ndeep file.\n",
  );
  return dir;
}

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

test.beforeEach(async () => {
  workspaceDir = await makeWorkspace();
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
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText("root.md")).toBeVisible();
  if (process.env.PENNIVO_THEME) {
    await window.evaluate(
      (t) => document.documentElement.setAttribute("data-theme", t),
      process.env.PENNIVO_THEME,
    );
  }
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

const themeName = () =>
  window.evaluate(
    () => document.documentElement.getAttribute("data-theme") ?? "unknown",
  );

test("collapse all clears every expanded folder and keeps the selected file", async () => {
  test.setTimeout(150_000);
  const btn = window.locator(".sidebar-collapse-all-btn");
  const rootFile = window.locator('.tree-item[title$="root.md"]');
  const folder = (name: string) =>
    window.locator(".tree-item[aria-expanded]", {
      has: window.locator(".tree-item-name", {
        hasText: new RegExp(`^${name}$`),
      }),
    });

  await expect(btn).toHaveAttribute("aria-label", "Collapse all folders");
  await expect(btn).toHaveAttribute("title", "Collapse all folders");

  // Top-level folders are expanded by default, so the button starts enabled.
  await expect(window.getByText("outer-file.md")).toBeVisible();
  await expect(btn).toBeEnabled();

  // Select a root file, then expand the nested folder.
  await rootFile.click();
  await expect(rootFile).toHaveClass(/tree-item--active/);
  await folder("inner").click();
  await expect(window.getByText("deep.md")).toBeVisible();

  if (SHOT_DIR) {
    await window.locator(".sidebar-header").screenshot({
      path: `${SHOT_DIR}/collapse-all-enabled-${await themeName()}.png`,
    });
  }

  await btn.click();

  await expect(window.getByText("deep.md")).toHaveCount(0);
  await expect(window.getByText("outer-file.md")).toHaveCount(0);
  await expect(window.getByText("inner", { exact: true })).toHaveCount(0);
  await expect(
    window.locator('.tree-item[aria-expanded="true"]'),
  ).toHaveCount(0);
  await expect(btn).toBeDisabled();

  if (SHOT_DIR) {
    await window.locator(".sidebar-header").screenshot({
      path: `${SHOT_DIR}/collapse-all-disabled-${await themeName()}.png`,
    });
  }

  // Selected file remains selected.
  await expect(rootFile).toHaveClass(/tree-item--active/);

  // Expansion survives a rail-mode round trip (tasks and back).
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();
  await expect(
    window.locator('.tree-item[aria-expanded="true"]'),
  ).toHaveCount(0);
  await expect(btn).toBeDisabled();

  // Re-expanding re-enables it.
  await folder("outer").click();
  await expect(btn).toBeEnabled();
});
