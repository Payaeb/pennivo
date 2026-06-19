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

test("clicking a result jumps to and selects the match in WYSIWYG mode", async () => {
  await window
    .locator('.sidebar-header [aria-label="Search in workspace"]')
    .click();
  const input = window.locator(".global-search-input");
  await input.fill("salmon");

  // bravo.md line 5 ("Another salmon line here.") is NOT the first line of the
  // file, so a correct jump must move past the top of the document.
  const line5Result = window
    .locator(".global-search-line", { hasText: "Another salmon line here." })
    .first();
  await expect(line5Result).toBeVisible({ timeout: 5_000 });
  await line5Result.click();

  // File opens in WYSIWYG. The jump re-finds the term and drives the same find
  // decoration FindReplace uses, so the matched occurrence carries the
  // find-match--current class. Asserting the highlighted text is "salmon"
  // proves the editor landed on the match (not merely that the file opened).
  await expect(window.locator(".ProseMirror")).toContainText(
    "Another salmon line here.",
    { timeout: 5_000 },
  );
  const current = window.locator(".ProseMirror .find-match--current");
  await expect(current).toHaveText("salmon", { timeout: 5_000 });
});

test("clicking a result selects the match offset in source mode", async () => {
  // Open bravo.md and switch to source mode FIRST so the jump takes the
  // CodeMirror branch (source mode is sticky across the next file open).
  await window.getByText("bravo.md").click();
  await expect(window.locator(".ProseMirror")).toContainText("Bravo", {
    timeout: 5_000,
  });
  await window.locator('[aria-label="Source mode"]').click();
  await expect(window.locator(".cm-editor")).toBeVisible({ timeout: 5_000 });

  // Now search and click the line-5 match. The open is a no-op (bravo is
  // already open) but the jump must still fire.
  await window
    .locator('.sidebar-header [aria-label="Search in workspace"]')
    .click();
  const input = window.locator(".global-search-input");
  await input.fill("salmon");
  const line5Result = window
    .locator(".global-search-line", { hasText: "Another salmon line here." })
    .first();
  await expect(line5Result).toBeVisible({ timeout: 5_000 });
  await line5Result.click();

  // fileOffset maps 1:1 to the CodeMirror doc offset in source mode, so the
  // jump selects exactly the matched term. CodeMirror mirrors its selection to
  // the native DOM Selection once the view is focused (applySourceJump focuses
  // it), making the selected text the most reliable observable. We also assert
  // the selection sits on the line-5 occurrence (offset 35), not the line-3
  // one, by checking the character immediately before the selection is the
  // space after "Another " rather than after "A ".
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const sel = window.getSelection();
          if (!sel || sel.rangeCount === 0) return null;
          return sel.toString();
        }),
      { timeout: 5_000 },
    )
    .toBe("salmon");

  // Disambiguate line 3 vs line 5: both contain "salmon". The selection's
  // anchor node lives inside the CodeMirror line element for line 5, whose text
  // is "Another salmon line here." (not line 3's "A salmon dinner."). Reading
  // the enclosing .cm-line confirms the jump targeted the correct occurrence.
  const enclosingLineText = await window.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.anchorNode;
    while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
    let el = node as HTMLElement | null;
    while (el && !el.classList.contains("cm-line")) el = el.parentElement;
    return el?.textContent ?? null;
  });
  expect(enclosingLineText).toBe("Another salmon line here.");
});

test("Ctrl+Shift+F opens search and focuses the input", async () => {
  await window.keyboard.press("Control+Shift+F");
  const input = window.locator(".global-search-input");
  await expect(input).toBeVisible({ timeout: 5_000 });
  await expect(input).toBeFocused();
});
