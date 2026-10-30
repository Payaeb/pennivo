import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const SHOT_DIR = process.env.PENNIVO_SHOT_DIR ?? "";

// Filler pushes the list below the fold so a successful jump must scroll.
const FILLER = Array.from(
  { length: 40 },
  (_, i) => `Filler paragraph number ${i + 1}.\n`,
);
const DOC = [
  "# Reveal",
  "",
  ...FILLER,
  "- Parent Bullet",
  "  - Visible sibling note",
  "  - [ ] Hidden child task #deep",
  "",
  "- Other Top",
  "  - Other child",
  "",
].join("\n");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let docContent = DOC;
let userDataDir: string;

async function launchApp(content: string, waitFor: string) {
  docContent = content;
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-reveal-ws-"));
  await writeFile(path.join(workspaceDir, "reveal.md"), docContent, "utf-8");
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-reveal-ud-"));
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
  await window.locator('.tree-item[title$="reveal.md"]').click();
  await expect(window.locator(".ProseMirror")).toContainText(waitFor, {
    timeout: 10_000,
  });
  await window.waitForTimeout(3500); // quick successive opens are ignored until the app settles
}

test.beforeEach(async () => {
  await launchApp(DOC, "Parent Bullet");
});

async function closeAndCleanup() {
  if (app) await app.close();
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
}

test.afterEach(async () => {
  await closeAndCleanup();
});

const parentLi = () =>
  window.locator(".ProseMirror li", { hasText: "Parent Bullet" }).first();
const childTask = () =>
  window.locator(".ProseMirror li", { hasText: "Hidden child task" }).last();

async function collapseParent() {
  await parentLi().locator(".collapse-toggle").first().click();
  await expect(parentLi()).toHaveClass(/list-item--collapsed/);
  await expect(childTask()).toBeHidden();
}

async function expectRevealed() {
  await expect(parentLi()).not.toHaveClass(/list-item--collapsed/);
  await expect(childTask()).toBeVisible();
  await expect
    .poll(
      async () =>
        window.evaluate(() => {
          const el = Array.from(document.querySelectorAll(".ProseMirror li"))
            .filter((e) => e.textContent?.includes("Hidden child task"))
            .pop() as HTMLElement;
          const area = document.querySelector(".app-editor-area")!;
          const r = el.getBoundingClientRect();
          const a = area.getBoundingClientRect();
          return r.top >= a.top - 1 && r.bottom <= a.bottom + 1;
        }),
      { timeout: 5_000 },
    )
    .toBe(true);
}

async function shot(name: string) {
  if (SHOT_DIR) await window.screenshot({ path: path.join(SHOT_DIR, name) });
}

async function openPanel() {
  await window.locator('.sidebar-header [aria-label="Tasks"]').click();
  await expect(window.locator(".tasks-panel")).toBeVisible({ timeout: 5_000 });
}

test("clicking a task hidden under a collapsed parent expands it and scrolls to it", async () => {
  await collapseParent();
  await openPanel();
  await window
    .locator(".tasks-panel-item", { hasText: "Hidden child task" })
    .click();
  await expectRevealed();
  await shot("reveal-tasks.png");
});

test("clicking a Labels-tab row hidden under a collapsed parent expands it", async () => {
  await collapseParent();
  await openPanel();
  await window.getByRole("tab", { name: "Labels" }).click();
  await window
    .locator(".tasks-panel-item", { hasText: "Hidden child task" })
    .click();
  await expectRevealed();
  await shot("reveal-labels.png");
});

test("clicking a task outside the zoomed subtree exits zoom and shows it", async () => {
  const para = window
    .locator(".ProseMirror")
    .getByText("Other Top", { exact: true })
    .first();
  await para.scrollIntoViewIfNeeded();
  const box = await para.locator("xpath=ancestor::li[1]").boundingBox();
  if (!box) throw new Error("no bounding box for Other Top");
  await window.mouse.click(box.x - 6, box.y + Math.min(10, box.height / 2));
  await expect(window.locator(".zoom-breadcrumb")).toBeVisible();
  await expect(childTask()).toBeHidden();

  await openPanel();
  await window
    .locator(".tasks-panel-item", { hasText: "Hidden child task" })
    .click();
  await expect(window.locator(".zoom-breadcrumb")).toHaveCount(0);
  await expectRevealed();
  await shot("reveal-zoom.png");
});

// User-reported defect: a panel row must land on ITS list item, not on the
// first document occurrence of the item's first word.
const WEEK_DOC = [
  "# Plan",
  "",
  "- launch tasks",
  "",
  ...FILLER,
  "- week two: behind-the-scenes photos",
  "  - [ ] task 3",
  "  - [ ] task 4",
  "",
].join("\n");

const DUP_DOC = [
  "# Dups",
  "",
  "- launch tasks",
  "- [ ] task 3",
  "",
  ...FILLER,
  "- [ ] task 3",
  "",
].join("\n");

async function caretInfo() {
  return window.evaluate(() => {
    const sel = window.getSelection();
    const node = sel?.anchorNode ?? null;
    const el = (
      node?.nodeType === 3 ? node.parentElement : (node as Element | null)
    )?.closest("li");
    const lis = Array.from(document.querySelectorAll(".ProseMirror li"));
    return {
      text: el?.firstElementChild?.textContent ?? null,
      index: el ? lis.indexOf(el) : -1,
      findMatches: document.querySelectorAll(
        ".ProseMirror .find-match, .ProseMirror .find-match-current, .ProseMirror [class*='find-match']",
      ).length,
    };
  });
}

test.describe("exact list-item jump", () => {
  test("row under a collapsed parent lands on that item, not on 'launch tasks'", async () => {
    await closeAndCleanup();
    await launchApp(WEEK_DOC, "week two");
    const parent = window
      .locator(".ProseMirror li", { hasText: "week two" })
      .first();
    await parent.locator(".collapse-toggle").first().click();
    await expect(parent).toHaveClass(/list-item--collapsed/);
    await openPanel();
    await window
      .locator(".tasks-panel-item", { hasText: "task 3" })
      .first()
      .click();
    await expect(parent).not.toHaveClass(/list-item--collapsed/);
    const target = window
      .locator(".ProseMirror li", { hasText: /^task 3$/ })
      .first();
    await expect(target).toBeVisible();
    await expect.poll(async () => (await caretInfo()).text).toBe("task 3");
    expect((await caretInfo()).findMatches).toBe(0);
    await shot("exact-jump.png");
  });

  test("second of two identical rows lands on the second item", async () => {
    await closeAndCleanup();
    await launchApp(DUP_DOC, "launch tasks");
    await openPanel();
    const rows = window.locator(".tasks-panel-item", { hasText: "task 3" });
    await expect(rows).toHaveCount(2);
    const lisBefore = await window.evaluate(
      () => document.querySelectorAll(".ProseMirror li").length,
    );
    await rows.nth(1).click();
    await expect
      .poll(async () => {
        const c = await caretInfo();
        return c.text === "task 3" ? c.index : -1;
      })
      .toBe(lisBefore - 1);
    expect((await caretInfo()).findMatches).toBe(0);
  });
});
