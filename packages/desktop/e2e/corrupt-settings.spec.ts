// A settings.json that parses as valid JSON but is not an object (null, a
// number, ...) must not stop the app from starting.

import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

for (const raw of ["null", "123", '"text"', "[]"]) {
  test(`settings.json containing ${raw} still starts the app`, async () => {
    const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-cs-"));
    const ws = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-cs-ws-"));
    await writeFile(path.join(ws, "a.md"), "# A\n\nbody\n");
    await writeFile(path.join(ud, "settings.json"), raw);
    await writeFile(path.join(ud, "sidebar-folder.json"), JSON.stringify(ws));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
    }
    const app = await electron.launch({
      args: [REPO_PACKAGE_DIR, `--user-data-dir=${ud}`],
      env,
      timeout: 30_000,
    });
    try {
      const window = await app.firstWindow();
      await window.waitForSelector(".sidebar", { timeout: 20_000 });
      await window.waitForSelector(".ProseMirror", { timeout: 20_000 });
      await window.click(".ProseMirror");
      await window.keyboard.type("abc");
      await expect(window.locator(".ProseMirror")).toContainText("abc");
      await expect(window.locator(".error-boundary")).toHaveCount(0);
    } finally {
      try {
        await app.evaluate(({ BrowserWindow }) => {
          for (const w of BrowserWindow.getAllWindows()) w.destroy();
        });
      } catch {
        // ignore
      }
      await app.close().catch(() => {});
      await rm(ud, { recursive: true, force: true }).catch(() => {});
      await rm(ws, { recursive: true, force: true }).catch(() => {});
    }
  });
}
