import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
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
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-scope-"));
  await writeFile(
    path.join(dir, "one.md"),
    [
      "# One",
      "",
      "- [ ] Alpha task #alphalabel",
      "- [ ] Alpha second #alphalabel",
      "- Alpha idea #alphaidea",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(dir, "two.md"),
    ["# Two", "", "- [ ] Beta task #betalabel", ""].join("\n"),
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
  await expect(window.getByText("one.md")).toBeVisible();
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

async function openFromTree(name: string) {
  const toggle = window.locator('.sidebar-header [aria-label="Tasks"]');
  await toggle.click();
  await window.locator(`.tree-item[title$="${name}"]`).click();
  await expect(window.getByRole("banner")).toContainText(name);
  await expect(window.locator(".ProseMirror")).toContainText(
    name === "one.md" ? "Alpha task" : "Beta task",
  );
  await window.waitForTimeout(3500); // switching files right after an open is ignored by the app until it settles
  await toggle.click();
  await expect(window.locator(".tasks-panel")).toBeVisible();
}

const item = (page: Page, text: string) =>
  page.locator(".tasks-panel-item", { hasText: text });

test("scope toggle: disabled with no file, follows the open file, returns to all", async () => {
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();
  await expect(window.locator(".tasks-panel")).toBeVisible();

  const group = window.locator(".tasks-panel-scope");
  await expect(group).toHaveAttribute("role", "radiogroup");
  const allBtn = group.getByRole("radio", { name: "All files" });
  const fileBtn = group.getByRole("radio", { name: "This file" });
  await expect(fileBtn).toBeDisabled();
  await expect(fileBtn).toHaveAttribute("title", "Open a file to focus on it");
  await expect(allBtn).toHaveAttribute("aria-checked", "true");
  await expect(item(window, "Alpha task")).toBeVisible();
  await expect(item(window, "Beta task")).toBeVisible();

  // The rail shows the Tasks panel instead of the tree: toggle back to the
  // tree, open file one, and reopen the panel.
  await openFromTree("one.md");
  await expect(fileBtn).toBeEnabled({ timeout: 5_000 });
  await fileBtn.click();
  await expect(fileBtn).toHaveAttribute("aria-checked", "true");
  await expect(allBtn).toHaveAttribute("aria-checked", "false");
  await expect(item(window, "Alpha task")).toBeVisible();
  await expect(item(window, "Alpha second")).toBeVisible();
  await expect(item(window, "Beta task")).toHaveCount(0);

  if (SHOT_DIR) {
    await window.screenshot({
      path: `${SHOT_DIR}/tasks-scope-file-tasks-${await themeName()}.png`,
    });
  }

  // Labels tab is scoped too: chips and groups.
  await window.getByRole("tab", { name: "Labels" }).click();
  const chips = window.locator(".tasks-panel-label-chip");
  await expect(chips.filter({ hasText: "alphalabel" })).toHaveCount(1);
  await expect(chips.filter({ hasText: "alphaidea" })).toHaveCount(1);
  await expect(chips.filter({ hasText: "betalabel" })).toHaveCount(0);
  await expect(item(window, "Alpha idea")).toBeVisible();
  await expect(item(window, "Beta task")).toHaveCount(0);

  // Scope follows the active file. Opening a file from the tree remounts the
  // panel (scope resets to "All files" on remount), so switch files from
  // inside the panel instead: go to All files, click a task in file two,
  // then re-engage the file scope.
  await allBtn.click();
  await window.getByRole("tab", { name: "Tasks" }).click();
  await item(window, "Beta task").click();
  await window.waitForTimeout(3000);
  await expect(window.getByRole("banner")).toContainText("two.md");
  await expect(window.locator(".tasks-panel")).toBeVisible();
  await fileBtn.click();
  await window.getByRole("tab", { name: "Labels" }).click();
  await expect(chips.filter({ hasText: "betalabel" })).toHaveCount(1);
  await expect(chips.filter({ hasText: "alphalabel" })).toHaveCount(0);
  await window.getByRole("tab", { name: "Tasks" }).click();
  await expect(item(window, "Beta task")).toBeVisible();
  await expect(item(window, "Alpha task")).toHaveCount(0);

  // Back to all files.
  await allBtn.click();
  await expect(allBtn).toHaveAttribute("aria-checked", "true");
  await expect(item(window, "Alpha task")).toBeVisible();
  await expect(item(window, "Beta task")).toBeVisible();
});

test("scope persists across closing and reopening the Tasks rail", async () => {
  const tasksBtn = window.locator('.sidebar-header [aria-label="Tasks"]');
  await tasksBtn.click(); // openFromTree expects to start from the Tasks rail
  await expect(window.locator(".tasks-panel")).toBeVisible();
  await openFromTree("one.md");
  const fileBtn = window
    .locator(".tasks-panel-scope")
    .getByRole("radio", { name: "This file" });
  await expect(fileBtn).toBeEnabled({ timeout: 5_000 });
  await fileBtn.click();
  await expect(fileBtn).toHaveAttribute("aria-checked", "true");

  await tasksBtn.click();
  await expect(window.locator(".tasks-panel")).toHaveCount(0);
  await tasksBtn.click();
  await expect(window.locator(".tasks-panel")).toBeVisible();

  await expect(fileBtn).toHaveAttribute("aria-checked", "true");
  await expect(item(window, "Alpha task")).toBeVisible();
  await expect(item(window, "Beta task")).toHaveCount(0);
});
