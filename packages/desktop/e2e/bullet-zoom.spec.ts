import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Phase 18a — "zoom into a bullet" (Workflowy-style hoist). Deliberately
// named bullet-zoom.spec.ts, NOT zoom.spec.ts — that file already covers
// the unrelated OS display-zoom commands (zoomIn/zoomOut/resetZoom).

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

const FIXTURE = [
  "- Project",
  "  - Phase One",
  "    - Task Alpha",
  "    - Task Beta",
  "  - Phase Two",
  "    - Task Gamma",
  "- Other Top",
  "",
].join("\n");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-bz-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

async function launchWithContent(markdown: string): Promise<void> {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-bz-ws-"));
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
 *  collapsed cursor there. */
async function clickWord(word: string): Promise<void> {
  await window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first()
    .click();
}

/** Click the bullet GLYPH of the list item whose own text is exactly
 *  `word` — the marker "gutter" to the left of the item's own content box,
 *  which bulletZoomPlugin's handleClick treats as the zoom-in affordance
 *  (coordinate-zone hit test, same technique as the existing checkbox-click
 *  handler). Using real page coordinates sidesteps any ambiguity about
 *  whether the native ::marker pseudo-element itself is a valid click
 *  target — the click lands at an absolute pixel the editor's own
 *  mousedown/click listeners see regardless. */
async function clickBulletGlyph(word: string): Promise<void> {
  const para = window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first();
  const li = para.locator("xpath=ancestor::li[1]");
  const box = await li.boundingBox();
  if (!box)
    throw new Error(`no bounding box for the <li> containing "${word}"`);
  // 6px inside the li's own left edge — within the marker gutter
  // (bulletZoomPlugin's hit zone is [rect.left-28, rect.left)) but clear of
  // the collapse chevron's own box when one is present (left:-28px,
  // width:18px, i.e. up to 10px from the li's edge).
  await window.mouse.click(box.x - 6, box.y + Math.min(10, box.height / 2));
}

async function openCommandPaletteAndRun(query: string): Promise<void> {
  await window.keyboard.press("Control+Shift+P");
  await window.waitForSelector(".command-palette", { timeout: 3000 });
  await window.keyboard.type(query);
  await window.keyboard.press("Enter");
}

test("zooming into a nested bullet shows only its subtree, with a Home > ancestor breadcrumb", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");

  await expect(window.locator(".zoom-breadcrumb")).toBeVisible();
  await expect(window.locator(".zoom-breadcrumb__home")).toHaveText("Home");
  await expect(
    window.locator(".zoom-breadcrumb__crumb", { hasText: "Project" }),
  ).toBeVisible();
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Phase One",
  );

  // The zoomed subtree is visible.
  await expect(
    window.locator(".ProseMirror").getByText("Task Alpha", { exact: true }),
  ).toBeVisible();
  await expect(
    window.locator(".ProseMirror").getByText("Task Beta", { exact: true }),
  ).toBeVisible();

  // Ancestor's own text and unrelated siblings are hidden from the content
  // pane (only the breadcrumb shows ancestor text).
  await expect(
    window.locator(".ProseMirror").getByText("Project", { exact: true }),
  ).toBeHidden();
  await expect(
    window.locator(".ProseMirror").getByText("Phase Two", { exact: true }),
  ).toBeHidden();
  await expect(
    window.locator(".ProseMirror").getByText("Task Gamma", { exact: true }),
  ).toBeHidden();
  await expect(
    window.locator(".ProseMirror").getByText("Other Top", { exact: true }),
  ).toBeHidden();
});

test("clicking an ancestor breadcrumb crumb zooms out partially, not all the way to Home", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Phase One",
  );

  await window
    .locator(".zoom-breadcrumb__crumb", { hasText: "Project" })
    .click();

  // Now zoomed to "Project" — its whole subtree (both phases) is visible,
  // but the UNRELATED top-level sibling "Other Top" stays hidden.
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Project",
  );
  await expect(
    window.locator(".ProseMirror").getByText("Phase Two", { exact: true }),
  ).toBeVisible();
  await expect(
    window.locator(".ProseMirror").getByText("Task Gamma", { exact: true }),
  ).toBeVisible();
  await expect(
    window.locator(".ProseMirror").getByText("Other Top", { exact: true }),
  ).toBeHidden();
});

test("Home exits zoom fully — all content visible again, breadcrumb gone", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");
  await expect(window.locator(".zoom-breadcrumb")).toBeVisible();

  await window.locator(".zoom-breadcrumb__home").click();

  await expect(window.locator(".zoom-breadcrumb")).toHaveCount(0);
  await expect(
    window.locator(".ProseMirror").getByText("Other Top", { exact: true }),
  ).toBeVisible();
  await expect(
    window.locator(".ProseMirror").getByText("Project", { exact: true }),
  ).toBeVisible();
});

test("Ctrl+. zooms into the cursor's item; Esc exits zoom fully", async () => {
  await launchWithContent(FIXTURE);
  await clickWord("Task Gamma");
  // Let the click's selection update settle before the shortcut fires —
  // otherwise Ctrl+. can read the selection from just before the click.
  await window.waitForTimeout(200);
  await window.keyboard.press("Control+.");

  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Task Gamma",
  );

  await window.keyboard.press("Escape");

  await expect(window.locator(".zoom-breadcrumb")).toHaveCount(0);
  await expect(
    window.locator(".ProseMirror").getByText("Other Top", { exact: true }),
  ).toBeVisible();
});

test("typing while zoomed autosaves the FULL document — zoom never truncates the file", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");
  await expect(window.locator(".zoom-breadcrumb")).toBeVisible();

  await clickWord("Task Alpha");
  await window.keyboard.press("End");
  await window.keyboard.type(" EDITED");

  // Autosave debounce (3s) + buffer.
  await window.waitForTimeout(4_000);

  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toContain("Task Alpha EDITED");
  // The rest of the document — including content far outside the zoomed
  // subtree — must still be present on disk; zoom is a view filter only.
  expect(onDisk).toContain("Project");
  expect(onDisk).toContain("Phase Two");
  expect(onDisk).toContain("Task Gamma");
  expect(onDisk).toContain("Other Top");
});

test("switching to source mode exits zoom", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");
  await expect(window.locator(".zoom-breadcrumb")).toBeVisible();

  await openCommandPaletteAndRun("Toggle Source Mode");

  await expect(window.locator(".zoom-breadcrumb")).toHaveCount(0);
});
