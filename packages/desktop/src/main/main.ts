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
  planNormalize,
  type RecoverySettings,
} from "@pennivo/core";
import path from "node:path";
import fs from "node:fs/promises";
import {
  deviceNameFromSettings,
  getDeviceRecord,
} from "./deviceIdentity";
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
import {
  readFileSync,
  writeFileSync,
  statSync,
  watch,
  type FSWatcher,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let forceClose = false;
let folderWatcher: FSWatcher | null = null;

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
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
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
   * Phase 13a recovery configuration. Always migrated through
   * `migrateRecoverySettings` on read so missing keys fill from defaults
   * without clobbering user-set values.
   */
  recovery?: RecoverySettings;
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

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(
    getSettingsPath(),
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
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

interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
  size?: number;
  mtimeMs?: number;
  lastOpenedMs?: number;
}

async function readDirectoryTree(dirPath: string): Promise<FileTreeEntry[]> {
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
      const children = await readDirectoryTree(path.join(dirPath, item.name));
      // Only include folders that contain matching files (directly or nested)
      if (children.length > 0) {
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
        const ext = path.extname(filename).toLowerCase();
        // Only notify for relevant file changes
        if (SIDEBAR_EXTENSIONS.has(ext) || ext === "") {
          mainWindow?.webContents.send("sidebar:folder-changed");
        }
      },
    );
  } catch {
    // Watching may fail on some filesystems
  }
}

function stopFolderWatcher() {
  if (folderWatcher) {
    folderWatcher.close();
    folderWatcher = null;
  }
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
        await fs.writeFile(filePath, newContentEncoded, "utf-8");
      } catch (err) {
        console.error("[normalizeAssets] writeFile failed:", err);
        return { healed: false };
      }
      return { healed: true, newContent: newContentEncoded };
    }
    return { healed: true, newContent: content };
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
  ipcMain.handle("sidebar:get-folder", async () => {
    return readSidebarFolder();
  });

  ipcMain.handle(
    "sidebar:set-folder",
    async (_e, folderPath: string | null) => {
      await writeSidebarFolder(folderPath);
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

  ipcMain.handle("sidebar:read-directory", async (_e, folderPath: string) => {
    return readDirectoryTree(folderPath);
  });

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

        // Discover asset folders to move alongside the .md. The convention is
        // "<name>-md-images/" but a renamed file's actual folder may have a
        // different name — we scan content references too.
        const srcDir = path.dirname(srcPath);
        const assetFolderNames = await findAssetFoldersForFile(srcPath);

        // Collision check: file
        let fileExists = false;
        try {
          await fs.access(newPath);
          fileExists = true;
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

        if (fileExists || collidingAssetFolders.length > 0) {
          if (!overwrite) return { ok: false, reason: "collision" };
          if (fileExists) await fs.unlink(newPath);
          for (const name of collidingAssetFolders) {
            await fs.rm(path.join(destDir, name), {
              recursive: true,
              force: true,
            });
          }
        }

        // Move the file first (the user's primary intent), then each asset folder.
        await fs.rename(srcPath, newPath);
        for (const name of assetFolderNames) {
          try {
            await fs.rename(path.join(srcDir, name), path.join(destDir, name));
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
        await fs.rename(oldPath, newPath);
        // After rename, normalize asset folders so the renamed file's images
        // live in the new convention-named folder and content references match.
        // Best-effort: any error here doesn't undo the rename.
        try {
          await normalizeAssetsForFile(newPath);
        } catch (err) {
          console.error(
            "[sidebar:rename-file] normalizeAssetsForFile failed:",
            err,
          );
        }
        return newPath.replace(/\\/g, "/");
      } catch (err) {
        console.error("[sidebar:rename-file] failed:", err);
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
  ipcMain.handle("settings:get", () => {
    // Always migrate the recovery section so the renderer sees a fully
    // populated shape (matches the pure defaults in @pennivo/core).
    const raw = readSettings();
    const recovery = migrateRecoverySettings(raw.recovery);
    return { ...raw, recovery };
  });

  ipcMain.handle("settings:set", async (_e, incoming: AppSettings) => {
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
    const merged: AppSettings = {
      ...incoming,
      recovery: nextRecovery ?? previous.recovery,
    };
    await writeSettings(merged);
    await refreshSnapshotEnvironment();
  });

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

  ipcMain.handle(
    "trash:permanently-delete",
    async (_e, trashId: string) => {
      try {
        await permanentlyDeleteTrashEntry(trashId);
        return true;
      } catch (err) {
        console.error("[trash:permanently-delete] failed:", err);
        return false;
      }
    },
  );

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

  // Trash sweep: prune expired entries on launch (fire-and-log; never blocks
  // the window) and schedule a daily sweep for long-running sessions.
  sweepExpiredTrash()
    .then((r) => {
      if (r.removedCount > 0) {
        console.log(`[main] trash sweep removed ${r.removedCount} expired entries`);
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

app.on("window-all-closed", () => {
  stopFolderWatcher();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
