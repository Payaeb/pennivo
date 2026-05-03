import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-saveas-ud-"));
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
  await window.waitForSelector(".ProseMirror", { timeout: 20_000 });

  // Monkey-patch dialog.showSaveDialog in the main process to capture the
  // defaultPath the renderer asked for and bail out (canceled:true) so no
  // OS-level dialog is left lingering at teardown. We stash the original on
  // a global so afterEach can restore it.
  await app.evaluate(({ dialog }) => {
    const recorded: Array<{ defaultPath?: string }> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = global as any;
    g.__pennivoSaveAsCaptured = recorded;
    g.__pennivoOriginalShowSaveDialog = dialog.showSaveDialog;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dialog as any).showSaveDialog = async (...args: unknown[]) => {
      const opts = args[args.length - 1] as { defaultPath?: string };
      recorded.push({ defaultPath: opts?.defaultPath });
      return { canceled: true, filePath: undefined };
    };
  });
});

test.afterEach(async () => {
  try {
    // Restore the original dialog method before teardown to avoid blocking
    // app.close() (a past Menu.prototype.popup monkey-patch caused issues here).
    await app.evaluate(({ dialog }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = global as any;
      if (g.__pennivoOriginalShowSaveDialog) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dialog as any).showSaveDialog = g.__pennivoOriginalShowSaveDialog;
      }
    });
  } catch {
    // ignore
  }
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
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

async function readCaptured(): Promise<Array<{ defaultPath?: string }>> {
  return app.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = global as any;
    const recorded = g.__pennivoSaveAsCaptured ?? [];
    g.__pennivoSaveAsCaptured = [];
    return recorded;
  });
}

async function typeIntoEditor(content: string) {
  await window.locator(".ProseMirror").click();
  await window.keyboard.press("Control+a");
  await window.keyboard.press("Delete");
  await window.keyboard.type(content);
  // Let Milkdown's listener fire so markdownRef.current updates before save.
  await window.waitForTimeout(300);
}

async function triggerSaveAs() {
  // Save As is wired to the Electron menu's "menu:save-as" IPC, not a
  // renderer-side keyboard listener — so Ctrl+Shift+S in the page won't
  // fire it. Send the IPC directly from the main process.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send("menu:save-as");
  });
  // Give the IPC round-trip a moment to land in our captured array.
  await window.waitForTimeout(800);
}

test("Save As default name comes from the H1 heading on the first line", async () => {
  await typeIntoEditor("# Project Plan");
  await triggerSaveAs();

  const captured = await readCaptured();
  expect(captured).toHaveLength(1);
  expect(captured[0].defaultPath).toBe("Project Plan.md");
});

test("Save As default name falls back to plain first line when no heading", async () => {
  await typeIntoEditor("Just some thoughts I had today");
  await triggerSaveAs();

  const captured = await readCaptured();
  expect(captured[0].defaultPath).toBe("Just some thoughts I had today.md");
});

test("Save As default name is 'Untitled.md' for an empty editor", async () => {
  // beforeEach left the editor empty; just trigger Save As.
  await window.locator(".ProseMirror").click();
  await triggerSaveAs();

  const captured = await readCaptured();
  expect(captured[0].defaultPath).toBe("Untitled.md");
});
