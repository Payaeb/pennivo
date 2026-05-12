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

// ---------- Test scaffolding ----------

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "pennivo-snap-ws-"));
  await writeFile(
    path.join(dir, "alpha.md"),
    "# Alpha\n\nfirst version.",
    "utf-8",
  );
  return dir;
}

async function makeUserData(workspaceDir: string): Promise<string> {
  const userData = await mkdtemp(path.join(tmpdir(), "pennivo-snap-ud-"));
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

function snapshotsDirFor(userDataDir: string, absolutePath: string): string {
  // Match @pennivo/core's `normalizeAbsolutePath` for stable dir hashing.
  let p = absolutePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) {
    p = p[0]!.toLowerCase() + p.slice(1);
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return path.join(userDataDir, "snapshots", sha1(p));
}

async function listSnapshotMdFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((e) => e.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Wait for a condition (poll). Snapshot writes are fire-and-log so the
// renderer's save IPC returns before the snapshot lands on disk.
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

// IPC bridge — invoke main-process IPC from the renderer page context.
async function invokeFileSave(
  window: Page,
  filePath: string,
  content: string,
): Promise<unknown> {
  return window.evaluate(
    ([fp, ct]) => {
      // @ts-expect-error renderer global injected by preload
      return window.pennivo.saveFile(fp, ct);
    },
    [filePath, content],
  );
}

async function invokeFileOpenPath(
  window: Page,
  filePath: string,
): Promise<unknown> {
  return window.evaluate((fp) => {
    // @ts-expect-error renderer global injected by preload
    return window.pennivo.openFilePath(fp);
  }, filePath);
}

async function invokeSettingsGet(window: Page): Promise<unknown> {
  return window.evaluate(() => {
    // @ts-expect-error renderer global injected by preload
    return window.pennivo.getSettings();
  });
}

async function invokeSettingsSet(
  window: Page,
  settings: unknown,
): Promise<unknown> {
  return window.evaluate((s) => {
    // @ts-expect-error renderer global injected by preload
    return window.pennivo.setSettings(s);
  }, settings);
}

async function invokeSnapshotRestore(
  window: Page,
  absolutePath: string,
  snapshotId: string,
  mode: "overwrite" | "as-new-file",
): Promise<unknown> {
  return window.evaluate(
    ([fp, id, m]) => {
      // @ts-expect-error renderer global injected by preload
      return window.pennivo.snapshot.restore(fp, id, m);
    },
    [absolutePath, snapshotId, mode],
  );
}

// Subscribe to a renderer-side IPC event by stuffing observed payloads onto
// `window.__obs.<channel>` so the test can assert against them.
async function startObservers(window: Page): Promise<void> {
  await window.evaluate(() => {
    // @ts-expect-error test-only globals
    window.__obs = window.__obs ?? {
      external: [],
      cap: [],
      archive: [],
    };
    const sn =
      // @ts-expect-error renderer global
      window.pennivo?.snapshot;
    if (!sn) return;
    sn.onExternalChangeDetected((payload: unknown) => {
      // @ts-expect-error
      window.__obs.external.push(payload);
    });
    sn.onCapExceeded((warning: unknown) => {
      // @ts-expect-error
      window.__obs.cap.push(warning);
    });
    sn.onArchiveStatus((status: unknown) => {
      // @ts-expect-error
      window.__obs.archive.push(status);
    });
  });
}

async function getObservers(window: Page): Promise<{
  external: Array<{ absolutePath: string; snapshotId: string }>;
  cap: Array<unknown>;
  archive: Array<unknown>;
}> {
  return window.evaluate(() => {
    // @ts-expect-error
    return JSON.parse(JSON.stringify(window.__obs));
  });
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

test("save → edit → save creates two snapshots; same-content save dedupes", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");
  const snapDir = snapshotsDirFor(userDataDir, filePath);

  // First save (different content from on-disk seed) — captures snapshot.
  await invokeFileSave(window, filePath, "# Alpha\n\nfirst save.");
  const firstSet = await waitFor(async () => {
    const files = await listSnapshotMdFiles(snapDir);
    return files.length >= 1 ? files : null;
  });
  expect(firstSet.length).toBe(1);

  // Second save with new content — second snapshot.
  await invokeFileSave(window, filePath, "# Alpha\n\nedited again.");
  const secondSet = await waitFor(async () => {
    const files = await listSnapshotMdFiles(snapDir);
    return files.length >= 2 ? files : null;
  });
  expect(secondSet.length).toBe(2);

  // Re-save same content — dedupe. We poll-and-wait briefly to confirm no
  // new snapshot lands.
  await invokeFileSave(window, filePath, "# Alpha\n\nedited again.");
  await new Promise((r) => setTimeout(r, 1500));
  const thirdSet = await listSnapshotMdFiles(snapDir);
  expect(thirdSet.length).toBe(2);
});

test("archive routing — when configured, snapshots land in both stores", async () => {
  const { window } = await setup();
  const archiveDir = await mkdtemp(path.join(tmpdir(), "pennivo-snap-arc-"));

  try {
    const settings = (await invokeSettingsGet(window)) as Record<
      string,
      unknown
    >;
    const recovery = settings.recovery as {
      tierDestinations: Array<{ tierIndex: number; destinations: string[] }>;
    };
    // Force tier 0 to write to BOTH local and archive.
    recovery.tierDestinations = recovery.tierDestinations.map((td) =>
      td.tierIndex === 0
        ? { tierIndex: 0, destinations: ["local", "archive"] }
        : td,
    );
    (recovery as Record<string, unknown>).archiveFolder = archiveDir;
    await invokeSettingsSet(window, { ...settings, recovery });

    const filePath = path.join(workspaceDir, "alpha.md");
    await invokeFileSave(window, filePath, "# Alpha\n\nfor archive.");

    const localDir = snapshotsDirFor(userDataDir, filePath);
    const archiveSnapDir = path.join(
      archiveDir,
      path.basename(localDir),
    );
    const localFiles = await waitFor(async () => {
      const f = await listSnapshotMdFiles(localDir);
      return f.length >= 1 ? f : null;
    });
    const archiveFiles = await waitFor(async () => {
      const f = await listSnapshotMdFiles(archiveSnapDir);
      return f.length >= 1 ? f : null;
    });
    expect(localFiles.length).toBeGreaterThanOrEqual(1);
    expect(archiveFiles.length).toBeGreaterThanOrEqual(1);
  } finally {
    await rm(archiveDir, { recursive: true, force: true });
  }
});

test("archive unreachable enqueues; reachable drains", async () => {
  const { window } = await setup();
  const missingArchive = path.join(
    tmpdir(),
    `pennivo-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  // Use a path on a non-existent drive letter on Windows to provoke a
  // failed mkdir+write. On other OSes a path with a non-existent prefix
  // path component blocks access. We chose a tmp-dir-style path that we
  // never create — Node's fs.mkdir(recursive: true) will succeed unless we
  // make the parent non-writable. Simpler: point it at an existing FILE so
  // mkdir-on-the-path fails.
  const blockedFile = await mkdtemp(path.join(tmpdir(), "pennivo-block-"));
  const blockedFilePath = path.join(blockedFile, "blocker.txt");
  await writeFile(blockedFilePath, "block", "utf-8");
  const archiveAtFile = path.join(blockedFilePath, "archive");
  // archiveAtFile is now a path THROUGH a regular file — mkdir fails.

  try {
    const settings = (await invokeSettingsGet(window)) as Record<
      string,
      unknown
    >;
    const recovery = settings.recovery as {
      tierDestinations: Array<{ tierIndex: number; destinations: string[] }>;
    };
    recovery.tierDestinations = recovery.tierDestinations.map((td) =>
      td.tierIndex === 0
        ? { tierIndex: 0, destinations: ["local", "archive"] }
        : td,
    );
    (recovery as Record<string, unknown>).archiveFolder = archiveAtFile;
    await invokeSettingsSet(window, { ...settings, recovery });

    const filePath = path.join(workspaceDir, "alpha.md");
    await invokeFileSave(window, filePath, "# Alpha\n\nqueue test.");

    const queuePath = path.join(userDataDir, "snapshot-archive-queue.json");
    await waitFor(async () => {
      try {
        const data = await readFile(queuePath, "utf-8");
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
      } catch {
        return null;
      }
    });

    // Now point archive at a real, writable folder and save again — the
    // queue should drain.
    const realArchive = await mkdtemp(path.join(tmpdir(), "pennivo-real-arc-"));
    try {
      const settings2 = (await invokeSettingsGet(window)) as Record<
        string,
        unknown
      >;
      const recovery2 = settings2.recovery as Record<string, unknown>;
      recovery2.archiveFolder = realArchive;
      await invokeSettingsSet(window, { ...settings2, recovery: recovery2 });

      // Save once more with new content to trigger a write + drain.
      await invokeFileSave(window, filePath, "# Alpha\n\ndrain trigger.");

      await waitFor(async () => {
        try {
          const data = await readFile(queuePath, "utf-8");
          const parsed = JSON.parse(data);
          return Array.isArray(parsed) && parsed.length === 0 ? true : null;
        } catch {
          // Queue file may have been written/cleared
          return null;
        }
      });
    } finally {
      await rm(realArchive, { recursive: true, force: true });
    }
  } finally {
    await rm(blockedFile, { recursive: true, force: true });
  }
});

test("external-change detection on file open emits event + tags snapshot", async () => {
  // Phase 1: launch, save (creates snapshot), close.
  const phase1 = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");

  await invokeFileSave(phase1.window, filePath, "# Alpha\n\nv1 in pennivo.");
  const snapDir = snapshotsDirFor(userDataDir, filePath);
  await waitFor(async () => {
    const f = await listSnapshotMdFiles(snapDir);
    return f.length >= 1 ? f : null;
  });

  await app!.close();
  app = null;

  // Phase 2: modify file ON DISK while pennivo is closed.
  await writeFile(filePath, "# Alpha\n\nedited from outside.", "utf-8");

  // Phase 3: re-launch with the SAME userDataDir so snapshot history is
  // preserved. Don't go through `setup()` (which mints a fresh userData).
  const launched = await launchApp(userDataDir);
  app = launched.app;
  const window = launched.window;
  await startObservers(window);

  await invokeFileOpenPath(window, filePath);

  // Wait for an `external`-tagged snapshot to land + the event to fire.
  await waitFor(async () => {
    const files = await listSnapshotMdFiles(snapDir);
    if (files.length < 2) return null;
    // Read the most recent meta and confirm it's `author: external`.
    const newest = files[files.length - 1]!;
    const metaPath = path.join(
      snapDir,
      newest.replace(/\.md$/i, ".json"),
    );
    try {
      const meta = JSON.parse(await readFile(metaPath, "utf-8"));
      return meta.author === "external" ? meta : null;
    } catch {
      return null;
    }
  });

  await waitFor(async () => {
    const obs = await getObservers(window);
    return obs.external.length > 0 ? obs.external : null;
  });
});

test("restore overwrite mode takes pre-restore snapshot then writes target", async () => {
  const { window } = await setup();
  const filePath = path.join(workspaceDir, "alpha.md");
  const snapDir = snapshotsDirFor(userDataDir, filePath);

  // Save v1 → captures snapshot v1.
  await invokeFileSave(window, filePath, "# Alpha\n\nv1.");
  await waitFor(async () => {
    const f = await listSnapshotMdFiles(snapDir);
    return f.length >= 1 ? f : null;
  });
  // Save v2 → captures snapshot v2.
  await invokeFileSave(window, filePath, "# Alpha\n\nv2.");
  const twoFiles = await waitFor(async () => {
    const f = await listSnapshotMdFiles(snapDir);
    return f.length >= 2 ? f : null;
  });
  // Snapshots are timestamp-named, lexicographically sorted = chronological.
  // We want to restore the OLDER one (v1) onto the live file.
  const olderId = twoFiles[0]!.replace(/\.md$/i, "");

  // Trigger restore.
  const result = (await invokeSnapshotRestore(
    window,
    filePath,
    olderId,
    "overwrite",
  )) as { newPath: string };
  expect(result?.newPath).toBeTruthy();

  // On-disk content matches the v1 snapshot.
  const onDisk = await readFile(filePath, "utf-8");
  expect(onDisk).toBe("# Alpha\n\nv1.");

  // Pre-restore snapshot logic: if the current on-disk content (v2) already
  // matches the most recent snapshot's hash, the writer dedupes and reuses
  // that snapshot — the existing v2 entry IS the pre-restore record. The
  // user can still revert by restoring v2. Either way, the v2 snapshot must
  // remain available in the timeline so the restore is reversible.
  const filesAfter = await listSnapshotMdFiles(snapDir);
  expect(filesAfter.length).toBeGreaterThanOrEqual(2);
  // Confirm v2's content is still recoverable (look for a snapshot whose
  // file content matches v2).
  let foundV2 = false;
  for (const file of filesAfter) {
    const content = await readFile(path.join(snapDir, file), "utf-8");
    if (content === "# Alpha\n\nv2.") {
      foundV2 = true;
      break;
    }
  }
  expect(foundV2).toBe(true);
});

test("cap-exceeded warning fires when forever-tier snapshots overrun the cap", async () => {
  const { window } = await setup();
  await startObservers(window);

  // Configure: tier 0 = `forever` (so it cannot be evicted), max storage =
  // 256 bytes (tiny). Then save several distinct large contents — each
  // snapshot is ~1 KB — to push past the cap on protected storage alone.
  const settings = (await invokeSettingsGet(window)) as Record<
    string,
    unknown
  >;
  const recovery = settings.recovery as {
    retentionPolicy: {
      tiers: Array<{ maxAgeMs: number; granularity: string }>;
    };
    tierDestinations: Array<{ tierIndex: number; destinations: string[] }>;
    maxStorageBytes: number | null;
  };
  recovery.retentionPolicy = {
    tiers: [{ maxAgeMs: 3_600_000, granularity: "forever" }],
  };
  recovery.tierDestinations = [{ tierIndex: 0, destinations: ["local"] }];
  recovery.maxStorageBytes = 256;
  await invokeSettingsSet(window, { ...settings, recovery });

  const filePath = path.join(workspaceDir, "alpha.md");
  // Build distinct 1 KB+ contents so each save creates a new snapshot.
  for (let i = 0; i < 4; i++) {
    const filler = "x".repeat(1100) + ` v${i}`;
    await invokeFileSave(window, filePath, filler);
    // Brief gap so successive saves aren't deduped before the writer
    // observes them.
    await new Promise((r) => setTimeout(r, 200));
  }

  await waitFor(async () => {
    const obs = await getObservers(window);
    return obs.cap.length > 0 ? obs.cap : null;
  });
  const obs = await getObservers(window);
  const warning = obs.cap[0] as {
    kind: string;
    capBytes: number;
    overageBytes: number;
  };
  expect(warning.kind).toBe("cap-exceeded");
  expect(warning.capBytes).toBe(256);
  expect(warning.overageBytes).toBeGreaterThan(0);
});
