import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// Force-set the active folder via the Electron userData directory so the app
// auto-loads our test workspace at startup (same approach as search.spec.ts).
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

// Seed a workspace with known content. "salmon" appears in alpha (once) and
// bravo (twice across two lines); "unicorn" appears only in charlie.
async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-gsearch-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nThe salmon swam upstream.\n",
  );
  await writeFile(
    path.join(dir, "bravo.md"),
    "# Bravo\n\nA salmon dinner.\n\nAnother salmon line here.\n",
  );
  await writeFile(
    path.join(dir, "charlie.md"),
    "# Charlie\n\nThe unicorn galloped away.\n",
  );
  await mkdir(path.join(dir, "notes"));
  await writeFile(
    path.join(dir, "notes", "todo.md"),
    "# Todo\n\nNothing special in here.\n",
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
  // The sidebar auto-opens with the seeded folder; wait for the tree.
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText("alpha.md")).toBeVisible();
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("header toggle opens the search panel and groups results by file", async () => {
  await window
    .locator('.sidebar-header [aria-label="Search in workspace"]')
    .click();

  const input = window.locator(".global-search-input");
  await expect(input).toBeVisible();

  await input.fill("salmon");

  // Two file headers render, with their match-count badges.
  await expect(
    window.locator(".global-search-file-path", { hasText: "alpha.md" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    window.locator(".global-search-file-path", { hasText: "bravo.md" }),
  ).toBeVisible();

  // bravo has two matches; three result lines total across both files.
  await expect(window.locator(".global-search-line")).toHaveCount(3);
  // Highlighted match spans built from ranges.
  await expect(
    window.locator(".global-search-highlight").first(),
  ).toHaveText("salmon");
});

test("clicking a result opens that file in the editor", async () => {
  await window
    .locator('.sidebar-header [aria-label="Search in workspace"]')
    .click();
  const input = window.locator(".global-search-input");
  await input.fill("unicorn");

  // Only charlie.md matches.
  const charlieResult = window
    .locator(".global-search-line", { hasText: "The unicorn galloped away." })
    .first();
  await expect(charlieResult).toBeVisible({ timeout: 5_000 });
  await charlieResult.click();

  // The file opens in the editor (content rendered in the ProseMirror view).
  await expect(window.locator(".ProseMirror")).toContainText("unicorn", {
    timeout: 5_000,
  });
});

test("Ctrl+Shift+F opens search and focuses the input", async () => {
  await window.keyboard.press("Control+Shift+F");
  const input = window.locator(".global-search-input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeFocused();
});
