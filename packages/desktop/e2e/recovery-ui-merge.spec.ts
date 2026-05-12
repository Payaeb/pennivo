// E2E coverage for the Phase 13a UI third slice: Compare & merge save flow,
// external-change toast, and archive-status titlebar chip.
//
// Visual UAT was attempted via Chrome MCP but Chrome MCP isn't available in
// this environment (verified across multiple slices). These tests substitute
// for visual UAT against the real Electron host.

import { test, expect, _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  mkdtemp,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO_PACKAGE_DIR = path.resolve(__dirname, "..");

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-recmerge-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nbaseline body.\n",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-recmerge-ud-"));
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

test("Compare & merge: Save as new produces a merged file with picked hunks", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await openFilePath(window, filePath);
  // Three diverging versions so we get three changed hunks separated by
  // context. Each line that differs across pairs becomes a hunk in the
  // older-vs-newer compare.
  await saveFile(window, filePath, "alpha\nbeta\ngamma\ndelta\nepsilon\n");
  await saveFile(window, filePath, "alpha\nBETA\ngamma\nDELTA\nepsilon\n");
  await saveFile(window, filePath, "alpha\nBETA-2\ngamma\nDELTA-2\nepsilon\n");

  // Wait for at least 3 snapshots.
  const snapshots = (await waitForCondition(async () => {
    const list = await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath);
    return Array.isArray(list) && list.length >= 3 ? list : null;
  })) as Array<{ id: string; ts: number }>;

  // Snapshots are returned newest-first. Pick the oldest two for compare.
  const sortedNewestFirst = [...snapshots].sort((a, b) => b.ts - a.ts);
  const olderId = sortedNewestFirst[sortedNewestFirst.length - 1].id;
  const newerId = sortedNewestFirst[sortedNewestFirst.length - 2].id;

  // Drive Save as new file directly via the IPC bridge (the renderer flow is
  // covered by component tests; this asserts the disk-side outcome).
  const merged = "alpha\nbeta\ngamma\nDELTA\nepsilon"; // pick: take left for hunk 0, right for hunk 1
  const result = await window.evaluate(
    (args) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.saveMerged(args);
    },
    {
      filePath,
      content: merged,
      mode: "as-new-file" as const,
      left: olderId,
      right: newerId,
    },
  );

  expect(result).not.toBeNull();
  const savedPath = (result as { savedPath: string }).savedPath;
  expect(savedPath).toMatch(/\(merged \d{4}-\d{2}-\d{2}\)\.md$/);

  // Verify the merged file content on disk.
  const onDisk = await readFile(savedPath.replace(/\//g, path.sep), "utf-8");
  expect(onDisk).toBe(merged);
});

test("Compare & merge: Replace overwrite takes a pre-restore snapshot", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await openFilePath(window, filePath);
  await saveFile(window, filePath, "v1\n");
  await saveFile(window, filePath, "v2\n");

  // Wait for >= 2 snapshots so we have both a "left" and "right" pickable id.
  const snapshots = (await waitForCondition(async () => {
    const list = await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath);
    return Array.isArray(list) && list.length >= 2 ? list : null;
  })) as Array<{ id: string; ts: number }>;

  const sortedNewestFirst = [...snapshots].sort((a, b) => b.ts - a.ts);
  const newest = sortedNewestFirst[0];
  const oldest = sortedNewestFirst[sortedNewestFirst.length - 1];
  const beforeMergeCount = snapshots.length;

  await window.evaluate(
    (args) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.saveMerged(args);
    },
    {
      filePath,
      content: "merged-out",
      mode: "overwrite" as const,
      left: oldest.id,
      right: newest.id,
    },
  );

  // Disk now has the merged content.
  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toBe("merged-out");

  // Snapshot count grew (pre-restore + post-merge snapshots).
  await waitForCondition(async () => {
    const list = (await window.evaluate((fp) => {
      // @ts-expect-error renderer global
      return window.pennivo.snapshot.list(fp);
    }, filePath)) as unknown[];
    return list.length > beforeMergeCount ? list : null;
  });
});

test("External-change toast appears when on-disk content changes outside Pennivo", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  // First open seeds a baseline snapshot.
  await openFilePath(window, filePath);
  await window.waitForTimeout(500);

  // Mutate the file outside Pennivo.
  await writeFile(filePath, "# Alpha\n\nedited externally.\n", "utf-8");

  // Re-open the file — main process should hash, see a mismatch, take an
  // external snapshot, and emit `recovery:external-change-detected`.
  await openFilePath(window, filePath);

  // The toast should render bottom-right.
  await expect(window.locator(".external-change-toast")).toBeVisible({
    timeout: 10_000,
  });
  await expect(window.locator(".external-change-toast-message")).toContainText(
    "changed outside Pennivo",
  );
});

test("Archive-status chip surfaces when the archive folder is unreachable", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  // Point archive at a path nested inside an existing FILE — fs.mkdir(...,
  // {recursive:true}) reliably fails because you can't mkdir into a file.
  // This forces the archive write into the failure branch on every platform.
  const archiveBase = path.join(workspaceDir, "alpha.md");
  const bogusArchive = path.join(archiveBase, "snapshot-archive");

  await window.evaluate(async (archive) => {
    // @ts-expect-error renderer global
    const saved = (await window.pennivo.getSettings()) as Record<string, unknown>;
    const prev = (saved?.recovery ?? {}) as Record<string, unknown>;
    const policy = (prev.retentionPolicy ?? null) as { tiers?: unknown[] } | null;
    const tierCount = policy && Array.isArray(policy.tiers) ? policy.tiers.length : 4;
    // Build a destinations matrix where every tier writes to local + archive.
    const tierDestinations = Array.from({ length: tierCount }, (_, i) => ({
      tierIndex: i,
      destinations: ["local", "archive"],
    }));
    // @ts-expect-error renderer global
    await window.pennivo.setSettings({
      ...saved,
      recovery: {
        ...prev,
        archiveFolder: archive,
        tierDestinations,
      },
    });
  }, bogusArchive);

  // Trigger a save so the snapshot writer attempts the archive write,
  // fails, and enqueues — emitting `recovery:archive-status` with status
  // `queued` and count > 0.
  await openFilePath(window, filePath);
  await saveFile(window, filePath, "# Alpha\n\nfresh body.\n");

  // The titlebar chip should appear within a couple of seconds. Assert on
  // visibility AND on the user-facing affordances (label + amber dot)
  // since the original UAT bug was that the chip was wired but not
  // actually surfacing — a "renders without throwing" check would have
  // missed that.
  const chip = window.locator(".archive-status-chip");
  await expect(chip).toBeVisible({ timeout: 10_000 });
  // Label text is the user-visible string from the design doc.
  await expect(chip).toContainText("Archive offline");
  // The chip MUST live inside the titlebar's left section — if it ever
  // got mounted somewhere ancestrally hidden (overflow:hidden parent,
  // wrong wrapper, etc.) this assertion would catch it.
  await expect(window.locator(".titlebar-left .archive-status-chip")).toHaveCount(
    1,
  );
  // The amber dot child must be present (visual signal, not just label).
  await expect(chip.locator(".archive-status-chip-dot")).toBeVisible();
  // Click should be possible — i.e. the OS titlebar drag region isn't
  // swallowing the pointer. We don't assert on Settings opening here
  // (covered separately) but at minimum the click must not throw.
  await chip.click({ trial: true });

  // Snapshot the queue file exists too — sanity check the engine recorded
  // the failure.
  const queuePath = path.join(userDataDir, "snapshot-archive-queue.json");
  const queue = await readFile(queuePath, "utf-8").catch(() => "");
  expect(queue.length).toBeGreaterThan(0);

  void readdir; // hush unused-import linter
});
