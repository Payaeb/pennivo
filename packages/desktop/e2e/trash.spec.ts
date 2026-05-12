// E2E tests for the Phase 13a soft-delete trash, against real Electron.
//
// Each test seeds a fresh workspace + userData dir, then drives the
// `sidebar:delete-file`, `trash:list`, `trash:restore`,
// `trash:permanently-delete`, and `trash:sweep` IPCs through the renderer's
// preload bridge.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

// ---------- Scaffolding (mirrors snapshot-wiring.spec.ts) ----------

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-trash-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nfirst version.\n",
    "utf-8",
  );
  await writeFile(
    path.join(dir, "bravo.md"),
    "# Bravo\n\nsecond file.\n",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-trash-ud-"));
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

function sha1(s: string): string {
  return createHash("sha1").update(s, "utf-8").digest("hex");
}

function trashIdForPath(absolutePath: string, deletedAtMs: number): string {
  let p = absolutePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) p = p[0]!.toLowerCase() + p.slice(1);
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return `${sha1(p)}-${deletedAtMs}`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined>,
  timeoutMs: number = 10_000,
  intervalMs: number = 100,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result as T;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

// ---------- IPC bridges ----------

async function invokeDelete(
  window: Page,
  filePath: string,
  includeAssets: boolean,
): Promise<boolean> {
  return window.evaluate(
    ([fp, ia]) => {
      // @ts-expect-error renderer global injected by preload
      return window.pennivo.deleteFile(fp, ia);
    },
    [filePath, includeAssets] as const,
  );
}

async function invokeDeletePermanently(
  window: Page,
  filePath: string,
  includeAssets: boolean,
): Promise<boolean> {
  return window.evaluate(
    ([fp, ia]) => {
      // @ts-expect-error renderer global injected by preload
      return window.pennivo.deleteFilePermanently(fp, ia);
    },
    [filePath, includeAssets] as const,
  );
}

interface TrashEntryDTO {
  id: string;
  absolutePath: string;
  fileBasename: string;
  deletedAtMs: number;
  expiresAtMs: number | null;
  hasAssets: boolean;
  assetFolderNames: string[];
}

async function invokeTrashList(window: Page): Promise<TrashEntryDTO[]> {
  return window.evaluate(() => {
    // @ts-expect-error
    return window.pennivo.trash.list();
  }) as Promise<TrashEntryDTO[]>;
}

async function invokeTrashRestore(
  window: Page,
  trashId: string,
): Promise<{ restoredPath: string } | null> {
  return window.evaluate((id) => {
    // @ts-expect-error
    return window.pennivo.trash.restore(id);
  }, trashId);
}

async function invokeTrashPermanentlyDelete(
  window: Page,
  trashId: string,
): Promise<boolean> {
  return window.evaluate((id) => {
    // @ts-expect-error
    return window.pennivo.trash.permanentlyDelete(id);
  }, trashId);
}

async function invokeTrashSweep(
  window: Page,
): Promise<{ removedCount: number }> {
  return window.evaluate(() => {
    // @ts-expect-error
    return window.pennivo.trash.sweep();
  });
}

async function invokeSettingsGet(
  window: Page,
): Promise<Record<string, unknown>> {
  return window.evaluate(() => {
    // @ts-expect-error
    return window.pennivo.getSettings();
  }) as Promise<Record<string, unknown>>;
}

async function invokeSettingsSet(
  window: Page,
  settings: unknown,
): Promise<void> {
  await window.evaluate((s) => {
    // @ts-expect-error
    return window.pennivo.setSettings(s);
  }, settings);
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

test("soft-delete moves the file into trash and removes it from workspace", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  const ok = await invokeDelete(window, filePath, false);
  expect(ok).toBe(true);

  // Workspace file is gone
  expect(await pathExists(filePath)).toBe(false);

  // Trash dir contains exactly one entry with content.md + meta.json
  const trashRoot = path.join(userDataDir, "trash");
  const entries = await readdir(trashRoot);
  expect(entries.length).toBe(1);
  const entryDir = path.join(trashRoot, entries[0]!);
  expect(await pathExists(path.join(entryDir, "content.md"))).toBe(true);
  expect(await pathExists(path.join(entryDir, "meta.json"))).toBe(true);

  // Content matches what was on disk
  const trashed = await readFile(path.join(entryDir, "content.md"), "utf-8");
  expect(trashed).toBe("# Alpha\n\nfirst version.\n");

  // meta.json carries the original absolute path + Forever-not-set expiresAtMs
  const meta = JSON.parse(
    await readFile(path.join(entryDir, "meta.json"), "utf-8"),
  );
  expect(meta.fileBasename).toBe("alpha.md");
  expect(meta.absolutePath.replace(/\\/g, "/").toLowerCase()).toBe(
    filePath.replace(/\\/g, "/").toLowerCase(),
  );
  // Default retention is 30 days → expiresAtMs is non-null in the future.
  expect(typeof meta.expiresAtMs).toBe("number");
  expect(meta.expiresAtMs).toBeGreaterThan(Date.now());
});

test("soft-delete with includeAssets moves owned *-md-images folder under assets/", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");
  const imgFolder = path.join(workspaceDir, "alpha-md-images");
  await mkdir(imgFolder);
  await writeFile(
    path.join(imgFolder, "paste-1.png"),
    "fake png bytes",
    "binary",
  );
  // Reference the asset folder so findAssetFoldersForFile picks it up
  await writeFile(
    filePath,
    "# Alpha\n\n![](./alpha-md-images/paste-1.png)\n",
    "utf-8",
  );

  const ok = await invokeDelete(window, filePath, true);
  expect(ok).toBe(true);

  // File + asset folder both gone from workspace
  expect(await pathExists(filePath)).toBe(false);
  expect(await pathExists(imgFolder)).toBe(false);

  const trashRoot = path.join(userDataDir, "trash");
  const entries = await readdir(trashRoot);
  expect(entries.length).toBe(1);
  const entryDir = path.join(trashRoot, entries[0]!);
  expect(
    await pathExists(path.join(entryDir, "assets", "alpha-md-images", "paste-1.png")),
  ).toBe(true);

  const meta = JSON.parse(
    await readFile(path.join(entryDir, "meta.json"), "utf-8"),
  );
  expect(meta.hasAssets).toBe(true);
  expect(meta.assetFolderNames).toContain("alpha-md-images");
});

test("trash.restore returns the file to its original path and removes the trash entry", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await invokeDelete(window, filePath, false);
  expect(await pathExists(filePath)).toBe(false);

  const trashEntries = await invokeTrashList(window);
  expect(trashEntries.length).toBe(1);
  const trashId = trashEntries[0]!.id;

  const result = await invokeTrashRestore(window, trashId);
  expect(result).not.toBeNull();
  expect(result!.restoredPath.replace(/\\/g, "/").toLowerCase()).toBe(
    filePath.replace(/\\/g, "/").toLowerCase(),
  );

  // File is back, trash entry is gone
  expect(await pathExists(filePath)).toBe(true);
  const restored = await readFile(filePath, "utf-8");
  expect(restored).toBe("# Alpha\n\nfirst version.\n");

  const remaining = await invokeTrashList(window);
  expect(remaining.length).toBe(0);
});

test("trash.restore when a file already exists at the original path lands beside as (restored).md", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await invokeDelete(window, filePath, false);
  // Recreate the file at the original path with new content
  await writeFile(filePath, "# Alpha\n\nrewritten after delete.\n", "utf-8");

  const trashEntries = await invokeTrashList(window);
  const trashId = trashEntries[0]!.id;
  const result = await invokeTrashRestore(window, trashId);
  expect(result).not.toBeNull();
  const expected = path.join(workspaceDir, "alpha (restored).md");
  expect(result!.restoredPath.replace(/\\/g, "/").toLowerCase()).toBe(
    expected.replace(/\\/g, "/").toLowerCase(),
  );

  // Both files exist now
  expect(await pathExists(filePath)).toBe(true);
  expect(await pathExists(expected)).toBe(true);
  const restored = await readFile(expected, "utf-8");
  expect(restored).toBe("# Alpha\n\nfirst version.\n");
});

test("trash.permanentlyDelete wipes the trash entry; original path stays empty", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await invokeDelete(window, filePath, false);
  const trashEntries = await invokeTrashList(window);
  const trashId = trashEntries[0]!.id;

  const ok = await invokeTrashPermanentlyDelete(window, trashId);
  expect(ok).toBe(true);

  expect(await pathExists(filePath)).toBe(false);
  expect(await pathExists(path.join(userDataDir, "trash", trashId))).toBe(false);
  expect((await invokeTrashList(window)).length).toBe(0);
});

test("sweepExpired removes entries whose expiresAtMs is in the past", async () => {
  const { window } = await setup();
  // Hand-craft a trash entry with a past expiresAtMs.
  const trashRoot = path.join(userDataDir, "trash");
  await mkdir(trashRoot, { recursive: true });
  const fakeAbsPath = path.join(workspaceDir, "fake.md");
  const past = Date.now() - 100 * 24 * 60 * 60 * 1000; // 100 days ago
  const id = trashIdForPath(fakeAbsPath, past);
  const entryDir = path.join(trashRoot, id);
  await mkdir(entryDir, { recursive: true });
  await writeFile(path.join(entryDir, "content.md"), "stale content", "utf-8");
  await writeFile(
    path.join(entryDir, "meta.json"),
    JSON.stringify({
      id,
      absolutePath: fakeAbsPath,
      fileBasename: "fake.md",
      deletedAtMs: past,
      expiresAtMs: past + 30 * 24 * 60 * 60 * 1000, // 70 days ago
      hasAssets: false,
      assetFolderNames: [],
    }),
    "utf-8",
  );

  const result = await invokeTrashSweep(window);
  expect(result.removedCount).toBeGreaterThanOrEqual(1);
  expect(await pathExists(entryDir)).toBe(false);
});

test("Forever retention (-1) writes expiresAtMs: null and survives sweep far in the future", async () => {
  const { window } = await setup();

  // Set retention to Forever (-1)
  const settings = (await invokeSettingsGet(window)) as Record<string, unknown>;
  const recovery = settings.recovery as Record<string, unknown>;
  recovery.trashRetentionDays = -1;
  await invokeSettingsSet(window, { ...settings, recovery });

  const filePath = path.join(workspaceDir, "alpha.md");
  await invokeDelete(window, filePath, false);

  const trashEntries = await invokeTrashList(window);
  expect(trashEntries.length).toBe(1);
  expect(trashEntries[0]!.expiresAtMs).toBeNull();

  // Sweep with no override of `now` — Forever entries should never be touched.
  const before = await invokeTrashList(window);
  await invokeTrashSweep(window);
  const after = await invokeTrashList(window);
  expect(after.length).toBe(before.length);
  expect(after[0]!.expiresAtMs).toBeNull();
});

test("delete-confirm dialog copy mentions the file is moved to Trash and restorable", async () => {
  // User-facing copy regression guard: the design says the dialog should
  // tell the user their delete is reversible via Trash. We open the
  // right-click delete confirm dialog and assert the message text.
  const { window } = await setup();

  const filePath = path.join(workspaceDir, "alpha.md").replace(/\\/g, "/");
  await window.locator(".sidebar").waitFor({ timeout: 5_000 });
  const fileRow = window.locator(`[data-path="${filePath}"]`);
  await fileRow.click({ button: "right" });
  await window
    .locator(".context-menu-item-label", { hasText: "Delete" })
    .click();

  const dialog = window.locator("[role=alertdialog]");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  await expect(dialog).toContainText("moved to Trash");
  await expect(dialog).toContainText("restored from Trash");
  // Cancel — we're only checking copy here.
  await window.locator(".confirm-dialog-btn--cancel, button", {
    hasText: "Cancel",
  }).first().click();
});

test("delete-permanently bypasses trash entirely", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  const ok = await invokeDeletePermanently(window, filePath, false);
  expect(ok).toBe(true);

  // File gone, trash empty
  expect(await pathExists(filePath)).toBe(false);
  const trashRoot = path.join(userDataDir, "trash");
  let trashEntries: string[] = [];
  try {
    trashEntries = await readdir(trashRoot);
  } catch {
    // trash dir may not exist
  }
  expect(trashEntries.length).toBe(0);
  expect((await invokeTrashList(window)).length).toBe(0);
});
