import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  dialog,
  Menu,
  net,
  protocol,
  screen,
  session,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import {
  applyArchiveDefaults,
  buildContextMenu,
  decodeImageUrlSpaces,
  encodeImageUrlSpaces,
  extractReferencedFolders,
  migrateRecoverySettings,
  migrateWorkspaces,
  planNormalize,
  searchFiles,
  workspaceNameFromPath,
  defaultWorkspacePrefs,
  type RecoverySettings,
  type SearchOptions,
  type SearchResults,
  type Workspace,
  type WorkspacePrefs,
  type WorkspacesState,
} from "@pennivo/core";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { deviceNameFromSettings, getDeviceRecord } from "./deviceIdentity";
import {
  applyLinkRewrite,
  enumerateMarkdownFiles,
  toPosix,
  workspaceRelativePosix,
} from "./linkRewriteIntegration";
import {
  drainArchiveQueue,
  getLastCapWarning,
  listSnapshots,
  probeArchiveStatus,
  reconcileOnOpen,
  readSnapshot,
  restoreSnapshot,
  setSnapshotEnvironment,
  setSnapshotMainWindow,
  setWorkspaceRootResolver,
  sha256Hex,
  writeSnapshot,
} from "./snapshotStore";
import {
  listTrash,
  moveToTrash,
  permanentlyDelete as permanentlyDeleteTrashEntry,
  readTrashContent,
  restoreFromTrash,
  setTrashMainWindow,
  sweepExpired as sweepExpiredTrash,
} from "./trashStore";
import { startMcpHostBridge, stopMcpHostBridge } from "./mcpHostBridge";
import {
  readFileSync,
  writeFileSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  copyConfigSnippet as copyMcpConfigSnippet,
  detectClaude as detectClaudeForMcp,
  writeClaudeConfig as writeClaudeMcpConfig,
} from "./mcpClientConfig";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let forceClose = false;
let folderWatcher: FSWatcher | null = null;

// --- Live-reload of the open document on external change (Phase 12d-pre) ---
// The renderer reports its currently-open file path via `watch:set-open-file`.
// When a watcher (sidebar folderWatcher or the dedicated openFileWatcher below)
// sees that exact file change on disk, we run `reconcileOnOpen` so the existing
// Phase 13a pipeline takes an `external`-tagged snapshot and emits
// `recovery:external-change-detected` — which the renderer turns into a smooth
// reload (clean) or a Compare & merge prompt (dirty).
let currentOpenPath: string | null = null;
// Absolute path of the folder the sidebar folderWatcher currently covers
// (recursively). Used to decide whether the open file already has coverage.
let watchedSidebarFolder: string | null = null;
// Dedicated watcher on the open file's parent dir, started only when that dir
// is NOT already inside `watchedSidebarFolder` (no workspace, or file elsewhere).
let openFileWatcher: FSWatcher | null = null;
// Debounce timer for coalescing chunked external writes to the open file.
let openFileChangeDebounce: ReturnType<typeof setTimeout> | undefined;
// Self-write echo guard: content hashes Pennivo just wrote, keyed by normalized
// path. A watcher event whose fresh disk hash matches a recent self-write is
// ignored so our own saves don't trigger a reload flicker. Entries expire.
const SELF_WRITE_TTL_MS = 2000;
const recentSelfWrites = new Map<string, { hash: string; at: number }>();

function normPathKey(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function recordSelfWrite(filePath: string, content: string): void {
  recentSelfWrites.set(normPathKey(filePath), {
    hash: sha256Hex(content),
    at: Date.now(),
  });
}

// True when `dir` is the watched sidebar folder or a descendant of it (the
// folderWatcher is recursive, so files under it are already covered).
function isWithinWatchedSidebarFolder(dir: string): boolean {
  if (!watchedSidebarFolder) return false;
  const root = normPathKey(watchedSidebarFolder);
  const target = normPathKey(dir);
  return target === root || target.startsWith(root + "/");
}

// Called when any watcher observes a change to `changedAbsPath`. If that path is
// the currently-open file, debounce then reconcile (which emits the external-
// change event the renderer reloads from). No-op for every other path.
function handlePossibleOpenFileChange(changedAbsPath: string): void {
  if (!currentOpenPath) return;
  if (normPathKey(changedAbsPath) !== normPathKey(currentOpenPath)) return;
  clearTimeout(openFileChangeDebounce);
  openFileChangeDebounce = setTimeout(() => {
    void reconcileOpenFileFromDisk();
  }, 200);
}

async function reconcileOpenFileFromDisk(): Promise<void> {
  const target = currentOpenPath;
  if (!target) return;
  let content: string;
  try {
    content = await fs.readFile(target, "utf-8");
  } catch {
    // File may have been deleted/renamed out from under us — nothing to reload.
    return;
  }
  // Skip our own just-written content (belt-and-suspenders over snapshot dedupe).
  const key = normPathKey(target);
  const self = recentSelfWrites.get(key);
  if (self) {
    if (Date.now() - self.at > SELF_WRITE_TTL_MS) {
      recentSelfWrites.delete(key);
    } else if (self.hash === sha256Hex(content)) {
      return;
    }
  }
  await reconcileOnOpen(target, content).catch((err) => {
    console.error("[live-reload] reconcileOnOpen failed:", err);
  });
}

// Start/stop the dedicated open-file watcher based on `currentOpenPath` and
// whether the sidebar folderWatcher already covers it.
function refreshOpenFileWatcher(): void {
  if (openFileWatcher) {
    openFileWatcher.close();
    openFileWatcher = null;
  }
  if (!currentOpenPath) return;
  const dir = path.dirname(currentOpenPath);
  if (isWithinWatchedSidebarFolder(dir)) return; // already covered
  try {
    openFileWatcher = watch(
      dir,
      { recursive: false },
      (_eventType, filename) => {
        if (!filename) return;
        handlePossibleOpenFileChange(path.join(dir, filename.toString()));
      },
    );
  } catch {
    // Watching may fail on some filesystems — live-reload simply won't fire.
  }
}

function setCurrentOpenFile(filePath: string | null): void {
  currentOpenPath = filePath;
  // Drop any pending reconcile for the previous file — it's no longer open.
  clearTimeout(openFileChangeDebounce);
  refreshOpenFileWatcher();
}

// --- Single-instance lock + file-from-OS handling ---
// When a user double-clicks a .md file in Explorer (after we've registered
// the file association), Windows launches Pennivo with the file path as
// argv[1]. If Pennivo is already running, the OS spawns a second process —
// we forward its argv to the existing instance and exit the new one.

// Captured at module load so it's set before createWindow runs.
let pendingFilePath: string | null = null;

const MARKDOWN_EXT_RE = /\.(md|markdown|txt)$/i;

function getFilePathFromArgv(argv: readonly string[]): string | null {
  // argv[0] is the executable path; skip it. Skip flags (--foo) and the
  // dev-mode "." cwd marker. Return the first remaining arg that has a
  // markdown-ish extension and points to a real file.
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (typeof arg !== "string") continue;
    if (arg.startsWith("-")) continue;
    if (arg === ".") continue;
    if (!MARKDOWN_EXT_RE.test(arg)) continue;
    try {
      if (statSync(arg).isFile()) return path.resolve(arg);
    } catch {
      // not a real file — keep looking
    }
  }
  return null;
}

// Skip the single-instance lock in dev so a dev build can run alongside an
// installed production copy. In production we still enforce it so opening a
// .md from Explorer routes argv to the running window instead of spawning a
// second Pennivo.
if (app.isPackaged && !app.requestSingleInstanceLock()) {
  // Another Pennivo instance is already running. The primary will receive
  // our argv via the 'second-instance' event below. Quit immediately.
  app.quit();
  process.exit(0);
}

pendingFilePath = getFilePathFromArgv(process.argv);

app.on("second-instance", (_event, commandLine) => {
  const filePath = getFilePathFromArgv(commandLine);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    if (filePath) mainWindow.webContents.send("file:open-from-os", filePath);
  } else if (filePath) {
    // Window not yet created — queue for the launch effect to pick up.
    pendingFilePath = filePath;
  }
});

// --- Window state persistence ---
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = {
  width: 1200,
  height: 800,
  maximized: false,
};

function getWindowStatePath(): string {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState(): WindowState {
  try {
    const data = readFileSync(getWindowStatePath(), "utf-8");
    const parsed = JSON.parse(data);
    if (
      parsed &&
      typeof parsed.width === "number" &&
      typeof parsed.height === "number"
    ) {
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupt
  }
  return DEFAULT_WINDOW_STATE;
}

function saveWindowState(): void {
  if (!mainWindow) return;
  // Use getNormalBounds() so we persist the pre-maximize size, not the
  // maximized bounds. Otherwise restoring + unmaximizing leaves the
  // window stuck at full-screen size with nothing smaller to fall back
  // to.
  const bounds = mainWindow.getNormalBounds();
  const maximized = mainWindow.isMaximized();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized,
  };
  writeFileSync(getWindowStatePath(), JSON.stringify(state), "utf-8");
}

function isPositionOnScreen(x: number, y: number): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x: dx, y: dy, width, height } = d.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
}

/**
 * Sum the byte size of every regular file in a directory tree. Returns 0 if
 * the root doesn't exist. Used by `snapshot:get-storage-usage` to render the
 * Settings → Recovery "127 MB of 200 MB used." sub-label without forcing the
 * renderer to do a tree walk via IPC.
 */
async function sumDirectoryBytes(root: string): Promise<number> {
  let total = 0;
  let entries: {
    name: string;
    isDirectory: () => boolean;
    isFile: () => boolean;
  }[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })) as unknown as {
      name: string;
      isDirectory: () => boolean;
      isFile: () => boolean;
    }[];
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(root, e.name);
    if (e.isDirectory()) {
      total += await sumDirectoryBytes(full);
    } else if (e.isFile()) {
      try {
        const st = statSync(full);
        total += st.size;
      } catch {
        // file vanished between readdir and stat — skip
      }
    }
  }
  return total;
}

// --- Settings persistence ---
interface AppSettings {
  firstRun?: boolean;
  editorFontSize?: number;
  editorFontFamily?: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
  spellcheck?: boolean;
  showWordCount?: boolean;
  typewriterMode?: boolean;
  /**
   * Global sidebar display pref: when true (default), folders with no markdown
   * descendants still render in the tree (so newly created / empty folders are
   * visible). When false, the legacy pruning behavior is preserved exactly.
   * Honored by `readDirectoryTree` via the `sidebar:read-directory` handler.
   */
  showEmptyFolders?: boolean;
  /**
   * Phase 13a recovery configuration. Always migrated through
   * `migrateRecoverySettings` on read so missing keys fill from defaults
   * without clobbering user-set values.
   */
  recovery?: RecoverySettings;
  /**
   * Phase 12a MCP permission slice (a PermissionConfig). Stored verbatim and
   * read by the headless `pennivo --mcp` process via `mergeAndValidate`; not
   * interpreted here, just round-tripped through settings.
   */
  mcp?: unknown;
  /**
   * Phase 2 multiple-workspaces state. Migrated lazily on read from the
   * legacy `sidebar-folder.json` + global sort/timestamp keys via
   * `migrateWorkspaces` and persisted here once the renderer mutates it.
   */
  workspaces?: WorkspacesState;
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings(): AppSettings {
  try {
    const data = readFileSync(getSettingsPath(), "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Serializes concurrent settings writes so two in-flight callers (e.g. a prefs
// save racing a set-active) cannot interleave their temp-file + rename steps.
let settingsWriteChain: Promise<void> = Promise.resolve();

async function writeSettings(settings: AppSettings): Promise<void> {
  // Atomic write: serialize, write to a unique temp file, then rename over the
  // target. A rename is atomic on the same filesystem, so a concurrent reader
  // (readSettings) never observes a half-written settings.json and falls back
  // to an empty object, which would otherwise re-migrate from the legacy folder
  // and drop every workspace except the active one (the multiple-workspaces
  // startup corruption this guards against).
  const run = settingsWriteChain.then(async () => {
    const target = getSettingsPath();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(settings, null, 2);
    try {
      await fs.writeFile(tmp, data, "utf-8");
      await fs.rename(tmp, target);
    } catch (err) {
      // Best-effort cleanup of the temp file if the rename failed.
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
      throw err;
    }
  });
  // Keep the chain alive even if this write rejects, so later writes still run.
  settingsWriteChain = run.catch(() => {});
  await run;
}

/**
 * Read-modify-write the settings file with no gap: the `produce` callback runs
 * INSIDE the serialized write chain, receiving the freshest on-disk settings
 * and returning the object to persist. Use this (over a bare readSettings →
 * writeSettings) whenever the write must reflect concurrent mutations that may
 * have landed since the caller's own earlier read — e.g. settings:set must pick
 * up the live `workspaces` slice rather than reverting it from a stale renderer
 * snapshot. The atomic temp-file + rename is identical to `writeSettings`.
 */
async function mutateSettings(
  produce: (current: AppSettings) => AppSettings,
): Promise<void> {
  const run = settingsWriteChain.then(async () => {
    const current = readSettings();
    const settings = produce(current);
    const target = getSettingsPath();
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(settings, null, 2);
    try {
      await fs.writeFile(tmp, data, "utf-8");
      await fs.rename(tmp, target);
    } catch (err) {
      try {
        await fs.unlink(tmp);
      } catch {
        // ignore
      }
      throw err;
    }
  });
  settingsWriteChain = run.catch(() => {});
  await run;
}

/**
 * Read settings + migrate the recovery sub-section to a fully-populated
 * shape. Always returns a `recovery` field so downstream code can treat it
 * as required.
 */
function readSettingsWithRecovery(): AppSettings & {
  recovery: RecoverySettings;
} {
  const raw = readSettings();
  const recovery = migrateRecoverySettings(raw.recovery);
  return { ...raw, recovery };
}

/**
 * Refresh the cached recovery environment from disk. Called on launch and
 * whenever the renderer pushes new settings. Also drains the archive queue
 * if the cache change made the archive folder reachable.
 */
async function refreshSnapshotEnvironment(): Promise<void> {
  const settings = readSettingsWithRecovery();
  const device = await getDeviceRecord(app.getPath("userData"));
  setSnapshotEnvironment(settings.recovery, device.deviceId);
  // Let the snapshot store attribute MCP-driven writes by resolving a file's
  // workspace root on open (reuses the link-rewrite root resolver). Idempotent.
  setWorkspaceRootResolver(resolveWorkspaceRootFor);
  // Drain any queued archive writes — the archive may have just become
  // reachable (drive plugged in, settings updated).
  await drainArchiveQueue();
  // Probe the archive folder for reachability so the titlebar chip
  // surfaces immediately when the user has pointed at a bogus path,
  // before any save is attempted.
  await probeArchiveStatus();
}

// --- Recent files persistence ---
const RECENT_FILES_MAX = 10;

function getRecentFilesPath(): string {
  return path.join(app.getPath("userData"), "recent-files.json");
}

async function readRecentFiles(): Promise<string[]> {
  try {
    const data = await fs.readFile(getRecentFilesPath(), "utf-8");
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed))
      return parsed.filter((p): p is string => typeof p === "string");
  } catch {
    // File doesn't exist or is corrupt
  }
  return [];
}

async function writeRecentFiles(files: string[]): Promise<void> {
  await fs.writeFile(getRecentFilesPath(), JSON.stringify(files), "utf-8");
}

async function addRecentFile(filePath: string): Promise<string[]> {
  const existing = await readRecentFiles();
  // Normalize path for comparison
  const normalized = filePath.replace(/\\/g, "/");
  const filtered = existing.filter((p) => p.replace(/\\/g, "/") !== normalized);
  const updated = [filePath, ...filtered].slice(0, RECENT_FILES_MAX);
  await writeRecentFiles(updated);
  return updated;
}

async function clearRecentFiles(): Promise<void> {
  await writeRecentFiles([]);
}

// --- Toolbar config persistence ---
function getToolbarConfigPath(): string {
  return path.join(app.getPath("userData"), "toolbar-config.json");
}

async function readToolbarConfig(): Promise<string[] | null> {
  try {
    const data = await fs.readFile(getToolbarConfigPath(), "utf-8");
    const parsed = JSON.parse(data);
    if (
      Array.isArray(parsed) &&
      parsed.every((s): s is string => typeof s === "string")
    )
      return parsed;
  } catch {
    // File doesn't exist or is corrupt — return null so renderer uses defaults
  }
  return null;
}

async function writeToolbarConfig(actions: string[]): Promise<void> {
  await fs.writeFile(getToolbarConfigPath(), JSON.stringify(actions), "utf-8");
}

// --- Sidebar folder persistence ---
const SIDEBAR_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

function getSidebarFolderPath(): string {
  return path.join(app.getPath("userData"), "sidebar-folder.json");
}

async function readSidebarFolder(): Promise<string | null> {
  try {
    const data = await fs.readFile(getSidebarFolderPath(), "utf-8");
    const parsed = JSON.parse(data);
    if (typeof parsed === "string") return parsed;
  } catch {
    // File doesn't exist
  }
  return null;
}

async function writeSidebarFolder(folderPath: string | null): Promise<void> {
  await fs.writeFile(
    getSidebarFolderPath(),
    JSON.stringify(folderPath),
    "utf-8",
  );
}

// --- Workspaces (Phase 2) ---
//
// Workspaces are persisted inside settings.json under the `workspaces` key,
// but migrated lazily: on every read we run the pure `migrateWorkspaces`
// helper against the raw settings + the legacy `sidebar-folder.json` so a
// first-run user (no `workspaces` key yet) gets a single workspace seeded
// from the folder they already had open. The migration is idempotent and
// non-destructive: `sidebar-folder.json` is never deleted, and re-running
// it on already-migrated state passes that state through untouched. We do
// NOT write during the read — persistence happens only when the renderer
// mutates state via the `workspaces:*` handlers below.

// Largest document (in UTF-8 bytes) the global-search handler will scan. Core
// exposes no shared large-file constant, so we define a local cap here: files
// above this are skipped so one giant document cannot dominate a search. This
// sits above the editor's source-mode lock threshold (1.5 MB) by a margin.
const SEARCH_MAX_FILE_BYTES = 2_000_000;

/**
 * Read settings + resolve the current `WorkspacesState`, running the lazy
 * migration. The id generator is Node `crypto.randomUUID`, main-process only.
 */
async function readWorkspacesState(): Promise<{
  settings: AppSettings;
  workspaces: WorkspacesState;
}> {
  const settings = readSettings();
  const legacyFolder = await readSidebarFolder();
  const workspaces = migrateWorkspaces(
    settings as Record<string, unknown>,
    legacyFolder,
    () => randomUUID(),
  );
  return { settings, workspaces };
}

/** Resolve the active workspace's root path, or null when none is active. */
function activeWorkspaceRoot(state: WorkspacesState): string | null {
  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  return active ? active.rootPath : null;
}

/** True when `absPath` is exactly `rootAbs` or sits under it on a boundary. */
function isUnderRoot(rootAbs: string, absPath: string): boolean {
  const rel = path.relative(rootAbs, absPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve the workspace root that contains `absPath`, for the Phase 11f link
 * rewrite. Considers every known workspace root plus the legacy sidebar
 * folder, and returns the most specific (longest) root that contains the
 * path. Returns null when no known root contains it, in which case the caller
 * skips the cross-document rewrite (the move/rename still proceeds).
 */
async function resolveWorkspaceRootFor(
  absPath: string,
): Promise<string | null> {
  const candidates = new Set<string>();
  try {
    const { workspaces } = await readWorkspacesState();
    for (const w of workspaces.workspaces) {
      if (w.rootPath) candidates.add(w.rootPath);
    }
  } catch {
    // Settings unreadable — fall back to the legacy folder below.
  }
  try {
    const legacy = await readSidebarFolder();
    if (legacy) candidates.add(legacy);
  } catch {
    // No legacy folder.
  }

  let best: string | null = null;
  for (const root of candidates) {
    if (!isUnderRoot(root, absPath)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

/**
 * Pre-move preparation for the Phase 11f link rewrite. Resolves the workspace
 * root that contains `oldAbs`, enumerates every markdown document under it
 * (pre-move snapshot, POSIX-relative content), and computes the old/new
 * workspace-relative POSIX paths the planner needs. Returns null when no
 * workspace root contains the path (the move/rename still proceeds without a
 * cross-document rewrite) or when either path falls outside the resolved root.
 * Must be called BEFORE the fs move/rename so the snapshot reflects the
 * pre-move world.
 */
/**
 * Move a filesystem entry (file or directory) from `src` to `dest`. Prefers
 * `fs.rename` (atomic, same-volume). When that fails with EXDEV — the source
 * and destination live on different devices/mount points, where rename is not
 * permitted — fall back to a recursive copy followed by a recursive remove of
 * the source. Any other error propagates to the caller. Used by the sidebar
 * move so a directory move works across volumes and carries its whole subtree.
 */
async function moveEntry(src: string, dest: string): Promise<void> {
  try {
    await fs.rename(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EXDEV") {
      // Cross-device: copy the subtree, then remove the original.
      await fs.cp(src, dest, { recursive: true, force: true });
      await fs.rm(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}

async function prepareLinkRewrite(
  oldAbs: string,
  newAbs: string,
): Promise<{
  rootAbs: string;
  snapshot: { path: string; content: string }[];
  oldRelPosix: string;
  newRelPosix: string;
} | null> {
  let rootAbs: string | null;
  try {
    rootAbs = await resolveWorkspaceRootFor(oldAbs);
  } catch (err) {
    console.error("[link-rewrite] workspace-root resolution failed:", err);
    return null;
  }
  if (!rootAbs) return null;

  const oldRelPosix = workspaceRelativePosix(rootAbs, oldAbs);
  const newRelPosix = workspaceRelativePosix(rootAbs, newAbs);
  if (!oldRelPosix || !newRelPosix) {
    // Path escaped the root (e.g. move across workspaces). Skip the rewrite;
    // the move/rename itself still proceeds.
    return null;
  }

  let snapshot: { path: string; content: string }[];
  try {
    snapshot = await enumerateMarkdownFiles(rootAbs);
  } catch (err) {
    console.error("[link-rewrite] markdown enumeration failed:", err);
    return null;
  }

  return { rootAbs, snapshot, oldRelPosix, newRelPosix };
}

/**
 * Apply a legacy `sidebar:set-folder` call to a `WorkspacesState`. Updates the
 * active workspace's rootPath in place, or adds a new active workspace when
 * none exists. A null `folderPath` clears the active selection without
 * removing any workspace (matching today's "no folder open" behavior). Never
 * touches folder contents on disk.
 */
function applySidebarFolderToWorkspaces(
  state: WorkspacesState,
  folderPath: string | null,
): WorkspacesState {
  if (!folderPath) {
    // Clearing the sidebar folder: deselect, but keep the workspace list.
    return { ...state, activeWorkspaceId: null };
  }

  const active = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
  if (active) {
    // Repoint the active workspace at the new root, refreshing its name.
    const workspaces = state.workspaces.map((w) =>
      w.id === active.id
        ? {
            ...w,
            rootPath: folderPath,
            name: workspaceNameFromPath(folderPath),
          }
        : w,
    );
    return { ...state, workspaces };
  }

  // No active workspace: add one and make it active, seeding default prefs.
  const id = randomUUID();
  const workspace: Workspace = {
    id,
    name: workspaceNameFromPath(folderPath),
    rootPath: folderPath,
  };
  return {
    workspaces: [...state.workspaces, workspace],
    activeWorkspaceId: id,
    prefs: { ...state.prefs, [id]: defaultWorkspacePrefs() },
  };
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
  size?: number;
  mtimeMs?: number;
  lastOpenedMs?: number;
}

async function readDirectoryTree(
  dirPath: string,
  showEmptyFolders: boolean,
): Promise<FileTreeEntry[]> {
  const entries: FileTreeEntry[] = [];
  let items;
  try {
    items = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return entries;
  }

  // Sort: folders first, then files, both alphabetical
  items.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  for (const item of items) {
    // Skip hidden files/folders
    if (item.name.startsWith(".")) continue;
    // Skip node_modules, etc.
    if (item.name === "node_modules") continue;

    const fullPath = path.join(dirPath, item.name).replace(/\\/g, "/");

    if (item.isDirectory()) {
      const children = await readDirectoryTree(
        path.join(dirPath, item.name),
        showEmptyFolders,
      );
      // By default the sidebar is a markdown browser, so a folder with no
      // matching files (directly or nested) is pruned. When `showEmptyFolders`
      // is on, the folder node is kept even with zero markdown descendants so
      // newly created / empty folders are visible. Deeply nested empty folders
      // surface too, since the same flag flows through the recursion above.
      if (showEmptyFolders || children.length > 0) {
        entries.push({
          name: item.name,
          path: fullPath,
          type: "folder",
          children,
        });
      }
    } else {
      const ext = path.extname(item.name).toLowerCase();
      if (SIDEBAR_EXTENSIONS.has(ext)) {
        let size: number | undefined;
        let mtimeMs: number | undefined;
        try {
          const stat = await fs.stat(path.join(dirPath, item.name));
          size = stat.size;
          mtimeMs = stat.mtimeMs;
        } catch {
          // stat failure is non-fatal — file still listed without sortable metadata
        }
        entries.push({
          name: item.name,
          path: fullPath,
          type: "file",
          size,
          mtimeMs,
        });
      }
    }
  }

  return entries;
}

function startFolderWatcher(folderPath: string) {
  stopFolderWatcher();
  try {
    folderWatcher = watch(
      folderPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const name = filename.toString();
        const ext = path.extname(name).toLowerCase();
        // Only notify for relevant file changes
        if (SIDEBAR_EXTENSIONS.has(ext) || ext === "") {
          mainWindow?.webContents.send("sidebar:folder-changed");
        }
        // Live-reload: if the changed file is the one open in the editor,
        // reconcile from disk (recursive watch → filename may include subdirs).
        handlePossibleOpenFileChange(path.join(folderPath, name));
      },
    );
    watchedSidebarFolder = folderPath;
    // The open file may now be covered by this (recursive) watcher — drop the
    // dedicated one if so to avoid duplicate events.
    refreshOpenFileWatcher();
  } catch {
    // Watching may fail on some filesystems
  }
}

function stopFolderWatcher() {
  if (folderWatcher) {
    folderWatcher.close();
    folderWatcher = null;
  }
  watchedSidebarFolder = null;
  // The open file lost recursive coverage — (re)start the dedicated watcher.
  refreshOpenFileWatcher();
}

function wrapHtmlWithStyles(bodyHtml: string, title: string): string {
  // Convert pennivo-file:// protocol URLs to file:// for standalone HTML
  let html = bodyHtml.replace(/pennivo-file:\/\/\//g, "file:///");
  // Override dark-mode fill colors in mermaid SVG <style> blocks for light export background
  html = html.replace(
    /(<style>[^<]*?{[^}]*?)fill:#[Ee][0-9A-Fa-f]{5};/g,
    "$1fill:#1A1A18;",
  );
  // Fix bare domain hrefs — add https:// if no protocol
  html = html.replace(/href="([^"]+)"/g, (match, href) => {
    if (
      /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) ||
      href.startsWith("#") ||
      href.startsWith("/") ||
      href.startsWith("./") ||
      href.startsWith("../")
    ) {
      return match;
    }
    return `href="https://${href}"`;
  });
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: file:; font-src data:;">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="generator" content="Pennivo">
<style>
:root {
  --font-editor: "Georgia", "Times New Roman", serif;
  --font-mono: "Cascadia Code", "Fira Code", "Consolas", monospace;
  --font-ui: "Segoe UI", system-ui, sans-serif;
  --text-base: 17px;
  --bg: #FAFAF8;
  --bg-surface: #F2F0EC;
  --bg-overlay: #ECEAE5;
  --text-primary: #1A1A18;
  --text-muted: #7A7872;
  --text-faint: #AEACA6;
  --accent: #4A7C59;
  --border-mid: rgba(0,0,0,0.13);
  --radius-sm: 4px;
  --radius-md: 6px;
  --sh-keyword: #7C5EB0;
  --sh-string: #8A6B3D;
  --sh-number: #B06040;
  --sh-comment: #9E9B93;
  --sh-function: #3D7A8A;
  --sh-type: #4A7C59;
  --sh-attr: #7A6B2E;
  --sh-punctuation: #8A8880;
  --sh-meta: #8A6B8A;
  --sh-tag: #6B5038;
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--font-editor);
  font-size: var(--text-base);
  line-height: 1.78;
  color: var(--text-primary);
  background: var(--bg);
  max-width: 680px;
  margin: 0 auto;
  padding: 56px 24px;
  -webkit-font-smoothing: antialiased;
}
p { margin-bottom: 18px; }
h1 { font-size: 32px; font-weight: 700; line-height: 1.25; margin-bottom: 28px; letter-spacing: -0.3px; }
h2 { font-size: 20px; font-weight: 600; line-height: 1.35; margin-top: 36px; margin-bottom: 14px; }
h3 { font-size: 17px; font-weight: 600; margin-top: 28px; margin-bottom: 10px; }
h4, h5, h6 { font-size: var(--text-base); font-weight: 600; margin-top: 20px; margin-bottom: 8px; }
strong { font-weight: 700; }
em { font-style: italic; }
s { text-decoration: line-through; color: var(--text-muted); }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
code {
  font-family: var(--font-mono);
  font-size: 0.88em;
  background: var(--bg-overlay);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  color: var(--accent);
}
pre {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin: 20px 0;
  overflow-x: auto;
}
pre code {
  font-size: 13.5px;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-primary);
  border-radius: 0;
}
pre[data-language]::after {
  content: attr(data-language);
  position: absolute;
  top: 6px; right: 10px;
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-faint);
}
pre[data-language=""]::after { content: none; }
blockquote {
  border-left: 3px solid var(--accent);
  margin: 24px 0;
  padding: 4px 0 4px 20px;
}
blockquote p { color: var(--text-muted); font-style: italic; margin-bottom: 0; }
ul, ol { margin: 0 0 18px 0; padding-left: 28px; }
li { margin-bottom: 5px; line-height: 1.78; }
li[data-checked] {
  list-style: none;
  position: relative;
  margin-left: -28px;
  padding-left: 28px;
}
li[data-checked]::before {
  content: '';
  position: absolute;
  left: 0; top: 7px;
  width: 16px; height: 16px;
  border: 1.5px solid var(--border-mid);
  border-radius: 3px;
}
li[data-checked="true"]::before {
  background: var(--accent);
  border-color: var(--accent);
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 16 16' fill='none' stroke='%23fff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' xmlns='http://www.w3.org/2000/svg'%3E%3Cpolyline points='3.5,8.5 6.5,11.5 12.5,5'/%3E%3C/svg%3E");
  background-size: 12px;
  background-position: center;
  background-repeat: no-repeat;
}
li[data-checked="true"] > * { text-decoration: line-through; color: var(--text-faint); }
table { border-collapse: collapse; width: 100%; margin: 20px 0; font-size: 15px; }
th, td { border: 1px solid var(--border-mid); padding: 8px 14px; text-align: left; }
th {
  background: var(--bg-surface);
  font-weight: 600;
  font-size: 13px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
hr { border: none; border-top: 1px solid var(--border-mid); margin: 32px 0; }
img { max-width: 100%; border-radius: var(--radius-md); margin: 12px 0; }
.hljs-keyword, .hljs-selector-tag { color: var(--sh-keyword); }
.hljs-string, .hljs-template-tag, .hljs-template-variable { color: var(--sh-string); }
.hljs-number, .hljs-literal { color: var(--sh-number); }
.hljs-comment, .hljs-doctag { color: var(--sh-comment); font-style: italic; }
.hljs-title.function_, .hljs-title.class_ { color: var(--sh-function); }
.hljs-type, .hljs-built_in { color: var(--sh-type); }
.hljs-attr, .hljs-attribute, .hljs-selector-class, .hljs-selector-id { color: var(--sh-attr); }
.hljs-variable, .hljs-params { color: var(--text-primary); }
.hljs-punctuation, .hljs-operator { color: var(--sh-punctuation); }
.hljs-meta, .hljs-meta .hljs-keyword { color: var(--sh-meta); }
.hljs-name, .hljs-tag { color: var(--sh-tag); }
.hljs-regexp { color: var(--sh-string); }
svg text, svg tspan { fill: var(--text-primary); }
svg .tick text, svg .tick tspan { fill: var(--text-muted); }
svg .nodeLabel, svg .edgeLabel, svg foreignObject div, svg foreignObject span, svg foreignObject p {
  color: var(--text-primary) !important;
  fill: var(--text-primary) !important;
}
@media print {
  body { max-width: none; padding: 0; background: white; }
}
@page { margin: 1in 0.75in; }
</style>
</head>
<body>
<article>${html}</article>
</body>
</html>`;
}

function createWindow() {
  const savedState = readWindowState();
  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: savedState.width,
    height: savedState.height,
    minWidth: 600,
    minHeight: 400,
    title: "Pennivo",
    icon: path.join(__dirname, "../../resources/icon.png"),
    frame: false,
    backgroundColor: "#FAFAF8",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  };

  // Restore position if it's on a visible screen
  if (savedState.x !== undefined && savedState.y !== undefined) {
    if (isPositionOnScreen(savedState.x, savedState.y)) {
      windowOptions.x = savedState.x;
      windowOptions.y = savedState.y;
    }
  }

  mainWindow = new BrowserWindow(windowOptions);

  if (savedState.maximized) {
    mainWindow.maximize();
  }

  // Prevent Electron from navigating when files are dragged onto the window
  mainWindow.webContents.on("will-navigate", (e) => {
    e.preventDefault();
  });

  mainWindow.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      const levels = ["verbose", "info", "warning", "error"];
      console.log(
        `[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`,
      );
    },
  );

  // Set default spellchecker languages
  mainWindow.webContents.session.setSpellCheckerLanguages(["en-US"]);

  // Right-click context menu — see `buildContextMenu` in @pennivo/core for
  // the menu-spec logic; this block just adapts each spec item to an
  // Electron MenuItem and wires the click handlers.
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const wc = mainWindow?.webContents;
    if (!wc) return;
    const spec = buildContextMenu({
      isEditable: params.isEditable,
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      linkURL: params.linkURL,
      mediaType: params.mediaType,
      srcURL: params.srcURL,
      editFlags: {
        canCut: params.editFlags.canCut,
        canCopy: params.editFlags.canCopy,
        canPaste: params.editFlags.canPaste,
        canSelectAll: params.editFlags.canSelectAll,
      },
    });
    if (spec.length === 0) return;

    const menuItems: Electron.MenuItemConstructorOptions[] = spec.map(
      (item) => {
        switch (item.kind) {
          case "separator":
            return { type: "separator" };
          case "suggestion":
            return {
              label: item.label,
              click: () => wc.replaceMisspelling(item.word),
            };
          case "addToDictionary":
            return {
              label: item.label,
              click: () =>
                wc.session.addWordToSpellCheckerDictionary(item.word),
            };
          case "openLink":
            return {
              label: item.label,
              click: () => shell.openExternal(item.url),
            };
          case "copyLink":
          case "copyImageAddress":
            return {
              label: item.label,
              click: () => clipboard.writeText(item.url),
            };
          case "cut":
            return { role: "cut", enabled: item.enabled };
          case "copy":
            return { role: "copy", enabled: item.enabled };
          case "paste":
            // Custom Paste — send to renderer so ProseMirror's handlePaste
            // fires and clipboard images go through the image-paste pipeline.
            // The native paste role would bypass the DOM paste event entirely.
            return {
              label: item.label,
              enabled: item.enabled,
              click: () => wc.send("menu:paste"),
            };
          case "selectAll":
            return { role: "selectAll", enabled: item.enabled };
        }
      },
    );
    Menu.buildFromTemplate(menuItems).popup();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  // Save window state before close
  mainWindow.on("close", async (e) => {
    saveWindowState();
    if (forceClose || !isDirty) return;

    e.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved Changes",
      message: "You have unsaved changes. Do you want to save before closing?",
    });

    if (response === 0) {
      mainWindow!.webContents.send("menu:save-and-close");
    } else if (response === 1) {
      forceClose = true;
      mainWindow!.close();
    }
  });

  // Handle renderer crash — reload so draft recovery can kick in
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[main] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog
        .showMessageBox(mainWindow, {
          type: "error",
          title: "Renderer Crashed",
          message:
            "The editor crashed unexpectedly. Reloading now — any unsaved drafts will be recovered.",
          buttons: ["Reload"],
        })
        .then(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.reload();
          }
        });
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "New File",
          accelerator: "CmdOrCtrl+N",
          click: () => mainWindow?.webContents.send("menu:new-file"),
        },
        {
          label: "Open\u2026",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow?.webContents.send("menu:open"),
        },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => mainWindow?.webContents.send("menu:save"),
        },
        {
          label: "Save As\u2026",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => mainWindow?.webContents.send("menu:save-as"),
        },
        { type: "separator" },
        {
          label: "History\u2026",
          accelerator: "CmdOrCtrl+Alt+H",
          click: () => mainWindow?.webContents.send("menu:open-history"),
        },
        { type: "separator" },
        {
          label: "Export as HTML",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => mainWindow?.webContents.send("menu:export-html"),
        },
        {
          label: "Export as PDF",
          click: () => mainWindow?.webContents.send("menu:export-pdf"),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        {
          label: "Paste",
          accelerator: "CmdOrCtrl+V",
          click: () => {
            // Use document.execCommand('paste') via the renderer so ProseMirror's
            // handlePaste fires and can intercept clipboard images.
            // The built-in { role: 'paste' } bypasses the DOM paste event entirely.
            mainWindow?.webContents.send("menu:paste");
          },
        },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Focus Mode",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => mainWindow?.webContents.send("menu:toggle-focus-mode"),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Fire-and-log snapshot scheduler. Runs after the user-visible save IPC has
 * already returned — `setImmediate` defers to the next tick so the renderer
 * gets its `true` / file-path response without waiting on the snapshot
 * write. Errors are logged but never propagated.
 */
function scheduleSnapshotWrite(
  absolutePath: string,
  content: string,
  author: "user" | "external" | "mcp" | "inline-ai" | "sync",
  agentName?: string,
): void {
  setImmediate(async () => {
    try {
      const settings = readSettingsWithRecovery().recovery;
      const device = await getDeviceRecord(app.getPath("userData"));
      await writeSnapshot({
        absolutePath,
        content,
        author,
        agentName,
        settings,
        deviceId: device.deviceId,
        deviceName: deviceNameFromSettings(settings),
      });
    } catch (err) {
      console.error("[main] scheduled snapshot write failed:", err);
    }
  });
}

function registerIpcHandlers() {
  // Window controls
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on("window:close", () => mainWindow?.close());

  // Fullscreen (for focus mode)
  ipcMain.on("window:set-fullscreen", (_e, flag: boolean) => {
    mainWindow?.setFullScreen(flag);
  });
  ipcMain.handle(
    "window:is-fullscreen",
    () => mainWindow?.isFullScreen() ?? false,
  );

  // Edit commands (paste needs native Electron support)
  ipcMain.on("edit:paste", () => mainWindow?.webContents.paste());

  // Zoom
  ipcMain.on("window:zoom-in", () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = wc.zoomLevel + 0.5;
  });
  ipcMain.on("window:zoom-out", () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = wc.zoomLevel - 0.5;
  });
  ipcMain.on("window:zoom-reset", () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = 0;
  });

  // Open external URL in default browser
  ipcMain.on("shell:open-external", (_e, url: string) => {
    if (
      typeof url === "string" &&
      (url.startsWith("https://") || url.startsWith("http://"))
    ) {
      shell.openExternal(url);
    }
  });

  // Dirty state tracking (renderer tells main)
  ipcMain.on("file:set-dirty", (_e, dirty: boolean) => {
    isDirty = dirty;
  });

  // After renderer saves, it signals to force-close
  ipcMain.on("file:close-after-save", () => {
    forceClose = true;
    mainWindow?.close();
  });

  // Open file dialog + read
  ipcMain.handle("file:open", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        { name: "Markdown", extensions: ["md", "markdown", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (canceled || filePaths.length === 0) return null;

    try {
      const filePath = filePaths[0];
      const stat = await fs.stat(filePath);
      const fileSize = stat.size;
      let content = await fs.readFile(filePath, "utf-8");
      await addRecentFile(filePath);
      // Self-heal: if file was renamed/edited outside Pennivo and its asset
      // folders / content references are out of sync, normalize them.
      let healed = false;
      try {
        const result = await normalizeAssetsForFile(filePath);
        if (result.healed) {
          healed = true;
          if (result.newContent !== undefined) content = result.newContent;
        }
      } catch (err) {
        console.error("[file:open] normalizeAssetsForFile failed:", err);
      }
      // External-change reconciliation — fire-and-log; never blocks the open.
      void reconcileOnOpen(filePath, content).catch((err) => {
        console.error("[file:open] reconcileOnOpen failed:", err);
      });
      return { filePath, content, fileSize, healed };
    } catch {
      return null;
    }
  });

  // Save to existing path
  ipcMain.handle(
    "file:save",
    async (_e, args: { filePath: string; content: string }) => {
      // Record before the write so a watcher event racing ahead of the
      // snapshot still recognizes this as our own write (no reload flicker).
      recordSelfWrite(args.filePath, args.content);
      await fs.writeFile(args.filePath, args.content, "utf-8");
      // Fire-and-log snapshot capture — runs after IPC returns. Don't await.
      scheduleSnapshotWrite(args.filePath, args.content, "user");
      return true;
    },
  );

  // Save As dialog + write
  ipcMain.handle(
    "file:save-as",
    async (_e, args: { content: string; defaultPath?: string }) => {
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] },
        ],
        defaultPath: args.defaultPath || "untitled.md",
      });

      if (canceled || !filePath) return null;

      recordSelfWrite(filePath, args.content);
      await fs.writeFile(filePath, args.content, "utf-8");
      await addRecentFile(filePath);
      scheduleSnapshotWrite(filePath, args.content, "user");
      return filePath;
    },
  );

  // Build the per-file images folder name: "mynotes-md-images" for "mynotes.md"
  function imagesDirName(filePath: string): string {
    const base = path.basename(filePath); // e.g. "mynotes.md"
    return base.replace(/\./g, "-") + "-images"; // "mynotes-md-images"
  }

  // Find every "*-md-images/" asset folder that should travel with this .md
  // file when it moves. Combines two sources:
  //   1. The convention name derived from the current basename (catches the
  //      case where the file content doesn't reference its assets).
  //   2. Asset folders actually referenced inside the markdown content
  //      (catches the rename case — file is "renamed.md" but content still
  //      has links into "notes-md-images/", which is the real folder name).
  // Returns only folders that actually exist on disk in the file's directory.
  async function findAssetFoldersForFile(filePath: string): Promise<string[]> {
    const dir = path.dirname(filePath);
    const candidates = new Set<string>();
    candidates.add(imagesDirName(filePath));

    try {
      const content = await fs.readFile(filePath, "utf-8");
      // The convention's `*-md-images/` suffix is specific enough that false
      // positives are unlikely. Captures the folder-name segment.
      const re = /([A-Za-z0-9._-]+-md-images)\//g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        candidates.add(match[1]);
      }
    } catch {
      // File unreadable — convention candidate alone has to do
    }

    const existing: string[] = [];
    for (const name of candidates) {
      try {
        await fs.access(path.join(dir, name));
        existing.push(name);
      } catch {
        // Not on disk — nothing to move
      }
    }
    return existing;
  }

  // Bring this .md file's asset folders into a coherent "one file → one folder
  // (named per convention)" state. Used by:
  //   - sidebar:rename-file, AFTER fs.rename(oldPath, newPath): consolidates
  //     accumulated mismatched folders (notes-md-images, mid-md-images,
  //     final-md-images) into the new convention name and rewrites content.
  //   - file:open / file:open-path: heals files that were renamed or
  //     hand-edited outside Pennivo and arrived in a fragmented state.
  //
  // Algorithm:
  //   1. Read content; find every `*-md-images/` reference inside it.
  //   2. List actual `*-md-images/` folders next to the file on disk.
  //   3. Pick the canonical folder name = imagesDirName(filePath) (current basename).
  //   4. Rename or merge any other (related) asset folders into the canonical one.
  //   5. Rewrite every non-canonical reference inside content to the canonical name.
  //   6. Write content back if it changed.
  //
  // "Related" = the folder is either content-referenced or already named with
  // the canonical pattern. Folders matching `*-md-images/` that are unrelated
  // to this file (no references, different stem) are left alone.
  async function normalizeAssetsForFile(filePath: string): Promise<{
    healed: boolean;
    newContent?: string;
  }> {
    const dir = path.dirname(filePath);
    const desiredFolder = imagesDirName(filePath);
    const desiredFolderPath = path.join(dir, desiredFolder);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return { healed: false };
    }

    let onDisk: string[];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      onDisk = entries
        .filter((e) => e.isDirectory() && e.name.endsWith("-md-images"))
        .map((e) => e.name);
    } catch {
      return { healed: false };
    }

    // The planner expects literal-space folder names everywhere — that's
    // how on-disk names look. Saved markdown uses `%20` for portability,
    // so decode URLs before planning. We re-encode the rewritten content
    // before writing it back below.
    const decodedContent = decodeImageUrlSpaces(content);
    const plan = planNormalize({
      content: decodedContent,
      onDiskFolders: onDisk,
      desiredFolder,
    });
    if (!plan.changed) return { healed: false };

    // Execute promote (rename, with copy+rm fallback for Windows EBUSY).
    let promoteFailed = false;
    if (plan.promote) {
      const promotedSrc = path.join(dir, plan.promote.from);
      const promotedDst = path.join(dir, plan.promote.to);
      try {
        await fs.rename(promotedSrc, promotedDst);
      } catch (err) {
        console.warn(
          `[normalizeAssets] rename ${plan.promote.from} → ${plan.promote.to} failed (${(err as NodeJS.ErrnoException).code}), falling back to copy+rm`,
        );
        try {
          await fs.cp(promotedSrc, promotedDst, {
            recursive: true,
            errorOnExist: false,
            force: true,
          });
          try {
            await fs.rm(promotedSrc, { recursive: true, force: true });
          } catch (rmErr) {
            console.error(
              `[normalizeAssets] rm of ${plan.promote.from} after copy fallback failed (folder may still be locked):`,
              rmErr,
            );
          }
        } catch (cpErr) {
          console.error(
            `[normalizeAssets] copy fallback for ${plan.promote.from} → ${plan.promote.to} also failed:`,
            cpErr,
          );
          promoteFailed = true;
        }
      }
    }

    // Execute merges (file by file, conflict-safe).
    for (const folderName of plan.mergeFrom) {
      const srcFolder = path.join(dir, folderName);
      let items: string[];
      try {
        items = await fs.readdir(srcFolder);
      } catch {
        continue;
      }
      for (const item of items) {
        const srcItem = path.join(srcFolder, item);
        const destItem = path.join(desiredFolderPath, item);
        try {
          await fs.access(destItem);
          console.warn(
            `[normalizeAssets] ${item} already in ${desiredFolder}; left ${folderName}/${item} in place`,
          );
        } catch {
          try {
            await fs.rename(srcItem, destItem);
          } catch (err) {
            console.error(
              `[normalizeAssets] move ${folderName}/${item} failed:`,
              err,
            );
          }
        }
      }
      try {
        await fs.rmdir(srcFolder);
      } catch {
        // Not empty (had conflicts) — leave it.
      }
    }

    // Re-encode before comparing/writing — file on disk is %20-encoded.
    const newContentEncoded = encodeImageUrlSpaces(plan.newContent);

    // If content actually changed, verify against the post-op disk state
    // before writing. We only abort on NEWLY broken refs — refs that were
    // valid before and aren't anymore. Pre-existing broken refs (left over
    // from earlier corruption or files the user copy-pasted in) are
    // preserved as-is; we don't second-guess them, and they shouldn't
    // block a legitimate rewrite of a different ref. Without this nuance,
    // a single stale ref in the file would block every rename after it.
    if (newContentEncoded !== content) {
      let finalOnDisk: Set<string>;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        finalOnDisk = new Set(
          entries
            .filter((e) => e.isDirectory() && e.name.endsWith("-md-images"))
            .map((e) => e.name),
        );
      } catch {
        return { healed: false };
      }
      const onDiskBefore = new Set(onDisk);
      // Use the decoded form for both checks so folder-name comparisons line
      // up with on-disk literal-space names.
      const referencedBefore = extractReferencedFolders(decodedContent);
      const preExistingBroken = new Set<string>();
      for (const ref of referencedBefore) {
        if (!onDiskBefore.has(ref)) preExistingBroken.add(ref);
      }
      const referencedAfter = extractReferencedFolders(plan.newContent);
      for (const ref of referencedAfter) {
        if (!finalOnDisk.has(ref) && !preExistingBroken.has(ref)) {
          console.error(
            `[normalizeAssets] aborting rewrite — would NEWLY break ref "${ref}" (promoteFailed=${promoteFailed})`,
          );
          return { healed: false };
        }
      }
      try {
        // Record before writing so the watcher doesn't mistake Pennivo's own
        // asset-coherence rewrite for an external change and live-reload it.
        recordSelfWrite(filePath, newContentEncoded);
        await fs.writeFile(filePath, newContentEncoded, "utf-8");
      } catch (err) {
        console.error("[normalizeAssets] writeFile failed:", err);
        return { healed: false };
      }
      return { healed: true, newContent: newContentEncoded };
    }
    return { healed: true, newContent: content };
  }

  // Phase 11f: rewrite cross-document relative links/refs after a file MOVE or
  // RENAME so every OTHER document that pointed at the moved file, and the moved
  // file's own outbound links, stay correct workspace-wide.
  //
  // Sequence (mirrored by both the rename and move handlers):
  //   1. Caller snapshots the pre-move markdown set + computes old/newPath.
  //   2. Caller performs the fs move/rename (file + asset folders) as today.
  //   3. For RENAME, the caller runs normalizeAssetsForFile FIRST so the moved
  //      file's `*-md-images` sidecar is promoted to its canonical name and its
  //      sidecar image refs are rewritten; it then passes that normalized
  //      content in as `movedFileNormalizedContent`. We patch the moved file's
  //      snapshot entry with it BEFORE planning, so the pure planner sees the
  //      already-canonical sidecar refs (which it leaves untouched) and only
  //      recomputes inter-document/outbound links. This is how the two passes
  //      compose without clobbering: normalizeAssets owns the sidecar, the
  //      planner owns inter-doc links, and feeding the planner the normalized
  //      content keeps them from fighting over the moved file.
  //   4. We run the pure planner, then apply each write behind a safety
  //      re-scan (skip files that no longer exist) and record each as a
  //      self-write so live-reload does not flicker.
  //   5. We push a live-reload to the currently-open file when its content
  //      changed on disk (reconcileOnOpen emits the external-change event). The
  //      moved file's own reload is left to the renderer, as before Phase 11f.
  //
  // `prePlanSnapshot` is the list of all markdown docs (POSIX-relative to
  // `rootAbs`) captured BEFORE the fs op. `movedFileNewAbs` is the moved file's
  // post-move absolute path. Returns the set of absolute paths written (POSIX,
  // lowercased) so the caller can tell whether the moved file was rewritten.
  async function rewriteCrossDocumentLinks(args: {
    rootAbs: string;
    prePlanSnapshot: { path: string; content: string }[];
    oldRelPosix: string;
    newRelPosix: string;
    isDirectory: boolean;
    movedFileNewAbs: string;
    // When set, the moved file's content AFTER normalizeAssetsForFile ran. We
    // patch the snapshot with it so the planner does not re-touch the sidecar.
    movedFileNormalizedContent?: string;
  }): Promise<{ writtenKeys: Set<string> }> {
    const {
      rootAbs,
      prePlanSnapshot,
      oldRelPosix,
      newRelPosix,
      isDirectory,
      movedFileNewAbs,
      movedFileNormalizedContent,
    } = args;

    // Patch the moved file's snapshot entry (keyed by its PRE-move path) with
    // the post-normalizeAssets content so the planner plans outbound links from
    // the canonical-sidecar content and leaves the sidecar refs alone.
    const snapshot =
      movedFileNormalizedContent === undefined
        ? prePlanSnapshot
        : prePlanSnapshot.map((f) =>
            f.path === oldRelPosix
              ? { path: f.path, content: movedFileNormalizedContent }
              : f,
          );

    let writtenKeys = new Set<string>();
    try {
      const result = await applyLinkRewrite({
        rootAbs,
        files: snapshot,
        oldPath: oldRelPosix,
        newPath: newRelPosix,
        isDirectory,
        recordSelfWrite,
      });
      if (result.error) {
        console.error(
          `[link-rewrite] planner refused ${oldRelPosix} -> ${newRelPosix}: ${result.error}`,
        );
        return { writtenKeys };
      }
      writtenKeys = result.writtenKeys;
    } catch (err) {
      console.error("[link-rewrite] applyLinkRewrite failed:", err);
      return { writtenKeys };
    }

    // Push a live-reload to the open file if its on-disk content changed. The
    // moved file's own reload is handled by the caller after normalizeAssets.
    const movedKey = toPosix(movedFileNewAbs).toLowerCase();
    if (currentOpenPath) {
      const openKey = normPathKey(currentOpenPath);
      if (writtenKeys.has(openKey) && openKey !== movedKey) {
        try {
          const fresh = await fs.readFile(currentOpenPath, "utf-8");
          await reconcileOnOpen(currentOpenPath, fresh);
        } catch (err) {
          console.error(
            "[link-rewrite] open-file reload after rewrite failed:",
            err,
          );
        }
      }
    }

    return { writtenKeys };
  }

  // Save image to per-file images subfolder next to the current .md file
  ipcMain.handle(
    "file:save-image",
    async (
      _e,
      args: { filePath: string; buffer: number[]; mimeType: string },
    ) => {
      const dir = path.dirname(args.filePath);
      const imgFolder = imagesDirName(args.filePath);
      const imagesDir = path.join(dir, imgFolder);
      await fs.mkdir(imagesDir, { recursive: true });

      const ext = args.mimeType === "image/jpeg" ? "jpg" : "png";
      const now = new Date();
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        "-",
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0"),
      ].join("");
      const filename = `paste-${stamp}.${ext}`;

      const absolutePath = path.join(imagesDir, filename);
      await fs.writeFile(absolutePath, Buffer.from(args.buffer));
      return {
        relativePath: `./${imgFolder}/${filename}`,
        absolutePath: absolutePath.replace(/\\/g, "/"),
      };
    },
  );

  // Pick an image via file dialog, copy it to per-file images subfolder, return paths
  ipcMain.handle("file:pick-image", async (_e, args: { filePath: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    });

    if (canceled || filePaths.length === 0) return null;

    const srcPath = filePaths[0];
    const ext = path.extname(srcPath).toLowerCase() || ".png";
    const dir = path.dirname(args.filePath);
    const imgFolder = imagesDirName(args.filePath);
    const imagesDir = path.join(dir, imgFolder);
    await fs.mkdir(imagesDir, { recursive: true });

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
      "-",
      String(now.getHours()).padStart(2, "0"),
      String(now.getMinutes()).padStart(2, "0"),
      String(now.getSeconds()).padStart(2, "0"),
    ].join("");
    const filename = `image-${stamp}${ext}`;
    const absolutePath = path.join(imagesDir, filename);

    await fs.copyFile(srcPath, absolutePath);
    return {
      relativePath: `./${imgFolder}/${filename}`,
      absolutePath: absolutePath.replace(/\\/g, "/"),
    };
  });

  // --- Recent files ---
  ipcMain.handle("recent-files:get", async () => {
    return readRecentFiles();
  });

  ipcMain.handle("recent-files:add", async (_e, filePath: string) => {
    return addRecentFile(filePath);
  });

  ipcMain.handle("recent-files:clear", async () => {
    await clearRecentFiles();
    return [];
  });

  // Open a specific file by path (used by Recent Files)
  ipcMain.handle("file:open-path", async (_e, filePath: string) => {
    try {
      const stat = await fs.stat(filePath);
      const fileSize = stat.size;
      let content = await fs.readFile(filePath, "utf-8");
      await addRecentFile(filePath);
      let healed = false;
      try {
        const result = await normalizeAssetsForFile(filePath);
        if (result.healed) {
          healed = true;
          if (result.newContent !== undefined) content = result.newContent;
        }
      } catch (err) {
        console.error("[file:open-path] normalizeAssetsForFile failed:", err);
      }
      void reconcileOnOpen(filePath, content).catch((err) => {
        console.error("[file:open-path] reconcileOnOpen failed:", err);
      });
      return { filePath, content, fileSize, healed };
    } catch {
      return null;
    }
  });

  // Confirm-discard dialog (used before opening a file when dirty)
  ipcMain.handle("file:confirm-discard", async () => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: "warning",
      buttons: ["Save", "Don't Save", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      title: "Unsaved Changes",
      message: "You have unsaved changes. Do you want to save them first?",
    });
    // 0 = save, 1 = discard, 2 = cancel
    return response;
  });

  // Window title (for taskbar)
  ipcMain.on("window:set-title", (_e, title: string) => {
    if (mainWindow) mainWindow.setTitle(title);
  });

  // --- Export ---
  ipcMain.handle(
    "export:html",
    async (_e, args: { html: string; title: string }) => {
      const styledHtml = wrapHtmlWithStyles(args.html, args.title);
      const defaultName = args.title.replace(/\.md$/i, "") + ".html";
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        filters: [
          { name: "HTML", extensions: ["html"] },
          { name: "All Files", extensions: ["*"] },
        ],
        defaultPath: defaultName,
      });
      if (canceled || !filePath) return null;
      await fs.writeFile(filePath, styledHtml, "utf-8");
      return filePath;
    },
  );

  // --- Sidebar ---
  // Compatibility shim (Phase 2): resolve the active workspace's root path,
  // falling back to the legacy `sidebar-folder.json` when no workspace is
  // active. Existing callers see the same single-folder behavior as before.
  ipcMain.handle("sidebar:get-folder", async () => {
    const { workspaces } = await readWorkspacesState();
    const activeRoot = activeWorkspaceRoot(workspaces);
    if (activeRoot) return activeRoot;
    return readSidebarFolder();
  });

  // --- Global search (Phase 2: IPC plumbing, dormant until the UI lands) ---
  // Walk every markdown document under the active workspace root and run the
  // pure `searchFiles` matcher against them. The handler resolves the root the
  // same way `sidebar:get-folder` does (active workspace, then legacy folder),
  // never walks the fs for trivially-short queries, and skips oversized files
  // so a single giant document cannot dominate a search. It never throws across
  // the IPC boundary: any failure returns the empty result shape.
  ipcMain.handle(
    "workspace:search",
    async (
      _e,
      query: string,
      options?: SearchOptions,
    ): Promise<SearchResults> => {
      const trimmed = (query ?? "").trim();
      const empty: SearchResults = {
        query: trimmed,
        files: [],
        totalMatches: 0,
        capped: false,
      };
      // Fewer than 2 non-space characters is not worth a full-tree walk.
      if (trimmed.length < 2) return empty;
      try {
        const { workspaces } = await readWorkspacesState();
        const root =
          activeWorkspaceRoot(workspaces) ?? (await readSidebarFolder());
        if (!root) return empty;
        const files = await enumerateMarkdownFiles(root);
        // File-size guard: skip documents above the threshold (measured in
        // UTF-8 bytes) so one outsized file cannot dominate the search.
        const within = files.filter(
          (f) => Buffer.byteLength(f.content, "utf-8") <= SEARCH_MAX_FILE_BYTES,
        );
        return searchFiles(trimmed, within, options);
      } catch (err) {
        console.error("[workspace:search] search failed:", err);
        return empty;
      }
    },
  );

  // Renderer reports its currently-open file so the watcher can live-reload it
  // (Phase 12d-pre). `null` when no document is open.
  ipcMain.handle("watch:set-open-file", async (_e, filePath: string | null) => {
    setCurrentOpenFile(filePath);
  });

  ipcMain.handle(
    "sidebar:set-folder",
    async (_e, folderPath: string | null) => {
      // Keep the legacy file in sync so a downgrade still finds the folder.
      await writeSidebarFolder(folderPath);
      // Phase 2 shim: mirror the change into the active workspace's rootPath
      // (or add a workspace when there is none) so the two surfaces agree.
      const { settings, workspaces } = await readWorkspacesState();
      const next = applySidebarFolderToWorkspaces(workspaces, folderPath);
      await writeSettings({ ...settings, workspaces: next });
      if (folderPath) {
        startFolderWatcher(folderPath);
      } else {
        stopFolderWatcher();
      }
    },
  );

  ipcMain.handle("sidebar:choose-folder", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
      title: "Choose Folder",
    });
    if (canceled || filePaths.length === 0) return null;
    const folderPath = filePaths[0];
    await writeSidebarFolder(folderPath);
    startFolderWatcher(folderPath);
    return folderPath;
  });

  ipcMain.handle(
    "sidebar:read-directory",
    async (_e, folderPath: string, showEmptyFolders?: boolean) => {
      // `showEmptyFolders` is a global display pref (settings.json, default
      // true). The renderer passes its current value with each refresh; when it
      // omits the flag (e.g. an older caller) we fall back to the stored
      // setting, defaulting to true so empty folders show.
      const flag =
        typeof showEmptyFolders === "boolean"
          ? showEmptyFolders
          : readSettings().showEmptyFolders !== false;
      return readDirectoryTree(folderPath, flag);
    },
  );

  // --- Workspaces (Phase 2) ---
  // State lives in settings.json under `workspaces`, migrated lazily from the
  // legacy sidebar folder. These handlers mirror the `sidebar:*` naming and
  // error-handling style. None of them ever touch folder contents on disk.

  // Return the current migrated state without persisting (read-only).
  ipcMain.handle("workspaces:get", async (): Promise<WorkspacesState> => {
    const { workspaces } = await readWorkspacesState();
    return workspaces;
  });

  // Switch the active workspace, persist, and move the folder watcher to the
  // newly-active root. A null/unknown id deactivates and stops the watcher.
  ipcMain.handle(
    "workspaces:set-active",
    async (_e, id: string | null): Promise<WorkspacesState> => {
      const { settings, workspaces } = await readWorkspacesState();
      const target = workspaces.workspaces.find((w) => w.id === id) ?? null;
      const next: WorkspacesState = {
        ...workspaces,
        activeWorkspaceId: target ? target.id : null,
      };
      await writeSettings({ ...settings, workspaces: next });
      // Keep the legacy file aligned so a downgrade reopens the same folder.
      await writeSidebarFolder(target ? target.rootPath : null);
      if (target) {
        startFolderWatcher(target.rootPath);
      } else {
        stopFolderWatcher();
      }
      return next;
    },
  );

  // Record a chosen folder as a new workspace. The picker dialog itself stays
  // in `sidebar:choose-folder`; this handler just appends the path.
  ipcMain.handle(
    "workspaces:add",
    async (_e, rootPath: string, name?: string): Promise<WorkspacesState> => {
      const { settings, workspaces } = await readWorkspacesState();
      const id = randomUUID();
      const workspace: Workspace = {
        id,
        name: name && name.length > 0 ? name : workspaceNameFromPath(rootPath),
        rootPath,
      };
      const next: WorkspacesState = {
        workspaces: [...workspaces.workspaces, workspace],
        activeWorkspaceId: workspaces.activeWorkspaceId,
        prefs: { ...workspaces.prefs, [id]: defaultWorkspacePrefs() },
      };
      await writeSettings({ ...settings, workspaces: next });
      return next;
    },
  );

  // Remove a workspace entry and its prefs. Fixes the active id if it pointed
  // at the removed workspace (first remaining, else null). NEVER deletes any
  // files on disk; only the bookkeeping entry goes away.
  ipcMain.handle(
    "workspaces:remove",
    async (_e, id: string): Promise<WorkspacesState> => {
      const { settings, workspaces } = await readWorkspacesState();
      const remaining = workspaces.workspaces.filter((w) => w.id !== id);
      const prefs = { ...workspaces.prefs };
      delete prefs[id];
      let activeWorkspaceId = workspaces.activeWorkspaceId;
      if (activeWorkspaceId === id) {
        activeWorkspaceId = remaining.length > 0 ? remaining[0].id : null;
      }
      const next: WorkspacesState = {
        workspaces: remaining,
        activeWorkspaceId,
        prefs,
      };
      await writeSettings({ ...settings, workspaces: next });
      return next;
    },
  );

  // Merge per-workspace preferences for one workspace id and persist.
  ipcMain.handle(
    "workspaces:set-prefs",
    async (
      _e,
      id: string,
      prefs: Partial<WorkspacePrefs>,
    ): Promise<WorkspacesState> => {
      const { settings, workspaces } = await readWorkspacesState();
      const existing = workspaces.prefs[id] ?? defaultWorkspacePrefs();
      const merged: WorkspacePrefs = { ...existing, ...prefs };
      const next: WorkspacesState = {
        ...workspaces,
        prefs: { ...workspaces.prefs, [id]: merged },
      };
      await writeSettings({ ...settings, workspaces: next });
      return next;
    },
  );

  // --- Sidebar file operations ---
  ipcMain.handle("sidebar:show-in-folder", async (_e, filePath: string) => {
    try {
      shell.showItemInFolder(filePath);
      return true;
    } catch (err) {
      console.error("[sidebar:show-in-folder] failed:", err);
      return false;
    }
  });

  // Quick lookup used by the delete-confirm dialog: returns the names of the
  // asset folders this file owns (content-referenced or convention-named) and
  // a total count of files inside them.
  ipcMain.handle(
    "sidebar:get-asset-summary",
    async (
      _e,
      filePath: string,
    ): Promise<{ folders: string[]; assetCount: number }> => {
      try {
        const dir = path.dirname(filePath);
        const folders = await findAssetFoldersForFile(filePath);
        let assetCount = 0;
        for (const folder of folders) {
          try {
            const entries = await fs.readdir(path.join(dir, folder));
            assetCount += entries.length;
          } catch {
            // Folder vanished between findAssetFoldersForFile and now — skip
          }
        }
        return { folders, assetCount };
      } catch (err) {
        console.error("[sidebar:get-asset-summary] failed:", err);
        return { folders: [], assetCount: 0 };
      }
    },
  );

  ipcMain.handle(
    "sidebar:delete-file",
    async (_e, filePath: string, includeAssets: boolean = false) => {
      // Phase 13a soft-delete: move to trash instead of `fs.unlink`. The
      // renderer keeps the same call signature; we just route through the
      // trash store.
      try {
        // Discover asset folders BEFORE moving — once the .md is in trash,
        // findAssetFoldersForFile can't read its content to find references.
        let assetFolderNames: string[] = [];
        if (includeAssets) {
          try {
            assetFolderNames = await findAssetFoldersForFile(filePath);
          } catch (err) {
            console.error(
              "[sidebar:delete-file] failed to discover assets:",
              err,
            );
          }
        }
        const settings = readSettingsWithRecovery().recovery;
        const device = await getDeviceRecord(app.getPath("userData"));
        await moveToTrash({
          absolutePath: filePath,
          includeAssets,
          assetFolderNames,
          settings,
          deviceId: device.deviceId,
          deviceName: deviceNameFromSettings(settings),
        });
        return true;
      } catch (err) {
        console.error("[sidebar:delete-file] failed:", err);
        return false;
      }
    },
  );

  // Hard-delete bypass — used by the future "Delete permanently" right-click
  // option. Same shape as `sidebar:delete-file` but skips the trash. This is
  // the old `fs.unlink` code path preserved verbatim so users / tests can
  // request a true hard-delete when they need it.
  ipcMain.handle(
    "sidebar:delete-permanently",
    async (_e, filePath: string, includeAssets: boolean = false) => {
      try {
        let foldersToDelete: string[] = [];
        if (includeAssets) {
          try {
            foldersToDelete = await findAssetFoldersForFile(filePath);
          } catch (err) {
            console.error(
              "[sidebar:delete-permanently] failed to discover assets:",
              err,
            );
          }
        }
        await fs.unlink(filePath);
        if (includeAssets && foldersToDelete.length > 0) {
          const dir = path.dirname(filePath);
          for (const folder of foldersToDelete) {
            try {
              await fs.rm(path.join(dir, folder), {
                recursive: true,
                force: true,
              });
            } catch (err) {
              console.error(
                `[sidebar:delete-permanently] failed to remove asset folder ${folder}:`,
                err,
              );
            }
          }
        }
        return true;
      } catch (err) {
        console.error("[sidebar:delete-permanently] failed:", err);
        return false;
      }
    },
  );

  ipcMain.handle(
    "sidebar:move-file",
    async (
      _e,
      srcPath: string,
      destDir: string,
      overwrite: boolean,
    ): Promise<{
      ok: boolean;
      newPath?: string;
      reason?: "collision" | "error";
    }> => {
      try {
        const filename = path.basename(srcPath);
        const newPath = path.join(destDir, filename);
        // No-op if already in target dir
        if (path.resolve(newPath) === path.resolve(srcPath)) {
          return { ok: true, newPath: srcPath.replace(/\\/g, "/") };
        }

        // Phase 11f: derive directory-ness from a stat. A directory move is a
        // recursive move of the whole subtree (the per-file `*-md-images/`
        // asset folders inside it come along automatically as children); a file
        // move additionally relocates its sibling asset folders.
        let isDirectory = false;
        try {
          isDirectory = (await fs.stat(srcPath)).isDirectory();
        } catch {
          // Stat failure is non-fatal — treat as a file.
        }

        // Server-side guard (defense in depth): never attempt an illegal
        // directory move. Dropping a folder into itself or into one of its own
        // descendants would either fail at the fs layer or corrupt the tree;
        // the client guards this too, and the planner refuses the link rewrite,
        // but the fs op must never run. (`newPath === srcPath` is handled above
        // as a success no-op.)
        if (isDirectory) {
          const resolvedSrc = path.resolve(srcPath);
          const resolvedNew = path.resolve(newPath);
          const srcWithSep = resolvedSrc.endsWith(path.sep)
            ? resolvedSrc
            : resolvedSrc + path.sep;
          if (
            resolvedNew === resolvedSrc ||
            resolvedNew.startsWith(srcWithSep)
          ) {
            return { ok: false, reason: "error" };
          }
        }

        const srcDir = path.dirname(srcPath);

        // Asset folders are only relocated separately for a FILE move. For a
        // directory move they live INSIDE the moved tree, so the recursive move
        // carries them automatically.
        const assetFolderNames = isDirectory
          ? []
          : await findAssetFoldersForFile(srcPath);

        // Collision check on the primary destination (file or folder).
        let destExists = false;
        try {
          await fs.access(newPath);
          destExists = true;
        } catch {
          // ENOENT — destination is free
        }

        // Collision check: any of the asset folders already at destination?
        const collidingAssetFolders: string[] = [];
        for (const name of assetFolderNames) {
          try {
            await fs.access(path.join(destDir, name));
            collidingAssetFolders.push(name);
          } catch {
            // Not at destination — no collision for this folder
          }
        }

        if (destExists || collidingAssetFolders.length > 0) {
          if (!overwrite) return { ok: false, reason: "collision" };
          // Replace: remove ONLY the specific destination path (and any
          // colliding asset folders for a file move). `fs.rm` with recursive
          // handles both a file and a directory destination.
          if (destExists) {
            await fs.rm(newPath, { recursive: true, force: true });
          }
          for (const name of collidingAssetFolders) {
            await fs.rm(path.join(destDir, name), {
              recursive: true,
              force: true,
            });
          }
        }

        // Phase 11f: snapshot the markdown set + compute workspace-relative
        // old/new POSIX paths BEFORE moving, so the pure planner sees the
        // pre-move world. For a directory, oldRelPosix/newRelPosix are the
        // FOLDER paths, so planLinkRewrite rewrites links to every file inside
        // the moved subtree.
        const rewritePrep = await prepareLinkRewrite(srcPath, newPath);

        // Recursive-safe move: try rename first (atomic, same-volume). Fall
        // back to copy + remove when rename fails with EXDEV (cross-device),
        // which can happen for a directory spanning mount points.
        await moveEntry(srcPath, newPath);

        // File move only: relocate each sibling asset folder. (Directory moves
        // already carried their inner asset folders via the recursive move.)
        for (const name of assetFolderNames) {
          try {
            await moveEntry(path.join(srcDir, name), path.join(destDir, name));
          } catch (imgErr) {
            // Best-effort: the .md file is at its new location. If an asset
            // folder failed to move (rare — usually disk/permission), log and
            // continue. Relative image links inside the .md will break and the
            // user can manually move the folder. Surfacing as an error here
            // would suggest the move failed, which is misleading.
            console.error(
              `[sidebar:move-file] asset folder "${name}" move failed:`,
              imgErr,
            );
          }
        }

        // Cross-document rewrite (writes the moved entity's outbound links and
        // every other referrer). A plain move does not change the basename, so
        // the moved file's asset-folder references already line up with the
        // folders we relocated above; unlike rename, move historically does
        // NOT run normalizeAssetsForFile (it would promote a legacy-named
        // sidecar and is intentionally left alone on a move), so we keep that
        // behavior and only do the inter-document link rewrite here.
        if (rewritePrep) {
          await rewriteCrossDocumentLinks({
            rootAbs: rewritePrep.rootAbs,
            prePlanSnapshot: rewritePrep.snapshot,
            oldRelPosix: rewritePrep.oldRelPosix,
            newRelPosix: rewritePrep.newRelPosix,
            isDirectory,
            movedFileNewAbs: newPath,
          });
        }

        return { ok: true, newPath: newPath.replace(/\\/g, "/") };
      } catch (err) {
        console.error("[sidebar:move-file] failed:", err);
        return { ok: false, reason: "error" };
      }
    },
  );

  ipcMain.handle(
    "sidebar:rename-file",
    async (_e, oldPath: string, newName: string) => {
      // Collision-safe rename: refuse if the destination already exists.
      // newName is just the filename (no path); preserve the directory.
      try {
        if (
          newName.includes("/") ||
          newName.includes("\\") ||
          newName.includes("\0") ||
          newName.trim() === ""
        ) {
          return null;
        }
        const dir = path.dirname(oldPath);
        const newPath = path.join(dir, newName);
        if (newPath === oldPath) return oldPath;
        try {
          await fs.access(newPath);
          // File exists — refuse rather than overwrite
          return null;
        } catch {
          // ENOENT — destination is free, proceed
        }

        // Phase 11f: snapshot the markdown set + compute workspace-relative
        // old/new POSIX paths BEFORE the rename, so the pure planner sees the
        // pre-move world (the correct basis for link targets). isDirectory is
        // false here; a directory's `isDirectory` would be taken from a stat.
        const isDirectory = false;
        const rewritePrep = await prepareLinkRewrite(oldPath, newPath);

        await fs.rename(oldPath, newPath);

        // After rename, normalize asset folders FIRST so the renamed file's
        // images live in the new convention-named folder and the file's own
        // sidecar references are rewritten to match. We capture the resulting
        // content and feed it to the cross-document rewrite below, so the pure
        // planner sees canonical sidecar refs (and leaves them alone) and only
        // recomputes inter-document/outbound links. This is the composition
        // that keeps the two passes from clobbering each other on the moved
        // file. Best-effort: any normalize error does not undo the rename.
        let movedFileNormalizedContent: string | undefined;
        try {
          const norm = await normalizeAssetsForFile(newPath);
          if (norm.healed && norm.newContent !== undefined) {
            // normalizeAssets writes %20-encoded content to disk; the planner
            // decodes/encodes internally, so handing it the on-disk (encoded)
            // content is consistent with how it treats every other file.
            movedFileNormalizedContent = norm.newContent;
          }
        } catch (err) {
          console.error(
            "[sidebar:rename-file] normalizeAssetsForFile failed:",
            err,
          );
        }

        // Cross-document rewrite: every OTHER referrer to the renamed file, plus
        // the renamed file's own outbound inter-doc links. The sidecar refs are
        // already canonical (handled above) and left untouched by the planner.
        if (rewritePrep) {
          // If normalizeAssets did not change the moved file, fall back to its
          // current on-disk content so the planner's snapshot patch is accurate.
          if (movedFileNormalizedContent === undefined) {
            try {
              movedFileNormalizedContent = await fs.readFile(newPath, "utf-8");
            } catch {
              // Unreadable — let the planner use the pre-move snapshot as-is.
            }
          }
          await rewriteCrossDocumentLinks({
            rootAbs: rewritePrep.rootAbs,
            prePlanSnapshot: rewritePrep.snapshot,
            oldRelPosix: rewritePrep.oldRelPosix,
            newRelPosix: rewritePrep.newRelPosix,
            isDirectory,
            movedFileNewAbs: newPath,
            movedFileNormalizedContent,
          });
        }

        return newPath.replace(/\\/g, "/");
      } catch (err) {
        console.error("[sidebar:rename-file] failed:", err);
        return null;
      }
    },
  );

  // --- New File / New Folder from the sidebar (Phase 11f) ---
  // Both validate the bare name the same way `sidebar:rename-file` does (no path
  // separators, no NUL, non-empty) plus the OS-reserved characters. On a name
  // collision in the parent directory we auto-suffix " 2", " 3", ... rather than
  // reject, for a smooth create UX. Created paths come back normalized with
  // forward slashes; failures return null.

  // Reject path separators, NUL, and the characters Windows forbids in a file
  // name. Mirrors the rename validation, extended for cross-platform safety.
  const isInvalidEntryName = (name: string): boolean => {
    const trimmed = name.trim();
    if (trimmed === "") return true;
    if (
      trimmed.includes("/") ||
      trimmed.includes("\\") ||
      trimmed.includes("\0")
    ) {
      return true;
    }
    // OS-reserved characters (Windows is the strictest superset) plus any
    // control character. Spaces and hyphens are valid and stay allowed.
    const reserved = ["<", ">", ":", '"', "|", "?", "*"];
    if (reserved.some((ch) => trimmed.includes(ch))) return true;
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed.charCodeAt(i) < 0x20) return true;
    }
    return false;
  };

  // Resolve a collision-free path inside `dir` for `base` + `ext` ("" for
  // folders). Tries "base", then "base 2", "base 3", ... until one is free.
  const resolveFreePath = async (
    dir: string,
    base: string,
    ext: string,
  ): Promise<string> => {
    let candidate = path.join(dir, `${base}${ext}`);
    let counter = 2;
    // Bounded loop: a few thousand iterations is far beyond any real workspace.
    for (;;) {
      try {
        await fs.access(candidate);
        // Exists — try the next suffix.
        candidate = path.join(dir, `${base} ${counter}${ext}`);
        counter += 1;
      } catch {
        // ENOENT — this candidate is free.
        return candidate;
      }
    }
  };

  ipcMain.handle(
    "sidebar:create-file",
    async (_e, parentDir: string, name: string) => {
      try {
        if (isInvalidEntryName(name)) return null;
        const trimmed = name.trim();
        // Auto-append `.md` when the name has no extension. A trailing dot or a
        // leading-dot-only name (e.g. ".gitignore") counts as "no real stem
        // extension" → still append so the user always lands on a markdown file.
        const dotIdx = trimmed.lastIndexOf(".");
        const hasExtension = dotIdx > 0 && dotIdx < trimmed.length - 1;
        const base = hasExtension ? trimmed.slice(0, dotIdx) : trimmed;
        const finalExt = hasExtension ? trimmed.slice(dotIdx) : ".md";
        const newPath = await resolveFreePath(parentDir, base, finalExt);
        await fs.writeFile(newPath, "");
        return newPath.replace(/\\/g, "/");
      } catch (err) {
        console.error("[sidebar:create-file] failed:", err);
        return null;
      }
    },
  );

  ipcMain.handle(
    "sidebar:create-folder",
    async (_e, parentDir: string, name: string) => {
      try {
        if (isInvalidEntryName(name)) return null;
        const trimmed = name.trim();
        const newPath = await resolveFreePath(parentDir, trimmed, "");
        await fs.mkdir(newPath);
        return newPath.replace(/\\/g, "/");
      } catch (err) {
        console.error("[sidebar:create-folder] failed:", err);
        return null;
      }
    },
  );

  // --- Toolbar config ---
  ipcMain.handle("toolbar-config:get", async () => {
    return readToolbarConfig();
  });

  ipcMain.handle("toolbar-config:set", async (_e, actions: string[]) => {
    await writeToolbarConfig(actions);
  });

  // --- Spellcheck ---
  ipcMain.handle("spellcheck:get-languages", () => {
    return mainWindow?.webContents.session.getSpellCheckerLanguages() ?? [];
  });

  ipcMain.handle("spellcheck:get-available-languages", () => {
    return mainWindow?.webContents.session.availableSpellCheckerLanguages ?? [];
  });

  ipcMain.handle("spellcheck:set-languages", (_e, languages: string[]) => {
    mainWindow?.webContents.session.setSpellCheckerLanguages(languages);
  });

  ipcMain.handle("spellcheck:add-word", (_e, word: string) => {
    mainWindow?.webContents.session.addWordToSpellCheckerDictionary(word);
  });

  // --- Settings ---
  ipcMain.handle("settings:get", async () => {
    // Always migrate the recovery section so the renderer sees a fully
    // populated shape (matches the pure defaults in @pennivo/core).
    const raw = readSettings();
    const recovery = migrateRecoverySettings(raw.recovery);
    // Phase 2: lazily migrate the workspaces slice from the legacy
    // sidebar-folder.json + global sort/timestamp keys. Read-only: we attach
    // the resolved state but do not persist here (no write during a read).
    const legacyFolder = await readSidebarFolder();
    const workspaces = migrateWorkspaces(
      raw as Record<string, unknown>,
      legacyFolder,
      () => randomUUID(),
    );
    return { ...raw, recovery, workspaces };
  });

  ipcMain.handle("settings:set", async (_e, incoming: AppSettings) => {
    // The `workspaces` slice is owned SOLELY by the `workspaces:*` handlers (and
    // the `sidebar:set-folder` shim). settings:set carries a whole settings
    // object echoed back from the renderer, which may hold a STALE `workspaces`
    // snapshot read before a concurrent workspaces:add / set-prefs / set-active.
    // Writing that snapshot verbatim would silently revert the workspace
    // mutation, so we strip it here and re-merge the FRESH on-disk slice inside
    // the serialized write chain (no read-modify-write gap).
    const rest: AppSettings = { ...incoming };
    delete rest.workspaces;

    // Detect first-time archive folder pick → apply daily-and-older
    // archive routing defaults (without overriding any user-set tier).
    const previous = readSettingsWithRecovery();
    const prevArchive = previous.recovery.archiveFolder;
    let nextRecovery: RecoverySettings | undefined;
    if (incoming.recovery) {
      nextRecovery = migrateRecoverySettings(incoming.recovery);
      const justAddedArchive =
        !prevArchive &&
        nextRecovery.archiveFolder &&
        nextRecovery.archiveFolder.length > 0;
      if (justAddedArchive) {
        nextRecovery = {
          ...nextRecovery,
          tierDestinations: applyArchiveDefaults(nextRecovery),
        };
      }
    }
    await mutateSettings((current) => ({
      ...rest,
      recovery: nextRecovery ?? previous.recovery,
      // Preserve whatever the workspaces:* handlers last wrote to disk.
      workspaces: current.workspaces,
    }));
    await refreshSnapshotEnvironment();
  });

  // --- MCP server (Phase 12a) ---
  // The MCP server itself runs in a separate `pennivo --mcp` process spawned by
  // the client; these handlers serve the Settings → MCP panel in the main app:
  // reading the cross-process audit log and the "Connect to Claude" flow.

  ipcMain.handle("mcp:get-audit", (_e, limit: number = 100) => {
    try {
      const raw = readFileSync(
        path.join(app.getPath("userData"), "mcp-audit.jsonl"),
        "utf-8",
      );
      const lines = raw.split("\n").filter((l) => l.length > 0);
      const tail = lines.slice(-Math.max(0, limit));
      const events: unknown[] = [];
      for (const line of tail) {
        try {
          events.push(JSON.parse(line));
        } catch {
          // Skip a malformed line.
        }
      }
      return events.reverse(); // newest first
    } catch {
      return [];
    }
  });

  ipcMain.handle("mcp:detect-claude", () => detectClaudeForMcp());

  ipcMain.handle("mcp:write-claude-config", () => writeClaudeMcpConfig());

  ipcMain.handle("mcp:copy-config-snippet", () => copyMcpConfigSnippet());

  // --- Snapshot recovery (Phase 13a) ---

  ipcMain.handle("snapshot:list", async (_e, absolutePath: string) => {
    return listSnapshots(absolutePath);
  });

  ipcMain.handle(
    "snapshot:read",
    async (_e, absolutePath: string, snapshotId: string) => {
      return readSnapshot(absolutePath, snapshotId);
    },
  );

  ipcMain.handle(
    "snapshot:restore",
    async (
      _e,
      args: {
        absolutePath: string;
        snapshotId: string;
        mode: "overwrite" | "as-new-file";
        targetPath?: string;
      },
    ) => {
      return restoreSnapshot(args.absolutePath, {
        snapshotId: args.snapshotId,
        mode: args.mode,
        targetPath: args.targetPath,
      });
    },
  );

  ipcMain.handle("snapshot:get-cap-status", () => {
    return getLastCapWarning();
  });

  // Renderer-driven probe — called on mount so the titlebar chip reflects
  // current archive reachability even if the renderer wasn't subscribed
  // when the boot-time refresh fired.
  ipcMain.handle("snapshot:probe-archive-status", async () => {
    await probeArchiveStatus();
    return true;
  });

  // --- Compare & merge save handler ---
  //
  // Compare & merge produces a new merged document. `overwrite` writes back
  // to the original file path; we take a pre-restore snapshot of the current
  // on-disk content first (tagged with `mergedFrom: { left, right }` so the
  // user can see in History which two versions were combined). `as-new-file`
  // writes alongside the original as `<name> (merged YYYY-MM-DD).md`, with
  // a counter on collision.
  ipcMain.handle(
    "snapshot:save-merged",
    async (
      _e,
      args: {
        filePath: string;
        content: string;
        mode: "overwrite" | "as-new-file";
        left: string | null;
        right: string | null;
      },
    ) => {
      try {
        const settings = readSettingsWithRecovery().recovery;
        const device = await getDeviceRecord(app.getPath("userData"));
        const deviceName = deviceNameFromSettings(settings);

        if (args.mode === "overwrite") {
          // Pre-restore snapshot of the current on-disk content so the
          // merge is reversible. Tag the meta with mergedFrom hints.
          let current = "";
          try {
            current = await fs.readFile(args.filePath, "utf-8");
          } catch {
            current = "";
          }
          if (current.length > 0) {
            await writeSnapshot({
              absolutePath: args.filePath,
              content: current,
              author: "user",
              settings,
              deviceId: device.deviceId,
              deviceName,
              // Reuse `restoredFrom` to record the merge lineage. This keeps
              // the on-disk meta shape stable; the field already documents
              // "this snapshot is the pre-state for a recovery action."
              restoredFrom: `merged:${args.left ?? "current"}+${args.right ?? "current"}`,
            });
          }
          recordSelfWrite(args.filePath, args.content);
          await fs.writeFile(args.filePath, args.content, "utf-8");
          // Snapshot the merged result too — just like a normal save would.
          scheduleSnapshotWrite(args.filePath, args.content, "user");
          return { savedPath: args.filePath.replace(/\\/g, "/") };
        }

        // as-new-file: derive a sibling path with the merge date.
        const dir = path.dirname(args.filePath);
        const ext = path.extname(args.filePath) || ".md";
        const stem = path.basename(args.filePath, ext);
        const dateStr = new Date().toISOString().slice(0, 10);
        let target = path.join(dir, `${stem} (merged ${dateStr})${ext}`);
        let counter = 1;
        // Collision walk: append " 2", " 3", etc.
        while (true) {
          try {
            await fs.access(target);
            counter += 1;
            target = path.join(
              dir,
              `${stem} (merged ${dateStr} ${counter})${ext}`,
            );
            if (counter > 50) break;
          } catch {
            break;
          }
        }
        await fs.writeFile(target, args.content, "utf-8");
        scheduleSnapshotWrite(target, args.content, "user");
        return { savedPath: target.replace(/\\/g, "/") };
      } catch (err) {
        console.error("[snapshot:save-merged] failed:", err);
        return null;
      }
    },
  );

  // --- Trash (Phase 13a soft-delete) ---

  ipcMain.handle("trash:list", async () => {
    return listTrash();
  });

  ipcMain.handle("trash:restore", async (_e, trashId: string) => {
    try {
      return await restoreFromTrash(trashId);
    } catch (err) {
      console.error("[trash:restore] failed:", err);
      return null;
    }
  });

  ipcMain.handle("trash:permanently-delete", async (_e, trashId: string) => {
    try {
      await permanentlyDeleteTrashEntry(trashId);
      return true;
    } catch (err) {
      console.error("[trash:permanently-delete] failed:", err);
      return false;
    }
  });

  ipcMain.handle("trash:sweep", async () => {
    try {
      return await sweepExpiredTrash();
    } catch (err) {
      console.error("[trash:sweep] failed:", err);
      return { removedCount: 0 };
    }
  });

  ipcMain.handle("trash:read", async (_e, trashId: string) => {
    try {
      const content = await readTrashContent(trashId);
      return content === null ? null : { content };
    } catch (err) {
      console.error("[trash:read] failed:", err);
      return null;
    }
  });

  // --- Snapshot folder helpers (Phase 13a Settings → Recovery) ---

  ipcMain.handle("snapshot:get-storage-usage", async () => {
    try {
      const root = path.join(app.getPath("userData"), "snapshots");
      const bytes = await sumDirectoryBytes(root);
      return { bytes };
    } catch (err) {
      console.error("[snapshot:get-storage-usage] failed:", err);
      return { bytes: 0 };
    }
  });

  ipcMain.handle("snapshot:open-folder", async () => {
    try {
      const root = path.join(app.getPath("userData"), "snapshots");
      await fs.mkdir(root, { recursive: true });
      await shell.openPath(root);
      return true;
    } catch (err) {
      console.error("[snapshot:open-folder] failed:", err);
      return false;
    }
  });

  ipcMain.handle("snapshot:clear-all", async () => {
    try {
      const root = path.join(app.getPath("userData"), "snapshots");
      await fs.rm(root, { recursive: true, force: true });
      return true;
    } catch (err) {
      console.error("[snapshot:clear-all] failed:", err);
      return false;
    }
  });

  // Folder picker for the Settings → Recovery archive folder. Reuses the
  // sidebar's open-directory pattern but doesn't persist anything itself —
  // the renderer hands the chosen path back into `settings:set`.
  ipcMain.handle("dialog:open-folder", async () => {
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose Folder",
    });
    if (canceled || filePaths.length === 0) return null;
    return filePaths[0];
  });

  // --- App info ---
  ipcMain.handle("app:get-info", () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
    };
  });

  // Pulled by the renderer on mount to pick up a file passed via OS launch
  // (e.g. double-clicking a .md in Explorer). One-shot — clears after read.
  ipcMain.handle("app:get-pending-file", () => {
    const p = pendingFilePath;
    pendingFilePath = null;
    return p;
  });

  ipcMain.handle(
    "export:pdf",
    async (_e, args: { html: string; title: string }) => {
      const styledHtml = wrapHtmlWithStyles(args.html, args.title);
      const defaultName = args.title.replace(/\.md$/i, "") + ".pdf";

      // Write to temp file so the hidden window can load it
      const tempPath = path.join(
        app.getPath("temp"),
        `pennivo-export-${Date.now()}.html`,
      );
      await fs.writeFile(tempPath, styledHtml, "utf-8");

      const pdfWindow = new BrowserWindow({
        show: false,
        width: 800,
        height: 600,
        webPreferences: {
          offscreen: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      try {
        await pdfWindow.loadFile(tempPath);
        const pdfBuffer = await pdfWindow.webContents.printToPDF({
          pageSize: "A4",
          printBackground: true,
        });
        pdfWindow.destroy();
        await fs.unlink(tempPath).catch(() => {});

        const { canceled, filePath } = await dialog.showSaveDialog(
          mainWindow!,
          {
            filters: [
              { name: "PDF", extensions: ["pdf"] },
              { name: "All Files", extensions: ["*"] },
            ],
            defaultPath: defaultName,
          },
        );
        if (canceled || !filePath) return null;
        await fs.writeFile(filePath, pdfBuffer);
        return filePath;
      } catch (err) {
        pdfWindow.destroy();
        await fs.unlink(tempPath).catch(() => {});
        throw err;
      }
    },
  );
}

// Register custom protocol to serve local image files in the editor.
// file:// URLs are blocked when the page is served from http://localhost (dev mode).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pennivo-file",
    privileges: { standard: false, supportFetchAPI: true, stream: true },
  },
]);

app.whenReady().then(() => {
  // Handle pennivo-file:// protocol — serves local files by absolute path
  protocol.handle("pennivo-file", (request) => {
    // URL format: pennivo-file:///C:/path/to/image.png
    const filePath = decodeURIComponent(
      request.url.replace("pennivo-file:///", ""),
    );
    return net.fetch(pathToFileURL(filePath).href);
  });

  // --- Content Security Policy ---
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const csp = [
    "default-src 'none'",
    isDev
      ? "script-src 'self' 'unsafe-inline'" // Vite HMR injects inline module scripts
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // ProseMirror + Mermaid SVG inline styles
    "img-src 'self' data: pennivo-file: file:",
    "font-src 'self' data:",
    isDev
      ? "connect-src 'self' ws:" // Vite HMR WebSocket
      : "connect-src 'self' pennivo-file:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  registerIpcHandlers();
  createMenu();
  createWindow();
  // Wire the snapshot store to the active window so it can emit
  // recovery events to the renderer.
  setSnapshotMainWindow(mainWindow);
  setTrashMainWindow(mainWindow);

  // Initialize device identity + push the recovery settings into the
  // snapshot writer's cache. Best-effort: any failure is logged. The cache
  // is also refreshed whenever the renderer pushes a settings update.
  refreshSnapshotEnvironment().catch((err) => {
    console.error("[main] refreshSnapshotEnvironment failed:", err);
  });

  // MCP host control bridge: a loopback HTTP endpoint the spawned MCP server
  // calls to reach the snapshot/trash stores (which live only in this process).
  // Wrapped so a bridge failure can NEVER abort app startup — the history tools
  // simply degrade to "app not running" if it doesn't come up.
  try {
    startMcpHostBridge();
  } catch (err) {
    console.error("[main] failed to start MCP host bridge:", err);
  }

  // Trash sweep: prune expired entries on launch (fire-and-log; never blocks
  // the window) and schedule a daily sweep for long-running sessions.
  sweepExpiredTrash()
    .then((r) => {
      if (r.removedCount > 0) {
        console.log(
          `[main] trash sweep removed ${r.removedCount} expired entries`,
        );
      }
    })
    .catch((err) => {
      console.error("[main] initial trash sweep failed:", err);
    });
  setInterval(
    () => {
      sweepExpiredTrash().catch((err) => {
        console.error("[main] periodic trash sweep failed:", err);
      });
    },
    24 * 60 * 60 * 1000,
  );

  // Restore folder watcher for sidebar if one was persisted
  readSidebarFolder().then((folder) => {
    if (folder) startFolderWatcher(folder);
  });

  // --- Auto-update (production only) ---
  // Skipped in dev so VITE_DEV_SERVER_URL runs are unaffected. Errors are
  // logged but never surfaced as dialogs — network failures and missing
  // releases are common and must fail silently.
  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.on("update-downloaded", (info) => {
      mainWindow?.webContents.send("update:available", info.version);
    });
    autoUpdater.on("error", (err) => {
      console.error("[autoUpdater]", err);
    });

    ipcMain.on("update:install", () => {
      autoUpdater.quitAndInstall();
    });

    autoUpdater.checkForUpdates();
    setInterval(
      () => {
        autoUpdater.checkForUpdates();
      },
      24 * 60 * 60 * 1000,
    );
  }
});

app.on("before-quit", () => {
  // Tear down the loopback control bridge and remove its descriptor so a
  // standalone server spawned after we exit finds no stale bridge.
  try {
    stopMcpHostBridge();
  } catch (err) {
    console.error("[main] failed to stop MCP host bridge:", err);
  }
});

app.on("window-all-closed", () => {
  // Clear the open-file tracking first so stopFolderWatcher() doesn't resurrect
  // the dedicated open-file watcher on a now-closed document (macOS keeps the
  // app resident, so a dangling watcher would otherwise accumulate per cycle).
  setCurrentOpenFile(null);
  stopFolderWatcher();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
