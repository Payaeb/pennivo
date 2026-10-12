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

// Bug fix regression coverage — see bulletZoomPlugin.ts's handleKeyDown
// comment. Shift+Tab on a DIRECT CHILD of the zoom root used to lift it to
// become a SIBLING of the zoom root itself — outside the zoomed subtree —
// so it silently vanished from the zoomed view even though the root never
// moved. "Task Alpha"/"Task Beta" are direct children of "Phase One" in
// FIXTURE; "Phase One" is the zoom root here.
test("Shift+Tab on a direct child of the zoom root is blocked — item stays in the zoomed view and nested on disk", async () => {
  await launchWithContent(FIXTURE);
  await clickBulletGlyph("Phase One");
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Phase One",
  );

  await clickWord("Task Alpha");
  await window.keyboard.press("Shift+Tab");

  // Still visible in the zoomed view — a successful (buggy) outdent would
  // have moved it to be a sibling of "Phase One", which the zoom's hide
  // decorations would then remove from the content pane entirely.
  await expect(
    window.locator(".ProseMirror").getByText("Task Alpha", { exact: true }),
  ).toBeVisible();
  // Its sibling "Task Beta" and the zoom root itself are undisturbed.
  await expect(
    window.locator(".ProseMirror").getByText("Task Beta", { exact: true }),
  ).toBeVisible();
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Phase One",
  );

  // Autosave debounce (3s) + buffer, then confirm on disk: "Task Alpha"
  // is still 4-space indented (nested under "Phase One"), not promoted to
  // "Phase One"'s own 2-space level. (Milkdown's markdown serializer emits
  // `*` bullets regardless of the `-` used in FIXTURE's source markdown.)
  await window.waitForTimeout(4_000);
  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toContain("    * Task Alpha");
  // Not promoted to 2-space (sibling of "Phase One") — anchor the regex so
  // the real 4-space line (which CONTAINS "  * Task Alpha" as a trailing
  // substring) doesn't also match.
  expect(onDisk).not.toMatch(/^ {2}\* Task Alpha$/m);
});

// Bug fix regression coverage — see Editor.css's "Bullet-zoom hover
// affordance" comment. The zoom hover dot used to be `::before`, the same
// pseudo-element the task checkbox uses — on hover, the dot's properties
// won the CSS cascade and the checkbox visually turned into a small round
// dot, then reverted on hover-out. Assert the checkbox's actual computed
// `::before` box (size + shape) is unchanged while hovering, for both an
// unchecked and a checked task item.
test("a task-item checkbox stays visible (not replaced by the zoom dot) while hovering", async () => {
  await launchWithContent("- [ ] Buy milk\n- [x] Walk the dog\n");

  async function checkboxBoxOnHover(selector: string) {
    const li = window.locator(selector).first();
    await li.hover();
    return li.evaluate((el) => {
      const cs = getComputedStyle(el, "::before");
      return {
        display: cs.display,
        width: cs.width,
        height: cs.height,
        borderRadius: cs.borderRadius,
        backgroundImage: cs.backgroundImage,
      };
    });
  }

  const unchecked = await checkboxBoxOnHover('li[data-checked="false"]');
  expect(unchecked.display).not.toBe("none");
  expect(unchecked.width).toBe("16px");
  expect(unchecked.height).toBe("16px");
  // The checkbox is a rounded square (radius 3px) — if the zoom dot's
  // `::before` had won the cascade here, this would read "50%" (a circle).
  expect(unchecked.borderRadius).not.toBe("50%");

  const checked = await checkboxBoxOnHover('li[data-checked="true"]');
  expect(checked.width).toBe("16px");
  expect(checked.height).toBe("16px");
  expect(checked.borderRadius).not.toBe("50%");
  // The checkmark SVG background-image must still be present.
  expect(checked.backgroundImage).not.toBe("none");
});

// Magnifier affordance (v1.5.1): icon is a `li::after` at left:-46px, 14px
// wide, always present (opacity 0) and revealed on hover.
// Optional: set PENNIVO_SHOT_DIR to also save crops for visual review.
const SHOT_DIR = process.env.PENNIVO_SHOT_DIR ?? "";

function itemOf(word: string) {
  return window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first()
    .locator("xpath=ancestor::li[1]");
}

async function iconState(word: string) {
  const li = itemOf(word);
  await li.hover({ position: { x: 20, y: 8 } });
  // Let the 120ms opacity transition finish.
  await window.waitForTimeout(250);
  return li.evaluate((el) => {
    const cs = getComputedStyle(el, "::after");
    return {
      content: cs.content,
      display: cs.display,
      opacity: parseFloat(cs.opacity),
      left: parseFloat(cs.left),
      width: parseFloat(cs.width),
      pointerEvents: cs.pointerEvents,
    };
  });
}

/** Page coordinates of the icon centre: li left edge + computed left + half width. */
async function iconCentre(word: string) {
  const li = itemOf(word);
  const box = await li.boundingBox();
  if (!box) throw new Error("no box");
  const st = await iconState(word);
  return { x: box.x + st.left + st.width / 2, y: box.y + 14 };
}

test("hovering a leaf item reveals the magnifier icon in the -46..-32 band", async () => {
  await launchWithContent(FIXTURE);
  const st = await iconState("Task Alpha");
  expect(st.opacity).toBe(1);
  expect(st.left).toBe(-46);
  expect(st.left + st.width).toBeLessThanOrEqual(-32);
  expect(st.pointerEvents).toBe("auto");
  await window.mouse.move(0, 0);
  await window.waitForTimeout(250);
  const off = await itemOf("Task Alpha").evaluate((el) =>
    parseFloat(getComputedStyle(el, "::after").opacity),
  );
  expect(off).toBe(0);
});

test("hovering a parent item (with a chevron) also reveals the icon", async () => {
  await launchWithContent(FIXTURE);
  await expect(itemOf("Phase One")).toHaveClass(/list-item--collapsible/);
  const st = await iconState("Phase One");
  expect(st.opacity).toBe(1);
  expect(st.left).toBe(-46);
  expect(st.left + st.width).toBeLessThanOrEqual(-32);
});

test("task items show the magnifier and clicking it zooms into the task", async () => {
  await launchWithContent("- [ ] Parent task\n  - [ ] Child task\n");
  const st = await iconState("Parent task");
  expect(st.opacity).toBe(1);
  expect(st.left).toBe(-46);
  const { x, y } = await iconCentre("Parent task");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Parent task",
  );
  await expect(
    window.locator(".ProseMirror").getByText("Child task", { exact: true }),
  ).toBeVisible();
});

test("clicking the icon on a parent item zooms into it", async () => {
  await launchWithContent(FIXTURE);
  const { x, y } = await iconCentre("Phase One");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Phase One",
  );
  await expect(
    window.locator(".ProseMirror").getByText("Task Alpha", { exact: true }),
  ).toBeVisible();
  await expect(
    window.locator(".ProseMirror").getByText("Phase Two", { exact: true }),
  ).toBeHidden();
});

test("clicking the icon on a leaf item zooms into it", async () => {
  await launchWithContent(FIXTURE);
  const { x, y } = await iconCentre("Task Beta");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Task Beta",
  );
  await expect(
    window.locator(".ProseMirror").getByText("Task Alpha", { exact: true }),
  ).toBeHidden();
});

test("clicking the icon on a top-level item zooms into it", async () => {
  await launchWithContent(FIXTURE);
  const { x, y } = await iconCentre("Other Top");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Other Top",
  );
});

test("screenshots: icon on a parent and a leaf item", async () => {
  test.skip(!SHOT_DIR, "set PENNIVO_SHOT_DIR to capture");
  await launchWithContent(FIXTURE);
  for (const [word, name] of [
    ["Phase One", "parent"],
    ["Task Alpha", "leaf"],
  ] as const) {
    await iconState(word);
    const box = await itemOf(word).boundingBox();
    if (!box) throw new Error("no box");
    await window.screenshot({
      path: `${SHOT_DIR}/icon-${name}.png`,
      clip: {
        x: Math.max(0, box.x - 90),
        y: Math.max(0, box.y - 12),
        width: 360,
        height: 56,
      },
    });
  }
});

// Magnifier of a child nested under a TASK must zoom the child, never toggle
// the parent task (the child's icon band lands inside the parent's checkbox
// strip).
test("a plain bullet nested under a task: its magnifier zooms the child and leaves the parent unchecked", async () => {
  await launchWithContent("- [ ] Parent task\n  - plain child\n");
  const before = await window.locator('li[data-checked="false"]').count();
  const { x, y } = await iconCentre("plain child");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "plain child",
  );
  await expect(window.locator('li[data-checked="false"]')).toHaveCount(before);
  await expect(window.locator('li[data-checked="true"]')).toHaveCount(0);
});

test("a task nested under a task: the child's magnifier zooms the child and leaves the parent unchecked", async () => {
  await launchWithContent("- [ ] Parent task\n  - [ ] Child task\n");
  const { x, y } = await iconCentre("Child task");
  await window.mouse.click(x, y);
  await expect(window.locator(".zoom-breadcrumb__current")).toHaveText(
    "Child task",
  );
  await expect(window.locator('li[data-checked="true"]')).toHaveCount(0);
});

test("clicking a parent task's checkbox still toggles it", async () => {
  await launchWithContent("- [ ] Parent task\n  - plain child\n");
  const li = itemOf("Parent task");
  const box = await li.boundingBox();
  if (!box) throw new Error("no box");
  await window.mouse.click(box.x + 8, box.y + 12);
  await expect(window.locator('li[data-checked="true"]')).toHaveCount(1);
});
