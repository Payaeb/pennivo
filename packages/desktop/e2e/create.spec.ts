import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm, stat } from "node:fs/promises";
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

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-workspace-"));
  await writeFile(path.join(dir, "alpha.md"), "# Alpha\n\nfirst file.");
  await writeFile(path.join(dir, "bravo.md"), "# Bravo\n\nsecond file.");
  await mkdir(path.join(dir, "notes"));
  await writeFile(path.join(dir, "notes", "todo.md"), "# Todo\n\nin a folder.");
  // A folder with no markdown descendants. With "Show empty folders" on (the
  // default), this renders in the tree; toggling the pref off prunes it.
  await mkdir(path.join(dir, "Empty"));
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
});

test.afterEach(async () => {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

test("New File via a folder context menu creates the file, shows it in the tree, and opens it", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const notesRow = window.locator(
    `[data-path="${path.join(workspaceDir, "notes").replace(/\\/g, "/")}"]`,
  );
  await notesRow.click({ button: "right" });
  await expect(window.locator(".context-menu")).toBeVisible();
  await window
    .locator(".context-menu-item-label", { hasText: "New File" })
    .click();

  const input = window.locator('input[aria-label="New file name"]');
  await expect(input).toBeVisible();
  await input.fill("fresh-note");
  await input.press("Enter");

  // The file should land on disk as fresh-note.md inside notes/
  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "fresh-note.md"));
          return "created";
        } catch {
          return "missing";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("created");

  // It should appear in the tree...
  await expect(
    window.locator(".tree-item-name", { hasText: "fresh-note.md" }),
  ).toBeVisible({ timeout: 5_000 });

  // ...and be the active (open) file in the editor.
  const activeRow = window.locator(".tree-item--active");
  await expect(activeRow).toContainText("fresh-note.md", { timeout: 5_000 });
});

test("New Folder via the root context menu creates the folder on disk", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Dispatch the contextmenu event directly on the bare tree container so
  // `event.target === event.currentTarget` (the root-menu guard). Clicking a
  // pixel can land on a child row; this targets the background reliably.
  await window.evaluate(() => {
    const tree = document.querySelector(".sidebar-tree") as HTMLElement | null;
    if (!tree) throw new Error(".sidebar-tree not found");
    tree.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 20,
        clientY: 20,
      }),
    );
  });
  await expect(window.locator(".context-menu")).toBeVisible();
  await window
    .locator(".context-menu-item-label", { hasText: "New Folder" })
    .click();

  const input = window.locator('input[aria-label="New folder name"]');
  await expect(input).toBeVisible();
  await input.fill("Archive");
  await input.press("Enter");

  await expect
    .poll(
      async () => {
        try {
          const s = await stat(path.join(workspaceDir, "Archive"));
          return s.isDirectory() ? "created" : "not-a-dir";
        } catch {
          return "missing";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("created");

  // With "Show empty folders" ON (the default), the brand-new EMPTY folder
  // renders in the tree immediately — no markdown file inside it is required.
  // This validates the end-to-end Phase 11g fix.
  await expect(
    window.locator(".tree-item-name", { hasText: "Archive" }),
  ).toBeVisible({ timeout: 5_000 });
});

test("empty folders are visible by default (Show empty folders on)", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });
  // The seed includes an "Empty" folder with no markdown descendants.
  await expect(
    window.locator(".tree-item-name", { hasText: "Empty" }),
  ).toBeVisible({ timeout: 5_000 });
});

test("toggling 'Show empty folders' off hides an empty folder", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  // Visible by default.
  await expect(
    window.locator(".tree-item-name", { hasText: "Empty" }),
  ).toBeVisible({ timeout: 5_000 });

  // Open the sort menu and click the "Show empty folders" toggle (turns it off).
  await window.locator(".sidebar-sort-btn").click();
  const toggle = window.locator(".sidebar-sort-option", {
    hasText: "Show empty folders",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  // The empty folder is pruned from the tree (legacy behavior restored).
  await expect(
    window.locator(".tree-item-name", { hasText: "Empty" }),
  ).toHaveCount(0, { timeout: 5_000 });

  // A folder that DOES contain markdown stays visible.
  await expect(
    window.locator(".tree-item-name", { hasText: "notes" }),
  ).toBeVisible();
});

test("creating the same file name twice auto-suffixes (no collision)", async () => {
  await expect(window.locator(".sidebar")).toBeVisible({ timeout: 5_000 });

  const notesPath = path.join(workspaceDir, "notes").replace(/\\/g, "/");

  // First create: notes/dup.md
  await window
    .locator(`[data-path="${notesPath}"]`)
    .click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "New File" })
    .click();
  let input = window.locator('input[aria-label="New file name"]');
  await input.fill("dup");
  await input.press("Enter");

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "dup.md"));
          return "yes";
        } catch {
          return "no";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("yes");

  // Second create with the SAME name → auto-suffixed to "dup 2.md"
  await window
    .locator(`[data-path="${notesPath}"]`)
    .click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "New File" })
    .click();
  input = window.locator('input[aria-label="New file name"]');
  await input.fill("dup");
  await input.press("Enter");

  await expect
    .poll(
      async () => {
        try {
          await stat(path.join(workspaceDir, "notes", "dup 2.md"));
          return "suffixed";
        } catch {
          return "missing";
        }
      },
      { timeout: 5_000, intervals: [100, 250, 500] },
    )
    .toBe("suffixed");
});
