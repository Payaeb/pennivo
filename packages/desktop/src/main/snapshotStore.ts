// Snapshot store — the disk-side of Phase 13a.
//
// This module owns:
//   - writing snapshots to <userData>/snapshots/<sha1>/ and (optionally) to
//     the user's archive folder under the same content-addressed layout
//   - per-snapshot meta sidecars (.json next to each .md)
//   - external-change detection on file open (delegated classifier from core)
//   - a persisted retry queue for archive writes that fail because the
//     destination was unreachable
//   - listing / reading / restoring snapshots
//
// Pure logic lives in @pennivo/core/snapshots: path/sha1, dedupe, prune,
// routing, archive-queue dedupe, recovery settings shape, external-change
// classifier. This file only handles I/O + glue.
//
// Design contract: snapshot writes are FIRE-AND-LOG. They run after the
// user-visible save IPC has already resolved. They never throw to the save
// path. Failures log to console and (where appropriate) surface a renderer
// event.

import { app, type BrowserWindow } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  type ArchiveQueueEntry,
  type PruneWarning,
  type RecoverySettings,
  type Snapshot,
  type SnapshotAuthor,
  type StorageDestination,
  dedupeArchiveQueue,
  detectExternalChange,
  matchMcpWrite,
  normalizeAbsolutePath,
  parseAuditLines,
  prune,
  routeSnapshot,
  shouldDedupe,
  snapshotFileBasename,
  snapshotPathSegments,
} from "@pennivo/core";

// ---------- Types ----------

/**
 * On-disk meta sidecar. Mirrors `Snapshot` plus a couple of bookkeeping
 * fields specific to the desktop store (the `restoredFrom` linkage when a
 * pre-restore snapshot is taken; the path of the source file for cross-
 * referencing).
 */
export interface SnapshotMetaFile extends Snapshot {
  /** Absolute path of the source markdown file at capture time. */
  absolutePath: string;
  /** Set on the pre-restore snapshot taken before an `overwrite` restore. */
  restoredFrom?: string;
}

export interface SnapshotWithSource extends Snapshot {
  /** Where this snapshot's content lives on disk. */
  source: StorageDestination;
  /** Absolute path of the source markdown file at capture time. */
  absolutePath: string;
  restoredFrom?: string;
}

export interface WriteSnapshotInput {
  absolutePath: string;
  content: string;
  author: SnapshotAuthor;
  agentName?: string;
  settings: RecoverySettings;
  deviceId: string;
  deviceName?: string;
  parentSnapshotId?: string;
  restoredFrom?: string;
}

export interface RestoreInput {
  snapshotId: string;
  mode: "overwrite" | "as-new-file";
  /** Required for `overwrite`. For `as-new-file` we derive a new path. */
  targetPath?: string;
}

// ---------- Path helpers ----------

function userDataPath(): string {
  return app.getPath("userData");
}

function localStoreRoot(): string {
  return path.join(userDataPath(), "snapshots");
}

function archiveQueuePath(): string {
  return path.join(userDataPath(), "snapshot-archive-queue.json");
}

/**
 * The MCP server's audit log. The desktop configures the spawned server to
 * write here via `--audit-log` (see mcpClientConfig.pennivoServerDefinition).
 * We read the same file to attribute MCP-driven writes back to their agent.
 */
function mcpAuditLogPath(): string {
  return path.join(userDataPath(), "mcp-audit.jsonl");
}

function dirForFileInStore(rootDir: string, absolutePath: string): string {
  const { dir } = snapshotPathSegments(absolutePath);
  return path.join(rootDir, dir);
}

function metaSidecarPath(snapshotMdPath: string): string {
  return snapshotMdPath.replace(/\.md$/i, ".json");
}

// ---------- sha256 ----------

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf-8").digest("hex");
}

// ---------- Settings cache ----------

let cachedSettings: RecoverySettings | null = null;
let cachedDeviceId: string = "";

export function setSnapshotEnvironment(
  settings: RecoverySettings,
  deviceId: string,
): void {
  cachedSettings = settings;
  cachedDeviceId = deviceId;
}

export function getCachedSettings(): RecoverySettings | null {
  return cachedSettings;
}

// ---------- Last cap-exceeded warning ----------
//
// `prune` returns warnings; we cache the most recent so the renderer can
// query the current state of the world (via getCapStatus IPC) without us
// having to keep hot mailbox state.

let lastCapWarning: PruneWarning | null = null;
export function getLastCapWarning(): PruneWarning | null {
  return lastCapWarning;
}

// ---------- Listening renderer ----------

let mainWindowRef: BrowserWindow | null = null;
export function setSnapshotMainWindow(win: BrowserWindow | null): void {
  mainWindowRef = win;
}
function emit(channel: string, payload: unknown): void {
  try {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send(channel, payload);
    }
  } catch (err) {
    console.error(`[snapshotStore] emit ${channel} failed:`, err);
  }
}

// ---------- List + read ----------

async function readSnapshotMeta(
  metaPath: string,
): Promise<SnapshotMetaFile | null> {
  try {
    const data = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(data) as SnapshotMetaFile;
  } catch {
    return null;
  }
}

async function listFromStore(
  storeRoot: string,
  absolutePath: string,
  source: StorageDestination,
): Promise<SnapshotWithSource[]> {
  const dir = dirForFileInStore(storeRoot, absolutePath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: SnapshotWithSource[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const meta = await readSnapshotMeta(path.join(dir, entry));
    if (!meta) continue;
    out.push({ ...meta, source });
  }
  return out;
}

/**
 * Combined list across local + archive stores, newest first, de-duped by
 * `id`. Local entries are preferred when both stores carry the same id (so
 * the History panel reads from the fast disk).
 */
export async function listSnapshots(
  absolutePath: string,
): Promise<SnapshotWithSource[]> {
  const local = await listFromStore(localStoreRoot(), absolutePath, "local");
  const archive: SnapshotWithSource[] = [];
  if (cachedSettings?.archiveFolder) {
    archive.push(
      ...(await listFromStore(
        cachedSettings.archiveFolder,
        absolutePath,
        "archive",
      )),
    );
  }
  const byId = new Map<string, SnapshotWithSource>();
  for (const s of local) byId.set(s.id, s);
  for (const s of archive) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((a, b) => b.ts - a.ts);
}

/**
 * Read a snapshot's content + meta. Tries local first, then archive.
 */
export async function readSnapshot(
  absolutePath: string,
  snapshotId: string,
): Promise<{ content: string; meta: SnapshotMetaFile } | null> {
  const candidates: Array<{ root: string }> = [{ root: localStoreRoot() }];
  if (cachedSettings?.archiveFolder)
    candidates.push({ root: cachedSettings.archiveFolder });

  for (const c of candidates) {
    const dir = dirForFileInStore(c.root, absolutePath);
    const mdPath = path.join(dir, `${snapshotId}.md`);
    const metaPath = path.join(dir, `${snapshotId}.json`);
    try {
      const content = await fs.readFile(mdPath, "utf-8");
      const meta = await readSnapshotMeta(metaPath);
      if (meta) return { content, meta };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------- Latest snapshot meta ----------

export async function getLatestSnapshot(
  absolutePath: string,
): Promise<SnapshotWithSource | undefined> {
  const all = await listSnapshots(absolutePath);
  return all[0];
}

// ---------- Archive retry queue ----------

async function readArchiveQueue(): Promise<ArchiveQueueEntry[]> {
  try {
    const data = await fs.readFile(archiveQueuePath(), "utf-8");
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed as ArchiveQueueEntry[];
  } catch {
    return [];
  }
}

async function writeArchiveQueue(entries: ArchiveQueueEntry[]): Promise<void> {
  try {
    await fs.writeFile(
      archiveQueuePath(),
      JSON.stringify(entries, null, 2),
      "utf-8",
    );
  } catch (err) {
    console.error("[snapshotStore] failed to persist archive queue:", err);
  }
}

async function enqueueArchiveWrite(entry: ArchiveQueueEntry): Promise<void> {
  const existing = await readArchiveQueue();
  const next = dedupeArchiveQueue([...existing, entry]);
  await writeArchiveQueue(next);
  emit("recovery:archive-status", { status: "queued", count: next.length });
}

/**
 * Returns true if any tier in the current settings routes snapshots to the
 * archive destination. Drives whether an unreachable archive folder is
 * worth surfacing to the user — if no tier ever writes there, an
 * unreachable archive folder is harmless and we stay quiet.
 */
function archiveIsActiveTarget(): boolean {
  const settings = cachedSettings;
  if (!settings || !settings.archiveFolder) return false;
  return settings.tierDestinations.some((t) =>
    t.destinations.includes("archive"),
  );
}

/**
 * Probe the archive folder for reachability. Emits `recovery:archive-status`
 * with the current state so the renderer can hide / show the titlebar chip.
 * Safe to call any time; pure observation, no side effects on the queue.
 *
 * Emits:
 *   - `unavailable` if archive is an active target but unreachable
 *   - `queued`      if archive is reachable but the retry queue still has
 *                   entries pending (shouldn't normally happen — drain
 *                   would've cleared them — but keeps the UI honest)
 *   - `ok`          if archive is an active target, reachable, queue empty
 *
 * If archive is not an active target (no tier writes to it, or no folder
 * configured), emits `ok` so any stale chip clears.
 */
export async function probeArchiveStatus(): Promise<void> {
  const queue = await readArchiveQueue();
  if (!archiveIsActiveTarget()) {
    emit("recovery:archive-status", { status: "ok", count: 0 });
    return;
  }
  const archiveFolder = cachedSettings!.archiveFolder!;
  try {
    await fs.mkdir(archiveFolder, { recursive: true });
  } catch {
    emit("recovery:archive-status", {
      status: "unavailable",
      count: queue.length,
    });
    return;
  }
  if (queue.length > 0) {
    emit("recovery:archive-status", { status: "queued", count: queue.length });
  } else {
    emit("recovery:archive-status", { status: "ok", count: 0 });
  }
}

/**
 * Try to flush every queued archive write. Called on every successful new
 * snapshot write. If the archive folder is reachable, drained writes
 * succeed; remaining entries stay in the queue for the next try.
 *
 * Always emits a current-state event so the renderer chip stays in sync —
 * `unavailable` if reachability fails, `queued` if entries remain after
 * draining, `ok` if everything cleared (or if there was nothing to do but
 * we want to confirm reachability when archive is an active target).
 */
export async function drainArchiveQueue(): Promise<void> {
  const archiveFolder = cachedSettings?.archiveFolder;
  if (!archiveFolder) return;

  const queue = await readArchiveQueue();
  if (queue.length === 0) {
    // Nothing queued — but if the archive is an active target, still probe
    // reachability so the chip reflects reality (e.g. user just pointed
    // settings at a bogus drive but hasn't saved yet).
    if (archiveIsActiveTarget()) {
      await probeArchiveStatus();
    }
    return;
  }

  // Cheap reachability probe — if the archive root can't be created/accessed,
  // there's no point trying every entry one by one.
  try {
    await fs.mkdir(archiveFolder, { recursive: true });
  } catch {
    emit("recovery:archive-status", {
      status: "unavailable",
      count: queue.length,
    });
    return;
  }

  const remaining: ArchiveQueueEntry[] = [];
  for (const entry of queue) {
    try {
      const fileDir = path.join(archiveFolder, path.dirname(entry.relPath));
      await fs.mkdir(fileDir, { recursive: true });
      await fs.writeFile(
        path.join(archiveFolder, entry.relPath),
        entry.content,
        "utf-8",
      );
      await fs.writeFile(
        path.join(archiveFolder, entry.metaRelPath),
        entry.meta,
        "utf-8",
      );
    } catch (err) {
      console.warn("[snapshotStore] archive flush still failing:", err);
      remaining.push(entry);
    }
  }

  await writeArchiveQueue(remaining);
  emit("recovery:archive-status", {
    status: remaining.length === 0 ? "ok" : "queued",
    count: remaining.length,
  });
}

// ---------- Snapshot writing ----------

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function writeSnapshotFiles(
  storeRoot: string,
  absolutePath: string,
  ts: number,
  content: string,
  meta: SnapshotMetaFile,
): Promise<{ mdPath: string; metaPath: string }> {
  const segments = snapshotPathSegments(absolutePath);
  const dirInStore = path.join(storeRoot, segments.dir);
  await ensureDir(dirInStore);
  const fileBasename = segments.fileBasename(ts);
  const mdPath = path.join(dirInStore, fileBasename);
  const metaPath = metaSidecarPath(mdPath);
  await fs.writeFile(mdPath, content, "utf-8");
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  return { mdPath, metaPath };
}

/**
 * The snapshot's id (and basename minus extension) is the cross-OS-safe ISO
 * string `snapshotFileBasename` produces, with `.md` stripped. Every store
 * uses the same id so combining lists across stores is straightforward.
 */
function snapshotIdForTs(ts: number): string {
  return snapshotFileBasename(ts).replace(/\.md$/i, "");
}

/**
 * Write a snapshot. Fire-and-log: returns the snapshot record on success,
 * `null` if the snapshot was dedupe-skipped or recovery is disabled. Never
 * throws to the caller.
 */
export async function writeSnapshot(
  input: WriteSnapshotInput,
): Promise<SnapshotMetaFile | null> {
  try {
    const { settings } = input;
    if (!settings.enabled) return null;

    const contentHash = sha256Hex(input.content);

    const latest = await getLatestSnapshot(input.absolutePath);
    if (shouldDedupe(contentHash, latest)) {
      // Even if we dedupe, we should still drain the archive queue if it's
      // got pending entries — the user may have just plugged the drive back
      // in. But: don't drain if we wrote nothing new (no new event needed).
      return null;
    }

    const ts = Date.now();
    const id = snapshotIdForTs(ts);
    const meta: SnapshotMetaFile = {
      id,
      ts,
      sizeBytes: Buffer.byteLength(input.content, "utf-8"),
      contentHash,
      author: input.author,
      agentName: input.agentName,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
      parentSnapshotId: input.parentSnapshotId ?? latest?.id,
      absolutePath: input.absolutePath,
      restoredFrom: input.restoredFrom,
    };

    // Tier 0 owns the freshest snapshots (age 0). If tier 0 is `off`, we
    // still write — the user explicitly disabled retention for that bucket
    // but the snapshot will be evicted on the next prune sweep. That's the
    // honest semantics: the writer doesn't second-guess the policy.
    const destinations = routeSnapshot(0, settings.tierDestinations);

    let wroteLocal = false;
    let wroteArchive = false;

    if (destinations.includes("local")) {
      try {
        await writeSnapshotFiles(
          localStoreRoot(),
          input.absolutePath,
          ts,
          input.content,
          meta,
        );
        wroteLocal = true;
      } catch (err) {
        console.error("[snapshotStore] local write failed:", err);
      }
    }

    if (destinations.includes("archive") && settings.archiveFolder) {
      const segments = snapshotPathSegments(input.absolutePath);
      const fileBasename = segments.fileBasename(ts);
      const relPath = `${segments.dir}/${fileBasename}`;
      const metaRelPath = `${segments.dir}/${fileBasename.replace(/\.md$/i, ".json")}`;
      try {
        await writeSnapshotFiles(
          settings.archiveFolder,
          input.absolutePath,
          ts,
          input.content,
          meta,
        );
        wroteArchive = true;
      } catch (err) {
        console.warn("[snapshotStore] archive write failed; enqueueing:", err);
        await enqueueArchiveWrite({
          absolutePath: input.absolutePath,
          snapshotId: id,
          ts,
          relPath,
          metaRelPath,
          content: input.content,
          meta: JSON.stringify(meta, null, 2),
          enqueuedAt: Date.now(),
        });
      }
    }

    if (!wroteLocal && !wroteArchive) {
      // Nothing landed — there's no record of this snapshot anywhere. Skip
      // the prune step; nothing to prune. Return null so callers know it
      // wasn't captured.
      return null;
    }

    // Drain queue in the background — if the archive came back this is when
    // we flush the backlog. Don't await the drain in the main path; it's
    // fire-and-log too.
    void drainArchiveQueue();

    // Run prune lazily for this file's snapshots in each store independently.
    void pruneFile(input.absolutePath, settings).catch((err) => {
      console.error("[snapshotStore] prune failed:", err);
    });

    return meta;
  } catch (err) {
    console.error("[snapshotStore] writeSnapshot failed:", err);
    return null;
  }
}

// ---------- Pruning ----------

async function pruneStore(
  storeRoot: string,
  absolutePath: string,
  settings: RecoverySettings,
  source: StorageDestination,
): Promise<{ warnings: PruneWarning[] }> {
  const dir = dirForFileInStore(storeRoot, absolutePath);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { warnings: [] };
  }
  const snaps: SnapshotMetaFile[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const meta = await readSnapshotMeta(path.join(dir, entry));
    if (meta) snaps.push(meta);
  }

  // Apply maxStorageBytes only if not null (null = unlimited).
  const policy =
    settings.maxStorageBytes === null
      ? { ...settings.retentionPolicy, maxStorageBytes: undefined }
      : {
          ...settings.retentionPolicy,
          maxStorageBytes: settings.maxStorageBytes,
        };

  const result = prune(snaps, policy, Date.now());

  // Evict losers — best effort.
  for (const evict of result.evict) {
    const mdPath = path.join(dir, `${evict.id}.md`);
    const metaPath = path.join(dir, `${evict.id}.json`);
    await fs.unlink(mdPath).catch(() => {});
    await fs.unlink(metaPath).catch(() => {});
  }

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      lastCapWarning = w;
      emit("recovery:cap-exceeded", { ...w, source });
    }
  }
  return { warnings: result.warnings };
}

async function pruneFile(
  absolutePath: string,
  settings: RecoverySettings,
): Promise<void> {
  await pruneStore(localStoreRoot(), absolutePath, settings, "local");
  if (settings.archiveFolder) {
    await pruneStore(
      settings.archiveFolder,
      absolutePath,
      settings,
      "archive",
    ).catch(() => {});
  }
}

// ---------- MCP write attribution ----------
//
// When an MCP agent writes a file out-of-process, Pennivo only notices on the
// next open as an `external` change. The MCP server records every write to
// mcp-audit.jsonl (workspace-relative path). On open we correlate: if a recent
// successful MCP write targeted this file, we tag the snapshot `mcp` + the
// writing agent instead of `external`.

/** How far back an MCP write may be to still own the open we are reconciling. */
const MCP_ATTRIBUTION_WINDOW_MS = 5 * 60 * 1000;

/** Bound on how much of the audit log tail we read. Plenty for a 5-min window. */
const MCP_AUDIT_TAIL_BYTES = 64 * 1024;

/**
 * Resolver from an absolute file path to the absolute workspace root that
 * contains it (forward-slash agnostic; returns null when no known root holds
 * the path). Injected by the host at startup so this module stays decoupled
 * from the workspace-state readers in main.ts. When unset (or returning null)
 * MCP attribution is simply skipped and the open falls back to `external`.
 */
type WorkspaceRootResolver = (absolutePath: string) => Promise<string | null>;
let workspaceRootResolver: WorkspaceRootResolver | null = null;
export function setWorkspaceRootResolver(
  resolver: WorkspaceRootResolver | null,
): void {
  workspaceRootResolver = resolver;
}

/**
 * Express `absolute` relative to `root` the SAME way the MCP server records
 * audit paths (`toWorkspaceRelative`): forward slashes, drive letter folded,
 * `.` for the root itself. The pure matcher folds case for the compare, so we
 * need only match the slash/relativization here.
 */
function workspaceRelPath(root: string, absolute: string): string {
  const rel = path.posix.relative(
    normalizeAbsolutePath(root),
    normalizeAbsolutePath(absolute),
  );
  return rel === "" ? "." : rel;
}

/**
 * Read a bounded tail of the MCP audit log and parse it into events. Reads at
 * most `MCP_AUDIT_TAIL_BYTES` from the end of the file so a long-lived log
 * never gets read whole. Missing / unreadable file -> empty list (no match).
 * The pure parser drops any line truncated by the tail offset.
 */
async function readRecentMcpAuditEvents(): Promise<
  ReturnType<typeof parseAuditLines>
> {
  const filePath = mcpAuditLogPath();
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const { size } = await handle.stat();
    const start = size > MCP_AUDIT_TAIL_BYTES ? size - MCP_AUDIT_TAIL_BYTES : 0;
    const length = size - start;
    if (length <= 0) return [];
    const buf = Buffer.alloc(length);
    await handle.read(buf, 0, length, start);
    return parseAuditLines(buf.toString("utf-8"));
  } catch {
    // No audit log yet, or transient read error: no events -> no match.
    return [];
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

/**
 * Resolve the MCP write attribution for a just-opened file, if any. Returns
 * the writing agent name when a recent successful MCP write targeted this
 * path, else null. Fully guarded: any missing dependency (no resolver, no
 * workspace root, no audit log, no match) yields null so the caller keeps the
 * existing `external` behavior.
 */
async function resolveMcpAttribution(
  absolutePath: string,
): Promise<{ agentName: string } | null> {
  try {
    if (!workspaceRootResolver) return null;
    const root = await workspaceRootResolver(absolutePath);
    if (!root) return null;
    const relPath = workspaceRelPath(root, absolutePath);
    const events = await readRecentMcpAuditEvents();
    if (events.length === 0) return null;
    return matchMcpWrite(
      events,
      relPath,
      MCP_ATTRIBUTION_WINDOW_MS,
      Date.now(),
    );
  } catch (err) {
    console.error("[snapshotStore] MCP attribution failed:", err);
    return null;
  }
}

// ---------- External-change detection on file open ----------

/**
 * Inspect the just-read file content vs the most recent snapshot for this
 * path. Captures a baseline (`first-seen`) or `external` snapshot if needed
 * and emits the renderer event for `external`. No-op when content matches.
 *
 * Returns the captured snapshot (if any) so callers can wire test expectations.
 */
export async function reconcileOnOpen(
  absolutePath: string,
  diskContent: string,
): Promise<{
  status: "first-seen" | "external" | "unchanged";
  snapshot: SnapshotMetaFile | null;
}> {
  const settings = cachedSettings;
  if (!settings || !settings.enabled) {
    return { status: "unchanged", snapshot: null };
  }
  const diskHash = sha256Hex(diskContent);
  const latest = await getLatestSnapshot(absolutePath);
  const status = detectExternalChange(diskHash, latest);

  if (status === "unchanged") return { status, snapshot: null };

  // For first-seen, take a `user` baseline. For external, the change came from
  // off-app: it could be a faulty sync / another editor (-> `external`) OR an
  // MCP agent that wrote out-of-process. If a recent successful MCP write
  // targeted this file, attribute the snapshot to that agent (`mcp`); else keep
  // the existing `external` behavior. Attribution is fully guarded: no
  // resolver / no audit log / no match all leave `author` as `external`.
  let author: SnapshotAuthor = status === "external" ? "external" : "user";
  let agentName: string | undefined;
  if (status === "external") {
    const attribution = await resolveMcpAttribution(absolutePath);
    if (attribution) {
      author = "mcp";
      agentName = attribution.agentName;
    }
  }

  const snap = await writeSnapshot({
    absolutePath,
    content: diskContent,
    author,
    agentName,
    settings,
    deviceId: cachedDeviceId,
    deviceName: settings.deviceName,
  });

  // The external-change toast fires for genuinely-unattributed off-app edits.
  // An MCP-attributed write is expected agent activity, not a "changed outside
  // Pennivo" surprise, so we don't toast it (History still shows the agent).
  if (status === "external" && author === "external" && snap) {
    emit("recovery:external-change-detected", {
      absolutePath,
      snapshotId: snap.id,
    });
  }

  return { status, snapshot: snap };
}

// ---------- Restore ----------

/**
 * Restore a snapshot to disk. `overwrite` writes back to the file's current
 * absolute path AFTER taking a pre-restore snapshot of the on-disk content
 * (so the user can roll back). `as-new-file` copies the snapshot to a sibling
 * path `<stem> (restored YYYY-MM-DD).md`.
 */
export async function restoreSnapshot(
  absolutePath: string,
  input: RestoreInput,
): Promise<{ newPath: string } | null> {
  const settings = cachedSettings;
  if (!settings) return null;

  const found = await readSnapshot(absolutePath, input.snapshotId);
  if (!found) return null;

  if (input.mode === "overwrite") {
    const target = input.targetPath ?? absolutePath;
    // Pre-restore snapshot of CURRENT on-disk content so the restore is
    // reversible. Read the current content if the file exists.
    let current: string;
    try {
      current = await fs.readFile(target, "utf-8");
    } catch {
      current = "";
    }
    if (current.length > 0) {
      await writeSnapshot({
        absolutePath: target,
        content: current,
        author: "user",
        settings,
        deviceId: cachedDeviceId,
        deviceName: settings.deviceName,
        restoredFrom: input.snapshotId,
      });
    }
    await fs.writeFile(target, found.content, "utf-8");
    return { newPath: target.replace(/\\/g, "/") };
  }

  // as-new-file
  const dir = path.dirname(absolutePath);
  const ext = path.extname(absolutePath) || ".md";
  const stem = path.basename(absolutePath, ext);
  const dateStr = new Date().toISOString().slice(0, 10);
  let target = path.join(dir, `${stem} (restored ${dateStr})${ext}`);
  // Avoid collision
  let counter = 1;
  while (await pathExists(target)) {
    counter += 1;
    target = path.join(dir, `${stem} (restored ${dateStr} ${counter})${ext}`);
    if (counter > 50) {
      target = path.join(
        dir,
        `${stem} (restored ${dateStr} ${randomUUID().slice(0, 6)})${ext}`,
      );
      break;
    }
  }
  await fs.writeFile(target, found.content, "utf-8");
  return { newPath: target.replace(/\\/g, "/") };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
