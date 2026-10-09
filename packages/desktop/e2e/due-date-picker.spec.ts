import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Phase: due-date picker popover. Typing the literal `[due::` trigger inside
// a list item (task or plain) pops a small date-pick popover anchored at the
// cursor; picking a quick-pick date completes the token, and typing the date
// by hand (type-through) works exactly as if the popover weren't there.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

// Local YYYY-MM-DD, matching the app's own local-date convention (same
// formula as App.tsx's formatLocalIsoDate / the tasks-panel e2e suite's
// isoDate helper) so the assertion is deterministic regardless of what day
// the suite actually runs on.
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ddp-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

async function launchWithContent(markdown: string): Promise<void> {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ddp-ws-"));
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
 *  collapsed cursor there without touching a task checkbox. */
async function clickWord(word: string): Promise<void> {
  await window
    .locator(".ProseMirror")
    .getByText(word, { exact: true })
    .first()
    .click();
}

test("typing [due:: inside a task line pops the picker; Today inserts today's date and renders a due chip", async () => {
  await launchWithContent("- [ ] Pay rent\n");
  await clickWord("Pay rent");
  await window.keyboard.press("End");
  await window.keyboard.type(" [due::");

  const popover = window.locator(".due-date-picker");
  await expect(popover).toBeVisible({ timeout: 5_000 });

  await popover.getByRole("button", { name: "Today" }).click();

  await expect(popover).toHaveCount(0);
  await expect(window.locator(".ProseMirror")).toContainText(
    `[due:: ${isoDate(0)}]`,
  );
  await expect(
    window.locator(".ProseMirror .meta-chip--due").first(),
  ).toBeVisible();

  // Autosave debounce (3s) + buffer — confirm it actually landed on disk.
  // The leading `[` may come back backslash-escaped (standard commonmark
  // serializer behavior for a bracket pair that isn't a real link —
  // round-trip safe, and unrelated to this feature), so tolerate it.
  await window.waitForTimeout(4_000);
  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(new RegExp(`\\\\?\\[due:: ${isoDate(0)}\\]`));
});

test("typing the full token by hand works exactly as typed and the picker closes itself on `]`", async () => {
  await launchWithContent("- [ ] Pay rent\n");
  await clickWord("Pay rent");
  await window.keyboard.press("End");
  await window.keyboard.type(" [due:: ");

  const popover = window.locator(".due-date-picker");
  await expect(popover).toBeVisible({ timeout: 5_000 });

  // Type-through: ignore the popover entirely and hand-type the rest of the
  // date. Keystrokes must keep landing in the editor, not get swallowed by
  // the (unfocused) popover.
  await window.keyboard.type("2026-10-20");
  await expect(popover).toBeVisible(); // still open mid-date — type-through, not an interruption
  await window.keyboard.type("]");

  // Finishing the `]` closes the popover on its own, with no insertion from
  // the popover side — the text is exactly what was typed, nothing more.
  await expect(popover).toHaveCount(0);
  await expect(window.locator(".ProseMirror")).toContainText(
    "Pay rent [due:: 2026-10-20]",
  );
  await expect(
    window.locator(".ProseMirror .meta-chip--due").first(),
  ).toBeVisible();

  // Markdown serialization may backslash-escape the leading `[` (standard,
  // pre-existing commonmark-serializer behavior for a bracket pair that
  // isn't a real link — unrelated to this feature, and round-trip safe:
  // the parser strips the escape back out on next load), so tolerate it.
  await window.waitForTimeout(4_000);
  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toMatch(/Pay rent \\?\[due:: 2026-10-20\]/);
});

test("Escape dismisses the picker without inserting anything", async () => {
  await launchWithContent("- [ ] Pay rent\n");
  await clickWord("Pay rent");
  await window.keyboard.press("End");
  await window.keyboard.type(" [due::");

  const popover = window.locator(".due-date-picker");
  await expect(popover).toBeVisible({ timeout: 5_000 });

  await window.keyboard.press("Escape");
  await expect(popover).toHaveCount(0);

  // Nothing was inserted — the line reads exactly what was typed up to the
  // trigger (no closing bracket anywhere, proving the popover didn't commit
  // anything on its own).
  await expect(window.locator(".ProseMirror")).toContainText("Pay rent [due::");
  await expect(window.locator(".ProseMirror")).not.toContainText("]");
});

test("picking a date from the native input completes the token", async () => {
  await launchWithContent("- [ ] Pay rent\n");
  await clickWord("Pay rent");
  await window.keyboard.press("End");
  await window.keyboard.type(" [due::");

  const popover = window.locator(".due-date-picker");
  await expect(popover).toBeVisible({ timeout: 5_000 });

  await popover.locator('input[type="date"]').fill("2026-12-25");

  await expect(popover).toHaveCount(0);
  await expect(window.locator(".ProseMirror")).toContainText(
    "[due:: 2026-12-25]",
  );
});
