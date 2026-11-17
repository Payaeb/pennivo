// Startup settings application must never eat keystrokes. Launches with saved
// non-default appearance settings and types as soon as the window is ready,
// into both the command palette and the editor, repeated to catch flakiness.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  return env;
}

async function launchWith(
  settings: Record<string, unknown>,
): Promise<{ app: ElectronApplication; window: Page; ud: string }> {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-st-"));
  await writeFile(path.join(ud, "settings.json"), JSON.stringify(settings));
  const app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${ud}`],
    env: buildEnv(),
    timeout: 30_000,
  });
  const window = await app.firstWindow();
  await window.waitForSelector(".app-shell", { timeout: 20_000 });
  return { app, window, ud };
}

async function shutdown(app: ElectronApplication, ud: string) {
  try {
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.destroy();
    });
  } catch {
    // ignore
  }
  try {
    await app.close();
  } catch {
    // ignore
  }
  await rm(ud, { recursive: true, force: true }).catch(() => {});
}

const CASES: Array<[string, Record<string, unknown>]> = [
  ["wide", { editorWidth: "wide" }],
  ["full", { editorWidth: "full" }],
  ["narrow", { editorWidth: "narrow" }],
  ["default", {}],
  ["wide + font", { editorWidth: "wide", editorFontSize: 20 }],
];
const ROUNDS = 3;

for (const [name, settings] of CASES) {
  test(`typing right after launch lands in full (${name})`, async () => {
    test.setTimeout(120_000);
    for (let i = 0; i < ROUNDS; i++) {
      const { app, window, ud } = await launchWith(settings);
      try {
        // command palette, typed the instant it appears
        await window.keyboard.press("Control+Shift+P");
        await window.waitForSelector(".command-palette", { timeout: 3000 });
        await window.keyboard.type("settings");
        await expect(window.locator(".command-palette input")).toHaveValue(
          "settings",
          { timeout: 1000 },
        );
        // run it: Enter on "settings" must open the panel (modal-close flow)
        await window.keyboard.press("Enter");
        await expect(window.locator(".settings-overlay")).toBeVisible({
          timeout: 3000,
        });
        await window.keyboard.press("Escape");
        await expect(window.locator(".settings-overlay")).toHaveCount(0);

        // editor, clicked and typed immediately
        await window.locator(".ProseMirror").first().click();
        const text = "The quick brown fox 12345";
        await window.keyboard.type(text);
        await expect(window.locator(".ProseMirror").first()).toContainText(
          text,
          { timeout: 2000 },
        );
      } finally {
        await shutdown(app, ud);
      }
    }
  });
}
