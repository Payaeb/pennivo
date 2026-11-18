// One-time reset of an unchosen saved font size 16 (written by versions up to
// 1.7.0) to the real default 17. A 16 chosen afterwards must stick forever.
// Always uses an isolated user data directory.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");
const MARKER = "fontSizeDefaultMigrated";

let ud: string;
let app: ElectronApplication | null = null;

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  return env;
}

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${ud}`],
    env: buildEnv(),
    timeout: 30_000,
  });
  const window = await app.firstWindow();
  await window.waitForSelector(".ProseMirror", { timeout: 20_000 });
  return window;
}

async function close(): Promise<void> {
  if (!app) return;
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
  } catch {
    // ignore
  }
  await app.close().catch(() => {});
  app = null;
}

async function editorSize(window: Page): Promise<string> {
  return window.evaluate(() => {
    const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
    const p = pm.querySelector("p") ?? pm;
    return getComputedStyle(p).fontSize;
  });
}

async function readSaved(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(ud, "settings.json"), "utf-8"));
}

test.beforeEach(async () => {
  ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-fsm-"));
});

test.afterEach(async () => {
  await close();
  await rm(ud, { recursive: true, force: true }).catch(() => {});
});

test("a saved 16 becomes 17 once; a 16 chosen later sticks across restarts", async () => {
  test.setTimeout(120_000);
  await writeFile(
    path.join(ud, "settings.json"),
    JSON.stringify({ editorFontSize: 16, autoSave: true }),
  );

  // (a) first launch after updating: 17px at first paint, file migrated.
  let window = await launch();
  expect(await editorSize(window)).toBe("17px");
  const migrated = await readSaved();
  expect(migrated.editorFontSize).toBe(17);
  expect(migrated[MARKER]).toBe(true);
  expect(migrated.autoSave).toBe(true);

  // Settings shows 17, then the user deliberately picks 16.
  await window.keyboard.press("Control+,");
  const slider = window.locator("input.settings-slider").first();
  await slider.waitFor({ state: "visible" });
  await expect(slider).toHaveValue("17");
  await slider.fill("16");
  await expect(slider).toHaveValue("16");
  await expect.poll(async () => (await readSaved()).editorFontSize).toBe(16);
  expect((await readSaved())[MARKER]).toBe(true);
  await window.keyboard.press("Escape");
  await close();

  // (b) restart: the chosen 16 stays, twice.
  for (let i = 0; i < 2; i++) {
    window = await launch();
    expect(await editorSize(window)).toBe("16px");
    const saved = await readSaved();
    expect(saved.editorFontSize).toBe(16);
    expect(saved[MARKER]).toBe(true);
    await close();
  }
});

test("a saved size other than 16 is kept and the marker is set", async () => {
  await writeFile(
    path.join(ud, "settings.json"),
    JSON.stringify({ editorFontSize: 20 }),
  );
  const window = await launch();
  expect(await editorSize(window)).toBe("20px");
  const saved = await readSaved();
  expect(saved.editorFontSize).toBe(20);
  expect(saved[MARKER]).toBe(true);
});

test("no settings file starts at 17px and a later chosen 16 is never reset", async () => {
  test.setTimeout(120_000);
  let window = await launch();
  expect(await editorSize(window)).toBe("17px");

  await window.keyboard.press("Control+,");
  const slider = window.locator("input.settings-slider").first();
  await slider.waitFor({ state: "visible" });
  await slider.fill("16");
  await expect
    .poll(async () => {
      try {
        return (await readSaved()).editorFontSize;
      } catch {
        return undefined;
      }
    })
    .toBe(16);
  expect((await readSaved())[MARKER]).toBe(true);
  await window.keyboard.press("Escape");
  await close();

  window = await launch();
  expect(await editorSize(window)).toBe("16px");
  expect((await readSaved()).editorFontSize).toBe(16);
});
