// Security: the right-click "Open Link" item must never hand a non-web URL
// (file:, UNC, ms-*:, ...) to the OS. The native popup cannot be clicked from
// Playwright, so the main process is instrumented: Menu.buildFromTemplate is
// wrapped to record the template and skip the blocking native popup, and
// shell.openExternal is replaced by a recorder. The recorded "Open Link" item
// is then clicked directly, which exercises the real main-process guard.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

let app: ElectronApplication;
let window: Page;
let workspaceDir: string;
let userDataDir: string;

const DOC = [
  "# Links",
  "",
  "[local exe](file:///C:/Windows/System32/calc.exe)",
  "",
  "[web page](https://example.com/page)",
  "",
].join("\n");

test.beforeAll(async () => {
  workspaceDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ls-ws-"));
  userDataDir = await mkdtemp(path.join(tmpdir(), "pennivo-e2e-ls-ud-"));
  await writeFile(path.join(workspaceDir, "links.md"), DOC, "utf-8");
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
  await window
    .locator(
      `[data-path="${path.join(workspaceDir, "links.md").replace(/\\/g, "/")}"]`,
    )
    .click();
  await window.waitForSelector(".ProseMirror a", { timeout: 10_000 });

  await app.evaluate(({ Menu, shell }) => {
    const g = globalThis as unknown as {
      __templates: Array<Array<{ label?: string; click?: () => void }>>;
      __opened: string[];
    };
    g.__templates = [];
    g.__opened = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (shell as any).openExternal = async (url: string) => {
      g.__opened.push(url);
    };
    const original = Menu.buildFromTemplate.bind(Menu);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Menu as any).buildFromTemplate = (template: any[]) => {
      g.__templates.push(template);
      const menu = original(template);
      menu.popup = () => {};
      return menu;
    };
  });
});

test.afterAll(async () => {
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
  await rm(workspaceDir, { recursive: true, force: true }).catch(() => {});
  await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
});

async function rightClickLink(text: string): Promise<string[]> {
  await app.evaluate(() => {
    (globalThis as unknown as { __templates: unknown[] }).__templates.length =
      0;
  });
  await window.locator(".ProseMirror a", { hasText: text }).click({
    button: "right",
  });
  await expect
    .poll(
      () =>
        app.evaluate(
          () =>
            (globalThis as unknown as { __templates: unknown[] }).__templates
              .length,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  return app.evaluate(() => {
    const t = (
      globalThis as unknown as {
        __templates: Array<Array<{ label?: string }>>;
      }
    ).__templates.at(-1)!;
    return t.map((i) => i.label ?? "");
  });
}

async function clickMenuItem(label: string): Promise<void> {
  await app.evaluate((_e, l) => {
    const t = (
      globalThis as unknown as {
        __templates: Array<Array<{ label?: string; click?: () => void }>>;
      }
    ).__templates.at(-1)!;
    t.find((i) => i.label === l)?.click?.();
  }, label);
}

async function openedUrls(): Promise<string[]> {
  return app.evaluate(() =>
    (globalThis as unknown as { __opened: string[] }).__opened.slice(),
  );
}

test("a file:/// link offers no Open Link and nothing reaches shell.openExternal", async () => {
  const labels = await rightClickLink("local exe");
  expect(labels).toContain("Copy Link Address");
  expect(labels).not.toContain("Open Link");
  expect(await openedUrls()).toEqual([]);
});

test("an https link still offers Open Link and opens it", async () => {
  const labels = await rightClickLink("web page");
  expect(labels).toContain("Open Link");
  expect(labels).toContain("Copy Link Address");
  await clickMenuItem("Open Link");
  expect(await openedUrls()).toEqual(["https://example.com/page"]);
});

test("the main-process guard refuses hostile URLs sent over the Ctrl+click IPC", async () => {
  // Defence in depth: the enforcing check lives in main, not only in the menu
  // builder. Drive the Ctrl+click IPC path with hostile values.
  await window.evaluate(() => {
    const api = (
      window as unknown as {
        pennivo: { openExternal: (u: string) => void };
      }
    ).pennivo;
    for (const u of [
      "file:///C:/Windows/System32/calc.exe",
      "\\\\host\\share\\x",
      "ms-msdt:x",
      "search-ms:query=x",
      "javascript:alert(1)",
      "mailto:a@b.c",
    ]) {
      api.openExternal(u);
    }
    api.openExternal("https://example.com/ok");
  });
  await expect
    .poll(openedUrls)
    .toEqual(["https://example.com/page", "https://example.com/ok"]);
});
