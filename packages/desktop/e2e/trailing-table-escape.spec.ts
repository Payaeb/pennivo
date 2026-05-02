import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-tte-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

test.beforeEach(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-tte-ws-"));
  filePath = path.join(workspaceDir, "scratch.md");
  // Trailing table: the doc ends with a 2x2 table, no paragraph below.
  // This is the trap state — without the escape handler the cursor cannot
  // leave the last cell.
  await writeFile(
    filePath,
    "intro paragraph\n\n| a | b |\n| - | - |\n| c | d |\n",
    "utf-8",
  );
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
  const filePathFwd = filePath.replace(/\\/g, "/");
  await window.locator(`[data-path="${filePathFwd}"]`).click();
  await window.waitForSelector(".ProseMirror table", { timeout: 10_000 });
  await expect(window.locator(".ProseMirror table")).toContainText("d", {
    timeout: 5_000,
  });
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

test("Enter in last cell of trailing table escapes to a new paragraph below", async () => {
  // Click into the last data cell of the table (containing "d").
  const lastCell = window
    .locator(".ProseMirror table tbody tr:last-child td:last-child")
    .first();
  await lastCell.click();
  // Ensure cursor is at end of the cell content.
  await window.keyboard.press("End");
  // Press Enter — should escape the table and place cursor in a new paragraph below.
  await window.keyboard.press("Enter");
  // Type something so we can verify the new paragraph exists outside the table.
  await window.keyboard.type("after table");
  // Wait for autosave (3s debounce + buffer).
  await window.waitForTimeout(4_000);

  const onDisk = await readFile(filePath, "utf-8");
  // Trailing paragraph must exist AFTER the table block.
  const tableEndIdx = onDisk.lastIndexOf("| c | d |");
  expect(tableEndIdx).toBeGreaterThanOrEqual(0);
  const afterTable = onDisk.slice(tableEndIdx);
  expect(afterTable).toContain("after table");
  // Sanity: original table cells preserved.
  expect(onDisk).toMatch(/\|\s*c\s*\|\s*d\s*\|/);
});

test("ArrowDown in last cell of trailing table still escapes (regression guard)", async () => {
  const lastCell = window
    .locator(".ProseMirror table tbody tr:last-child td:last-child")
    .first();
  await lastCell.click();
  await window.keyboard.press("End");
  await window.keyboard.press("ArrowDown");
  await window.keyboard.type("below via arrow");
  await window.waitForTimeout(4_000);

  const onDisk = await readFile(filePath, "utf-8");
  const tableEndIdx = onDisk.lastIndexOf("| c | d |");
  const afterTable = onDisk.slice(tableEndIdx);
  expect(afterTable).toContain("below via arrow");
});
