import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Phase: "Record completion dates" setting. With it OFF (default) checking a
// task only flips the checkbox. With it ON, checking appends
// ` [done:: <today local>]` to the task's first paragraph (rendered as a
// `.meta-chip--done` chip) and unchecking removes it again, with no stray
// double space left behind.

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;
let filePath: string;

// Local YYYY-MM-DD, same formula as App.tsx's formatLocalIsoDate (via
// utils/localDate.ts) and the other e2e suites' isoDate helper.
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = String(d.getFullYear()).padStart(4, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function seedUserData(workspace: string): Promise<string> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-cd-ud-"));
  await writeFile(
    path.join(ud, "sidebar-folder.json"),
    JSON.stringify(workspace),
    "utf-8",
  );
  return ud;
}

async function launchWithContent(markdown: string): Promise<void> {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-cd-ws-"));
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

/** Click the checkbox glyph of the first task item. The editor's handler
 *  treats any click within 28px of the <li>'s left edge as a checkbox hit
 *  (same coordinate-zone technique as bullet-zoom.spec.ts's clickBulletGlyph). */
async function clickFirstCheckbox(): Promise<void> {
  const li = window.locator(".ProseMirror li[data-checked]").first();
  const box = await li.boundingBox();
  if (!box) throw new Error("no bounding box for the task <li>");
  await window.mouse.click(box.x + 8, box.y + Math.min(10, box.height / 2));
}

/** Plain text of the first task item's paragraph, whitespace untouched
 *  (toHaveText would normalize away a stray double/trailing space). */
async function firstTaskText(): Promise<string> {
  return window
    .locator(".ProseMirror li[data-checked] p")
    .first()
    .evaluate((el) => el.textContent ?? "");
}

async function setRecordCompletionDates(on: boolean): Promise<void> {
  await window.keyboard.press("Control+,");
  const toggle = window.locator(
    ".settings-toggle[aria-label='Record completion dates']",
  );
  await expect(toggle).toBeVisible({ timeout: 8_000 });
  const isOn = (await toggle.getAttribute("aria-checked")) === "true";
  if (isOn !== on) await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", on ? "true" : "false");
  await window.locator(".settings-close-btn").click();
  await expect(window.locator(".settings-overlay")).toHaveCount(0, {
    timeout: 5_000,
  });
}

// Autosave debounce is 3s by default; wait it out, then read the saved file.
async function readSaved(): Promise<string> {
  await window.waitForTimeout(4_500);
  return readFile(filePath, "utf-8");
}

test("with the setting OFF (default), checking a task writes no done field", async () => {
  await launchWithContent("- [ ] Pay rent\n");

  await clickFirstCheckbox();
  await expect(
    window.locator('.ProseMirror li[data-checked="true"]').first(),
  ).toBeVisible({ timeout: 5_000 });
  expect(await firstTaskText()).toBe("Pay rent");
  await expect(window.locator(".ProseMirror .meta-chip--done")).toHaveCount(0);

  const onDisk = await readSaved();
  expect(onDisk).toMatch(/\[x\] Pay rent/);
  expect(onDisk).not.toContain("[done::");
  expect(onDisk).not.toContain("\\[done::");
});

test("with the setting ON, checking appends [done:: today] with a done chip and unchecking removes it cleanly", async () => {
  await launchWithContent("- [ ] Pay rent\n");
  await setRecordCompletionDates(true);

  // (b) check: done field appended, chip rendered.
  await clickFirstCheckbox();
  await expect(
    window.locator('.ProseMirror li[data-checked="true"]').first(),
  ).toBeVisible({ timeout: 5_000 });
  expect(await firstTaskText()).toBe(`Pay rent [done:: ${isoDate(0)}]`);
  await expect(
    window.locator(".ProseMirror .meta-chip--done").first(),
  ).toBeVisible();
  await expect(window.locator(".ProseMirror .meta-chip--due")).toHaveCount(0);

  // The leading `[` may be backslash-escaped on disk (pre-existing commonmark
  // serializer behavior, round-trip safe), so tolerate it.
  const checkedOnDisk = await readSaved();
  expect(checkedOnDisk).toMatch(
    new RegExp(`\\[x\\] Pay rent \\\\?\\[done:: ${isoDate(0)}\\\\?\\]`),
  );

  // (c) uncheck: done field gone, no trailing space left behind.
  await clickFirstCheckbox();
  await expect(
    window.locator('.ProseMirror li[data-checked="false"]').first(),
  ).toBeVisible({ timeout: 5_000 });
  expect(await firstTaskText()).toBe("Pay rent");
  await expect(window.locator(".ProseMirror .meta-chip--done")).toHaveCount(0);

  const uncheckedOnDisk = await readSaved();
  expect(uncheckedOnDisk).not.toContain("done::");
  expect(uncheckedOnDisk).toMatch(/^[-*] \[ \] Pay rent$/m);
});
