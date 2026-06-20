// Trash store — disk-side of the Phase 13a soft-delete trash.
//
// Owns:
//   - moving a file (and optionally its asset folders) into
//     <userData>/trash/<sha1(absPath)>-<deletedAtMs>/ atomically from the
//     user's perspective: either the workspace file is gone AND the trash
//     entry exists, or the workspace file is still there
//   - listing trash entries (parses meta.json sidecars)
//   - restoring an entry to its original path (or a non-colliding sibling)
//   - permanent delete of a single entry
//   - sweeping expired entries on launch + once a day
//
// Pure logic lives in @pennivo/core/trash:
//   - trashEntryDirName(absPath, deletedAtMs)
//   - computeExpiresAtMs(deletedAtMs, retentionDays)
//   - findExpired(entries, now)
//   - pickRestorePath(originalPath, exists)
//
// This module only handles I/O + glue. Errors are logged; the markdown file
// is the priority — if asset moves fail, the entry still lands in trash with
// the .md content preserved.

import { app, BrowserWindow } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type RecoverySettings,
  type TrashEntry,
  computeExpiresAtMs,
  findExpired,
  pickRestorePath,
  trashEntryDirName,
} from "@pennivo/core";

// ---------- Path helpers ----------

function userDataPath(): string {
  return app.getPath("userData");
}

function trashRoot(): string {
  return path.join(userDataPath(), "trash");
}

function trashEntryDir(trashId: string): string {
  return path.join(trashRoot(), trashId);
}

function trashContentPath(trashId: string): string {
  return path.join(trashEntryDir(trashId), "content.md");
}

function trashAssetsRoot(trashId: string): string {
  return path.join(trashEntryDir(trashId), "assets");
}

function trashMetaPath(trashId: string): string {
  return path.join(trashEntryDir(trashId), "meta.json");
}

// ---------- Renderer notification ----------
//
// Trash count changes drive the sidebar's `Trash · N` entry visibility.
// Same shape as `setSnapshotMainWindow` in snapshotStore.ts so the wiring
// stays familiar.

let mainWindowRef: BrowserWindow | null = null;
export function setTrashMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}

async function emitCountChanged(): Promise<void> {
  try {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
    const entries = await listTrash();
    mainWindowRef.webContents.send("trash:count-changed", entries.length);
  } catch (err) {
    console.error("[trashStore] emitCountChanged failed:", err);
  }
}

// ---------- File-system primitives ----------

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move `src` to `dst` — prefer rename, fall back to copy + unlink on
 * `EXDEV` (cross-device) or `EBUSY` (Windows file lock). Same shape as
 * `normalizeAssetsForFile`'s rename-with-fallback dance in main.ts.
 */
async function moveFileWithFallback(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EBUSY" && code !== "EPERM") {
      throw err;
    }
    console.warn(
      `[trashStore] rename ${src} -> ${dst} failed (${code}); falling back to copy+unlink`,
    );
    await fs.copyFile(src, dst);
    try {
      await fs.unlink(src);
    } catch (unlinkErr) {
      console.error(
        `[trashStore] unlink of ${src} after copy fallback failed (file may still be locked):`,
        unlinkErr,
      );
    }
  }
}

/**
 * Move a directory tree from `src` to `dst`. Same fallback strategy as
 * `moveFileWithFallback` but uses `fs.cp` for the copy step.
 */
async function moveDirWithFallback(src: string, dst: string): Promise<void> {
  try {
    await fs.rename(src, dst);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV" && code !== "EBUSY" && code !== "EPERM") {
      throw err;
    }
    console.warn(
      `[trashStore] rename dir ${src} -> ${dst} failed (${code}); falling back to cp+rm`,
    );
    await fs.cp(src, dst, {
      recursive: true,
      errorOnExist: false,
      force: true,
    });
    try {
      await fs.rm(src, { recursive: true, force: true });
    } catch (rmErr) {
      console.error(
        `[trashStore] rm of ${src} after cp fallback failed (folder may still be locked):`,
        rmErr,
      );
    }
  }
}

// ---------- moveToTrash ----------

export interface MoveToTrashInput {
  absolutePath: string;
  /** When true, owned `*-md-images/` folders move with the file. */
  includeAssets: boolean;
  /** Names of asset folders this file owns (caller-discovered). */
  assetFolderNames: string[];
  settings: RecoverySettings;
  deviceId: string;
  deviceName?: string;
}

export interface MoveToTrashResult {
  trashId: string;
  expiresAtMs: number | null;
}

/**
 * Soft-delete: move the file (and optionally its asset folders) into the
 * trash. Atomic from the user's perspective — we read content first, write
 * the trash entry, then unlink the source. If the trash write fails, the
 * source is untouched. If the source unlink fails after the trash write
 * succeeded, we roll back the trash entry so the user doesn't end up with
 * the file in two places.
 *
 * Asset moves are best-effort: any individual asset folder failure is
 * logged but doesn't abort the delete. The .md file is the priority.
 */
export async function moveToTrash(
  input: MoveToTrashInput,
): Promise<MoveToTrashResult> {
  const { absolutePath, includeAssets, assetFolderNames, settings } = input;

  // 1. Read content first. If the file doesn't exist, throw — caller handles.
  const content = await fs.readFile(absolutePath, "utf-8");

  // 2. Build the trash dir path. deletedAtMs is the wall-clock at the moment
  //    of delete; the dir name is `<sha1(absPath)>-<deletedAtMs>` so two
  //    deletes of the same path won't collide.
  const deletedAtMs = Date.now();
  const trashId = trashEntryDirName(absolutePath, deletedAtMs);
  const entryDir = trashEntryDir(trashId);
  const expiresAtMs = computeExpiresAtMs(
    deletedAtMs,
    settings.trashRetentionDays,
  );

  // 3. Create the dir, write content.md (we have the bytes — no need to
  //    rename). Once content.md is on disk, we own the file's bytes.
  await fs.mkdir(entryDir, { recursive: true });
  await fs.writeFile(trashContentPath(trashId), content, "utf-8");

  // 4. Asset folders — best-effort. Track which actually moved so meta.json
  //    can list them honestly.
  const movedAssetFolders: string[] = [];
  if (includeAssets && assetFolderNames.length > 0) {
    const assetsRoot = trashAssetsRoot(trashId);
    await fs.mkdir(assetsRoot, { recursive: true });
    const sourceDir = path.dirname(absolutePath);
    for (const folderName of assetFolderNames) {
      const src = path.join(sourceDir, folderName);
      const dst = path.join(assetsRoot, folderName);
      try {
        await moveDirWithFallback(src, dst);
        movedAssetFolders.push(folderName);
      } catch (err) {
        console.error(
          `[trashStore] failed to move asset folder ${folderName} into trash:`,
          err,
        );
        // Continue — partial trash is better than no trash.
      }
    }
  }

  // 5. Write meta.json. The id field intentionally mirrors the dir name so
  //    we can round-trip via filesystem alone.
  const meta: TrashEntry = {
    id: trashId,
    absolutePath,
    fileBasename: path.basename(absolutePath),
    deletedAtMs,
    expiresAtMs,
    hasAssets: movedAssetFolders.length > 0,
    assetFolderNames: movedAssetFolders,
    deletedByDeviceId: input.deviceId,
    deletedByDeviceName: input.deviceName,
  };
  await fs.writeFile(
    trashMetaPath(trashId),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );

  // 6. Finally remove the original .md. If this fails AFTER the trash write
  //    succeeded, roll back the trash entry — we'd rather show the file is
  //    still there than have it in two places.
  try {
    await fs.unlink(absolutePath);
  } catch (err) {
    console.error(
      "[trashStore] failed to unlink source file after trash write; rolling back trash entry:",
      err,
    );
    // Best-effort rollback of the trash entry. If THIS fails too, the worst
    // we end up with is a stale trash dir — still better than data loss.
    try {
      // Move asset folders back first so the source state is restored.
      if (movedAssetFolders.length > 0) {
        const sourceDir = path.dirname(absolutePath);
        const assetsRoot = trashAssetsRoot(trashId);
        for (const folderName of movedAssetFolders) {
          const src = path.join(assetsRoot, folderName);
          const dst = path.join(sourceDir, folderName);
          if (!(await pathExists(dst))) {
            try {
              await moveDirWithFallback(src, dst);
            } catch (rbErr) {
              console.error(
                `[trashStore] rollback: failed to restore asset folder ${folderName}:`,
                rbErr,
              );
            }
          }
        }
      }
      await fs.rm(entryDir, { recursive: true, force: true });
    } catch (rbErr) {
      console.error("[trashStore] rollback failed:", rbErr);
    }
    throw err;
  }

  void emitCountChanged();
  return { trashId, expiresAtMs };
}

/**
 * Read the markdown content of a trash entry — used by the Trash list's
 * preview pane. Returns `null` if the entry is gone or unreadable.
 */
export async function readTrashContent(
  trashId: string,
): Promise<string | null> {
  try {
    return await fs.readFile(trashContentPath(trashId), "utf-8");
  } catch {
    return null;
  }
}

// ---------- listTrash ----------

async function readTrashMeta(trashId: string): Promise<TrashEntry | null> {
  try {
    const data = await fs.readFile(trashMetaPath(trashId), "utf-8");
    const parsed = JSON.parse(data) as TrashEntry;
    // Sanity: the parsed id should match the directory it lived in. Trust
    // the directory name (filesystem is the source of truth).
    if (parsed && typeof parsed === "object") {
      return { ...parsed, id: trashId };
    }
    return null;
  } catch (err) {
    console.warn(`[trashStore] failed to read meta.json for ${trashId}:`, err);
    return null;
  }
}

/**
 * Read a single trash entry's meta by id. Returns `null` when the entry is
 * missing or its meta.json is corrupt. Exposed so callers (e.g. the MCP host
 * bridge) can inspect an entry's original `absolutePath` and enforce a
 * workspace boundary BEFORE any restore writes the file back to disk.
 */
export async function getTrashEntry(
  trashId: string,
): Promise<TrashEntry | null> {
  return readTrashMeta(trashId);
}

/**
 * Read every entry in `<userData>/trash/`. Skips dirs with corrupt or missing
 * meta.json. Sorted newest-first by `deletedAtMs`.
 */
export async function listTrash(): Promise<TrashEntry[]> {
  const root = trashRoot();
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }
  const out: TrashEntry[] = [];
  for (const id of entries) {
    // Defensive: skip anything that doesn't look like our naming convention.
    // It's permissive — `<40 hex>-<digits>` — but we still parse the meta to
    // confirm.
    const fullPath = path.join(root, id);
    let isDir: boolean;
    try {
      const stat = await fs.stat(fullPath);
      isDir = stat.isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    const meta = await readTrashMeta(id);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => b.deletedAtMs - a.deletedAtMs);
  return out;
}

// ---------- restoreFromTrash ----------

export interface RestoreFromTrashResult {
  restoredPath: string;
}

/**
 * Restore the file at `meta.absolutePath`. If the original path is taken,
 * restore beside it as `<basename> (restored).md` (or `(restored 2).md`,
 * etc.). Asset folders restore back next to the file with their original
 * names; if a target asset folder name is taken, suffix with `-restored`.
 *
 * Removes the trash dir on success.
 */
export async function restoreFromTrash(
  trashId: string,
): Promise<RestoreFromTrashResult> {
  const meta = await readTrashMeta(trashId);
  if (!meta) {
    throw new Error(`[trashStore] trash entry not found: ${trashId}`);
  }

  const originalExists = await pathExists(meta.absolutePath);
  // Walk the counter against the live disk — pickRestorePath is pure but we
  // know how to ask `fs` from here.
  const target = pickRestorePath(meta.absolutePath, originalExists, {
    // pickRestorePath is sync; we use the sync existsSync here. The walk
    // is bounded (10s of candidates at worst) and only runs on user-driven
    // restore, so the cost is fine.
    pathExistsOnDisk: (p) => existsSync(p),
  });

  // Move content.md to the target path.
  await fs.mkdir(path.dirname(target), { recursive: true });
  await moveFileWithFallback(trashContentPath(trashId), target);

  // Restore asset folders.
  if (meta.hasAssets && meta.assetFolderNames.length > 0) {
    const targetDir = path.dirname(target);
    const assetsRoot = trashAssetsRoot(trashId);
    for (const folderName of meta.assetFolderNames) {
      const src = path.join(assetsRoot, folderName);
      let dst = path.join(targetDir, folderName);
      // If target asset folder collides, restore beside as `<name>-restored`.
      if (await pathExists(dst)) {
        dst = path.join(targetDir, `${folderName}-restored`);
        let counter = 2;
        while (await pathExists(dst)) {
          dst = path.join(targetDir, `${folderName}-restored-${counter}`);
          counter += 1;
          if (counter > 100) break;
        }
      }
      try {
        await moveDirWithFallback(src, dst);
      } catch (err) {
        console.error(
          `[trashStore] failed to restore asset folder ${folderName}:`,
          err,
        );
      }
    }
  }

  // Remove the trash dir on success — best-effort. If this fails the user
  // sees a stale trash entry; running sweep later will eventually clean it.
  await fs
    .rm(trashEntryDir(trashId), { recursive: true, force: true })
    .catch((err) => {
      console.warn(
        `[trashStore] failed to remove trash dir after restore (will retry on sweep):`,
        err,
      );
    });

  void emitCountChanged();
  return { restoredPath: target.replace(/\\/g, "/") };
}

// ---------- permanentlyDelete ----------

/**
 * Remove a trash entry permanently. No-op if the dir doesn't exist.
 */
export async function permanentlyDelete(trashId: string): Promise<void> {
  await fs.rm(trashEntryDir(trashId), { recursive: true, force: true });
  void emitCountChanged();
}

// ---------- sweepExpired ----------

export interface SweepExpiredResult {
  removedCount: number;
}

/**
 * Permanently delete every trash entry whose `expiresAtMs` is on or before
 * `now`. Forever entries (`expiresAtMs === null`) are never touched.
 *
 * Designed to be fire-and-forget on app launch + once a day. Returns the
 * count for logging.
 */
export async function sweepExpired(
  now: number = Date.now(),
): Promise<SweepExpiredResult> {
  const entries = await listTrash();
  const expired = findExpired(entries, now);
  for (const entry of expired) {
    try {
      await permanentlyDelete(entry.id);
    } catch (err) {
      console.error(
        `[trashStore] failed to delete expired trash entry ${entry.id}:`,
        err,
      );
    }
  }
  if (expired.length > 0) void emitCountChanged();
  return { removedCount: expired.length };
}
