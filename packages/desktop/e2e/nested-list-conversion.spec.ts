import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Regression coverage for the nested-list-conversion bug: converting one
// nested list item (bullet -> task, bullet -> ordered, etc.) must touch ONLY
// the targeted item(s), never an ancestor or an unrelated sibling. Each test
// seeds its own fixture (the nesting shape differs per test), launches a
// fresh Electron instance, drives the toolbar, and asserts on the markdown
// written to disk after autosave.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-nlc-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

async function launchWithContent(markdown: string): Promise<void> {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-nlc-ws-"));
  filePath = path.join(workspaceDir, "scratch.md");
  await writeFile(filePath, markdown, "utf-8");
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
  await window.waitForSelector(".ProseMirror", { timeout: 10_000 });
}

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

/** Click once inside the exact-text node `word` (first match), placing a
 *  collapsed cursor there without touching a task checkbox (the click lands
 *  on the text, not the left-edge checkbox glyph). */
async function clickWord(word: string): Promise<void> {
  await window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first()
    .click();
}

/** Extend the selection from the current caret to inside `word` (shift-click),
 *  producing a range selection spanning both points. */
async function shiftClickWord(word: string): Promise<void> {
  await window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first()
    .click({ modifiers: ["Shift"] });
}

async function clickToolbarButton(label: string): Promise<void> {
  await window.locator(`button[aria-label="${label}"]`).first().click();
  // Wait for autosave to fire (3s debounce + buffer).
  await window.waitForTimeout(4_000);
}

test("converts only a nested child to a task — the bullet parent stays a plain bullet", async () => {
  await launchWithContent("- parent\n  - child\n");
  await clickWord("child");
  await clickToolbarButton("Task List");

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(/^[*-]\s+parent\s*$/m);
  expect(onDisk).not.toMatch(/\[[ xX]?\]\s*parent/);
  expect(onDisk).toMatch(/^\s+[*-]\s+\[\s?\]\s+child\s*$/m);
});

test("three-level nesting: converting the middle item to task leaves top and bottom untouched", async () => {
  await launchWithContent("- top\n  - middle\n    - bottom\n");
  await clickWord("middle");
  await clickToolbarButton("Task List");

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).not.toMatch(/\[[ xX]?\]\s*top/);
  expect(onDisk).toMatch(/\[\s?\]\s*middle/);
  expect(onDisk).not.toMatch(/\[[ xX]?\]\s*bottom/);
});

test("toggling a nested task off does not corrupt the ancestor's checked state", async () => {
  await launchWithContent("- [ ] parent\n  - [ ] child\n");
  await clickWord("child");
  await clickToolbarButton("Task List"); // already a task -> toggles off

  const onDisk = await readFile(filePath, "utf-8");
  // The ancestor must still read as an (unchecked) task — never flipped.
  expect(onDisk).toMatch(/\[\s?\]\s*parent/);
});

test("selecting two nested sibling lines and clicking Ordered List numbers them under an unchanged bullet parent", async () => {
  await launchWithContent("- parent\n  - childA\n  - childB\n");
  await clickWord("childA");
  await shiftClickWord("childB");
  await clickToolbarButton("Ordered List");

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(/^[*-]\s+parent\s*$/m);
  expect(onDisk).toMatch(/^\s+1\.\s+childA\s*$/m);
  expect(onDisk).toMatch(/^\s+2\.\s+childB\s*$/m);
});

test("a nested bullet sibling is unaffected by converting just one item to task", async () => {
  await launchWithContent("- parent\n  - childA\n  - childB\n");
  await clickWord("childA");
  await clickToolbarButton("Task List");

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(/\[\s?\]\s*childA/);
  expect(onDisk).not.toMatch(/\[[ xX]?\]\s*childB/);
  expect(onDisk).not.toMatch(/\[[ xX]?\]\s*parent/);
});
