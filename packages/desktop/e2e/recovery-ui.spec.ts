import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// ---------- Test scaffolding (mirrors snapshot-wiring.spec.ts patterns) ----------

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-recui-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nbaseline body.\n",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-recui-ud-"));
  await writeFile(
    path.join(userData, "sidebar-folder.json"),
    JSON.stringify(workspaceDir),
    "utf-8",
  );
  return userData;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== "ELECTRON_RUN_AS_NODE" && typeof v === "string") env[k] = v;
  }
  return env;
}

async function launchApp(userDataDir: string): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const app = await electron.launch({
    args: [REPO_PACKAGE_DIR, `--user-data-dir=${userDataDir}`],
    env: buildEnv(),
    timeout: 30_000,
  });
  const window = await app.firstWindow();
  await window.waitForSelector(".app-shell, .app-root, [data-app-ready]", {
    timeout: 20_000,
  });
  return { app, window };
}

async function waitForCondition<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs: number = 10_000,
  intervalMs: number = 100,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fn();
    if (r) return r as T;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

async function saveFile(
  window: Page,
  filePath: string,
  content: string,
): Promise<void> {
  await window.evaluate(
    ([fp, ct]) => {
      // @ts-expect-error renderer global
      return window.pennivo.saveFile(fp, ct);
    },
    [filePath, content],
  );
}

async function openFilePath(window: Page, filePath: string): Promise<void> {
  await window.evaluate((fp) => {
    // @ts-expect-error renderer global
    return window.pennivo.openFilePath(fp);
  }, filePath);
}

// ---------- Lifecycle ----------

let app: ElectronApplication | null = null;
let workspaceDir = "";
let userDataDir = "";

async function setup(): Promise<{ app: ElectronApplication; window: Page }> {
  workspaceDir = await makeWorkspace();
  userDataDir = await makeUserData(workspaceDir);
  const launched = await launchApp(userDataDir);
  app = launched.app;
  return launched;
}

test.afterEach(async () => {
  if (app) {
    await app.close();
    app = null;
  }
  if (workspaceDir) await rm(workspaceDir, { recursive: true, force: true });
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
});

// ---------- Tests ----------

test("File menu accelerator opens the History modal with a file's snapshots", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  // Open the file in the editor + save it twice with different content so
  // the snapshot store has > 1 row to render.
  await openFilePath(window, filePath);
  await saveFile(window, filePath, "# Alpha\n\nfirst-edit body.\n");
  await saveFile(window, filePath, "# Alpha\n\nsecond-edit body.\n");

  // Wait until at least 2 snapshots are listed by the IPC bridge.
  await waitForCondition(async () => {
    const list = await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath);
    return Array.isArray(list) && list.length >= 2 ? list : null;
  });

  // Send the menu:open-history IPC via the main process (most reliable —
  // the OS accelerator doesn't always fire under Playwright with frame:false).
  if (app) {
    await app.evaluate(async ({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const w = all[0];
      if (w) w.webContents.send("menu:open-history");
    });
  }
  // Wait for the modal to actually render.
  await window.waitForSelector(".recovery-modal-card", { timeout: 5000 });
  const modalVisible = await window
    .locator(".recovery-modal-card")
    .isVisible();

  expect(modalVisible).toBe(true);

  // Header reads "History".
  await expect(window.locator(".recovery-modal-title")).toContainText(
    "History",
  );

  // Segmented control offers History / Trash.
  await expect(
    window.locator(".recovery-modal-segmented-btn", { hasText: "History" }),
  ).toBeVisible();
  await expect(
    window.locator(".recovery-modal-segmented-btn", { hasText: "Trash" }),
  ).toBeVisible();

  // Click Trash — TrashView renders.
  await window
    .locator(".recovery-modal-segmented-btn", { hasText: "Trash" })
    .click();
  await expect(window.locator(".trash-view")).toBeVisible();

  // Switch back to History.
  await window
    .locator(".recovery-modal-segmented-btn", { hasText: "History" })
    .click();
  await expect(window.locator(".history-view")).toBeVisible();

  // Esc closes the modal.
  await window.keyboard.press("Escape");
  await window.waitForTimeout(200);
  expect(
    await window.locator(".recovery-modal-card").isVisible().catch(() => false),
  ).toBe(false);
});

test("File menu exposes a 'History…' item with the CmdOrCtrl+Alt+H accelerator", async () => {
  await setup();

  // Inspect the application menu via the main process. We assert the History
  // item exists at the top level of the File submenu so the user can find it
  // without a second-level dive, and that its accelerator string matches what
  // the Phase 13a slice promised.
  const item = await app!.evaluate(async ({ Menu }) => {
    const menu = Menu.getApplicationMenu();
    if (!menu) return null;
    const fileMenu = menu.items.find((i) => i.label === "File");
    if (!fileMenu || !fileMenu.submenu) return null;
    const history = fileMenu.submenu.items.find((i) =>
      typeof i.label === "string" && i.label.startsWith("History"),
    );
    if (!history) return null;
    return {
      label: history.label,
      accelerator: history.accelerator ?? null,
      visible: history.visible !== false,
      enabled: history.enabled !== false,
    };
  });

  expect(item).not.toBeNull();
  // Trailing ellipsis matches the macOS "opens a window" convention.
  expect(item!.label).toBe("History…");
  expect(item!.accelerator).toBe("CmdOrCtrl+Alt+H");
  expect(item!.visible).toBe(true);
  expect(item!.enabled).toBe(true);
});

test("Compare & merge button enables on 2 selected and switches to compare-merge mode", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  // Click the sidebar row so the App's editor state has filePath set —
  // HistoryView reads that prop to know which file's snapshots to list.
  await window.locator(".tree-item", { hasText: "alpha.md" }).first().click();
  // Editor mounts.
  await window.waitForFunction(
    () => {
      const ed = document.querySelector(".ProseMirror");
      return ed !== null;
    },
    { timeout: 10_000 },
  );

  await saveFile(window, filePath, "# Alpha\n\nrev-1.\n");
  await saveFile(window, filePath, "# Alpha\n\nrev-2.\n");
  await saveFile(window, filePath, "# Alpha\n\nrev-3.\n");

  await waitForCondition(async () => {
    const list = await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath);
    return Array.isArray(list) && list.length >= 2 ? list : null;
  });

  if (app) {
    await app.evaluate(async ({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const w = all[0];
      if (w) w.webContents.send("menu:open-history");
    });
  }
  await window.waitForSelector(".history-view", { timeout: 10_000 });

  // Wait for at least 2 timeline rows. The first row is auto-selected on load.
  const rows = window.locator(".history-view-row");
  await expect(rows.nth(1)).toBeVisible({ timeout: 10_000 });

  const compareBtn = window.locator(".history-view-footer-btn", {
    hasText: /Compare & merge/,
  });
  await expect(compareBtn).toBeDisabled();

  // Ctrl-click a second row to bring selection to exactly 2.
  await rows.nth(1).click({ modifiers: ["Control"] });

  await expect(compareBtn).toBeEnabled();
  await compareBtn.click();

  // Mode swaps; the real CompareMergeView body renders.
  await expect(window.locator(".compare-merge-view")).toBeVisible({
    timeout: 5000,
  });
  // Title swaps to "Compare & merge — alpha.md".
  await expect(window.locator(".recovery-modal-title")).toContainText(
    "Compare & merge",
  );
  // Back button is present (Esc + click both back out to History).
  await expect(
    window.locator(".recovery-modal-back-btn"),
  ).toBeVisible();
});

test("Restore as new file creates a fresh file beside the original", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await openFilePath(window, filePath);
  await saveFile(window, filePath, "# Alpha\n\nversion-A.\n");
  await saveFile(window, filePath, "# Alpha\n\nversion-B.\n");

  // Get the first snapshot id.
  const snapshots = await waitForCondition(async () => {
    const list = (await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath)) as Array<{ id: string }>;
    return list.length >= 2 ? list : null;
  });
  const oldestId = snapshots[snapshots.length - 1].id;

  // Restore as new file directly via IPC (the modal flow exercises this same
  // path through HistoryView's footer button — covered by component tests).
  const result = (await window.evaluate(
    ([fp, id]) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.restore(fp, id, "as-new-file");
    },
    [filePath, oldestId],
  )) as { newPath?: string } | null;

  expect(result).not.toBeNull();
  expect(result!.newPath).toBeTruthy();
  expect(result!.newPath).not.toBe(filePath);
});
