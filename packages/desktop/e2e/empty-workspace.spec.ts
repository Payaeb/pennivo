import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// Force-set the sidebar folder via the Electron userData directory so the app
// auto-loads our test workspace at startup. Mirrors sidebar.spec.ts.
async function seedUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-userdata-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

// The opposite of makeWorkspace(): a real workspace folder with NO markdown
// files (and no subfolders). The sidebar should render its empty-state with
// inline "New File" / "New Folder" affordances so the very first entry can be
// created at the workspace root. Before the Phase 11g fix this was a dead end.
async function makeEmptyWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pennivo-e2e-empty-ws-"));
}

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

test.beforeEach(async () => {
  workspaceDir = await makeEmptyWorkspace();
  userDataDir = await seedUserData(workspaceDir);
  // Strip ELECTRON_RUN_AS_NODE — when set, Electron runs as plain Node and
  // rejects Chromium flags. Same as the other e2e specs.
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
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("empty workspace shows the empty-state with New File / New Folder affordances", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // The empty-state container renders because the tree is empty but a folder is
  // configured.
  const empty = window.locator(".sidebar-empty");
  await expect(empty).toBeVisible({ timeout: 5_000 });
  await expect(window.getByText("No markdown files yet")).toBeVisible();

  // Both create affordances are present (the heart of the fix).
  const buttons = window.locator(".sidebar-empty-create-btn");
  await expect(buttons).toHaveCount(2, { timeout: 5_000 });
  await expect(
    buttons.filter({ hasText: "New File" }),
  ).toBeVisible();
  await expect(
    buttons.filter({ hasText: "New Folder" }),
  ).toBeVisible();
});

test("New File from the empty-state creates the .md at the workspace root, shows it in the tree, and opens it", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.locator(".sidebar-empty")).toBeVisible({ timeout: 5_000 });

  // Click the empty-state "New File" button → inline CreateInput appears.
  await window
    .locator(".sidebar-empty-create-btn", { hasText: "New File" })
    .click();
  const input = window.locator('input[aria-label="New file name"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("first-note");
  await input.press("Enter");

  // The file should land on disk at the ROOT as first-note.md.
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "first-note.md"));
          return "created";
        } catch {
          return "missing";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("created");

  // It should appear in the tree (the empty-state is now replaced by the tree).
  await expect(
    window.locator(".tree-item-name", { hasText: "first-note.md" }),
  ).toBeVisible({ timeout: 5_000 });

  // ...and be the active (open) file in the editor.
  const activeRow = window.locator(".tree-item--active");
  await expect(activeRow).toContainText("first-note.md", { timeout: 5_000 });

  // Confirm the file lives directly under the workspace root (not nested).
  const rootEntries = await readdir(workspaceDir);
  expect(rootEntries).toContain("first-note.md");
});

test("New Folder from the empty-state creates the folder at the workspace root and shows it in the tree", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  await expect(window.locator(".sidebar-empty")).toBeVisible({ timeout: 5_000 });

  // Click the empty-state "New Folder" button → inline CreateInput appears.
  await window
    .locator(".sidebar-empty-create-btn", { hasText: "New Folder" })
    .click();
  const input = window.locator('input[aria-label="New folder name"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("Drafts");
  await input.press("Enter");

  // The folder should be created on disk at the workspace ROOT.
  await expect
    .poll(
      async () => {
        try {
          const s = await stat(path.join(workspaceDir, "Drafts"));
          return s.isDirectory() ? "created" : "not-a-dir";
        } catch {
          return "missing";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("created");

  // With "Show empty folders" ON (the default), the brand-new EMPTY folder
  // renders in the tree immediately even though it holds no markdown file.
  await expect(
    window.locator(".tree-item-name", { hasText: "Drafts" }),
  ).toBeVisible({ timeout: 5_000 });

  // And it lives directly under the workspace root.
  const rootEntries = await readdir(workspaceDir);
  expect(rootEntries).toContain("Drafts");
});

test("right-click on the empty-state area opens the New File / New Folder context menu", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  const empty = window.locator(".sidebar-empty");
  await expect(empty).toBeVisible({ timeout: 5_000 });

  // Dispatch the contextmenu event directly on the empty-state container so the
  // handler fires reliably (a pixel-based right-click can land on a child icon
  // or button). The container carries the onContextMenu handler when create is
  // available.
  await window.evaluate(() => {
    const el = document.querySelector(".sidebar-empty") as HTMLElement | null;
    if (!el) throw new Error(".sidebar-empty not found");
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
  });

  await expect(window.locator(".context-menu")).toBeVisible({ timeout: 5_000 });
  await expect(
    window.locator(".context-menu-item-label", { hasText: "New File" }),
  ).toBeVisible();
  await expect(
    window.locator(".context-menu-item-label", { hasText: "New Folder" }),
  ).toBeVisible();
});
