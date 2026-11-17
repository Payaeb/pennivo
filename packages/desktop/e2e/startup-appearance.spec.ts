// Saved appearance settings (editor font size, font family, width) must be in
// effect right after launch, without opening the Settings panel.

import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

test("saved font size, font family and width apply at startup without opening Settings", async () => {
  const ud = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-sa-"));
  await writeFile(
    path.join(ud, "settings.json"),
    JSON.stringify({
      editorFontSize: 21,
      editorFontFamily: "monospace",
      editorWidth: "wide",
    }),
  );
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
    await window.waitForSelector(".ProseMirror", { timeout: 20_000 });
    const m = await window.evaluate(() => {
      const pm = document.querySelector<HTMLElement>(".ProseMirror")!;
      const p = pm.querySelector("p") ?? pm;
      const cs = getComputedStyle(p);
      const col = document.querySelector<HTMLElement>(".app-editor-column")!;
      return {
        size: cs.fontSize,
        family: cs.fontFamily,
        col: col.getBoundingClientRect().width,
        settingsOpen: !!document.querySelector(".settings-panel"),
      };
    });
    expect(m.settingsOpen).toBe(false);
    expect(m.size).toBe("21px");
    expect(m.family).toContain("Cascadia Code");
    expect(m.col).toBe(960);
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
  }
});
