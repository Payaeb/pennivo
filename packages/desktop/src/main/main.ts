import { app, BrowserWindow, ipcMain, dialog, Menu, net, protocol, screen, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { readFileSync, writeFileSync, watch, type FSWatcher } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let forceClose = false;
let folderWatcher: FSWatcher | null = null;

// --- Window state persistence ---
interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const DEFAULT_WINDOW_STATE: WindowState = { width: 1200, height: 800, maximized: false };

function getWindowStatePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState(): WindowState {
  try {
    const data = readFileSync(getWindowStatePath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
  } catch {
    // File doesn't exist or is corrupt
  }
  return DEFAULT_WINDOW_STATE;
}

function saveWindowState(): void {
  if (!mainWindow) return;
  const bounds = mainWindow.getBounds();
  const maximized = mainWindow.isMaximized();
  const state: WindowState = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized,
  };
  writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf-8');
}

function isPositionOnScreen(x: number, y: number): boolean {
  const displays = screen.getAllDisplays();
  return displays.some((d) => {
    const { x: dx, y: dy, width, height } = d.bounds;
    return x >= dx && x < dx + width && y >= dy && y < dy + height;
  });
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
}

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings(): AppSettings {
  try {
    const data = readFileSync(getSettingsPath(), 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
}

// --- Recent files persistence ---
const RECENT_FILES_MAX = 10;

function getRecentFilesPath(): string {
  return path.join(app.getPath('userData'), 'recent-files.json');
}

async function readRecentFiles(): Promise<string[]> {
  try {
    const data = await fs.readFile(getRecentFilesPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string');
  } catch {
    // File doesn't exist or is corrupt
  }
  return [];
}

async function writeRecentFiles(files: string[]): Promise<void> {
  await fs.writeFile(getRecentFilesPath(), JSON.stringify(files), 'utf-8');
}

async function addRecentFile(filePath: string): Promise<string[]> {
  const existing = await readRecentFiles();
  // Normalize path for comparison
  const normalized = filePath.replace(/\\/g, '/');
  const filtered = existing.filter(p => p.replace(/\\/g, '/') !== normalized);
  const updated = [filePath, ...filtered].slice(0, RECENT_FILES_MAX);
  await writeRecentFiles(updated);
  return updated;
}

async function clearRecentFiles(): Promise<void> {
  await writeRecentFiles([]);
}

// --- Toolbar config persistence ---
function getToolbarConfigPath(): string {
  return path.join(app.getPath('userData'), 'toolbar-config.json');
}

async function readToolbarConfig(): Promise<string[] | null> {
  try {
    const data = await fs.readFile(getToolbarConfigPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed) && parsed.every((s): s is string => typeof s === 'string')) return parsed;
  } catch {
    // File doesn't exist or is corrupt — return null so renderer uses defaults
  }
  return null;
}

async function writeToolbarConfig(actions: string[]): Promise<void> {
  await fs.writeFile(getToolbarConfigPath(), JSON.stringify(actions), 'utf-8');
}

// --- Sidebar folder persistence ---
const SIDEBAR_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

function getSidebarFolderPath(): string {
  return path.join(app.getPath('userData'), 'sidebar-folder.json');
}

async function readSidebarFolder(): Promise<string | null> {
  try {
    const data = await fs.readFile(getSidebarFolderPath(), 'utf-8');
    const parsed = JSON.parse(data);
    if (typeof parsed === 'string') return parsed;
  } catch {
    // File doesn't exist
  }
  return null;
}

async function writeSidebarFolder(folderPath: string | null): Promise<void> {
  await fs.writeFile(getSidebarFolderPath(), JSON.stringify(folderPath), 'utf-8');
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeEntry[];
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
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  for (const item of items) {
    // Skip hidden files/folders
    if (item.name.startsWith('.')) continue;
    // Skip node_modules, etc.
    if (item.name === 'node_modules') continue;

    const fullPath = path.join(dirPath, item.name).replace(/\\/g, '/');

    if (item.isDirectory()) {
      const children = await readDirectoryTree(path.join(dirPath, item.name));
      // Only include folders that contain matching files (directly or nested)
      if (children.length > 0) {
        entries.push({ name: item.name, path: fullPath, type: 'folder', children });
      }
    } else {
      const ext = path.extname(item.name).toLowerCase();
      if (SIDEBAR_EXTENSIONS.has(ext)) {
        entries.push({ name: item.name, path: fullPath, type: 'file' });
      }
    }
  }

  return entries;
}

function startFolderWatcher(folderPath: string) {
  stopFolderWatcher();
  try {
    folderWatcher = watch(folderPath, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      // Only notify for relevant file changes
      if (SIDEBAR_EXTENSIONS.has(ext) || ext === '') {
        mainWindow?.webContents.send('sidebar:folder-changed');
      }
    });
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
  let html = bodyHtml.replace(/pennivo-file:\/\/\//g, 'file:///');
  // Override dark-mode fill colors in mermaid SVG <style> blocks for light export background
  html = html.replace(/(<style>[^<]*?{[^}]*?)fill:#[Ee][0-9A-Fa-f]{5};/g, '$1fill:#1A1A18;');
  // Fix bare domain hrefs — add https:// if no protocol
  html = html.replace(/href="([^"]+)"/g, (match, href) => {
    if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href) || href.startsWith('#') || href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      return match;
    }
    return `href="https://${href}"`;
  });
  const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    title: 'Pennivo',
    icon: path.join(__dirname, '../../resources/icon.png'),
    frame: false,
    backgroundColor: '#FAFAF8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
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
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
  });

  // Set default spellchecker languages
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);

  // Right-click context menu with spell check suggestions
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.misspelledWord) return;

    const menuItems: Electron.MenuItemConstructorOptions[] = [];

    // Add spelling suggestions
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      menuItems.push({
        label: suggestion,
        click: () => mainWindow?.webContents.replaceMisspelling(suggestion),
      });
    }

    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }

    // Add to dictionary
    menuItems.push({
      label: `Add "${params.misspelledWord}" to dictionary`,
      click: () => {
        mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
      },
    });

    const contextMenu = Menu.buildFromTemplate(menuItems);
    contextMenu.popup();
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Save window state before close
  mainWindow.on('close', async (e) => {
    saveWindowState();
    if (forceClose || !isDirty) return;

    e.preventDefault();
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Do you want to save before closing?',
    });

    if (response === 0) {
      mainWindow!.webContents.send('menu:save-and-close');
    } else if (response === 1) {
      forceClose = true;
      mainWindow!.close();
    }
  });

  // Handle renderer crash — reload so draft recovery can kick in
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Renderer process gone:', details.reason, details.exitCode);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Renderer Crashed',
        message: 'The editor crashed unexpectedly. Reloading now — any unsaved drafts will be recovered.',
        buttons: ['Reload'],
      }).then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.reload();
        }
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-file'),
        },
        {
          label: 'Open\u2026',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu:save'),
        },
        {
          label: 'Save As\u2026',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Export as HTML',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => mainWindow?.webContents.send('menu:export-html'),
        },
        {
          label: 'Export as PDF',
          click: () => mainWindow?.webContents.send('menu:export-pdf'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        {
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => {
            // Use document.execCommand('paste') via the renderer so ProseMirror's
            // handlePaste fires and can intercept clipboard images.
            // The built-in { role: 'paste' } bypasses the DOM paste event entirely.
            mainWindow?.webContents.send('menu:paste');
          },
        },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Focus Mode',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.send('menu:toggle-focus-mode'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpcHandlers() {
  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Fullscreen (for focus mode)
  ipcMain.on('window:set-fullscreen', (_e, flag: boolean) => {
    mainWindow?.setFullScreen(flag);
  });
  ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);

  // Edit commands (paste needs native Electron support)
  ipcMain.on('edit:paste', () => mainWindow?.webContents.paste());

  // Zoom
  ipcMain.on('window:zoom-in', () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = wc.zoomLevel + 0.5;
  });
  ipcMain.on('window:zoom-out', () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = wc.zoomLevel - 0.5;
  });
  ipcMain.on('window:zoom-reset', () => {
    const wc = mainWindow?.webContents;
    if (wc) wc.zoomLevel = 0;
  });

  // Open external URL in default browser
  ipcMain.on('shell:open-external', (_e, url: string) => {
    if (typeof url === 'string' && (url.startsWith('https://') || url.startsWith('http://'))) {
      shell.openExternal(url);
    }
  });

  // Dirty state tracking (renderer tells main)
  ipcMain.on('file:set-dirty', (_e, dirty: boolean) => {
    isDirty = dirty;
  });

  // After renderer saves, it signals to force-close
  ipcMain.on('file:close-after-save', () => {
    forceClose = true;
    mainWindow?.close();
  });

  // Open file dialog + read
  ipcMain.handle('file:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) return null;

    try {
      const filePath = filePaths[0];
      const stat = await fs.stat(filePath);
      const fileSize = stat.size;
      const content = await fs.readFile(filePath, 'utf-8');
      await addRecentFile(filePath);
      return { filePath, content, fileSize };
    } catch {
      return null;
    }
  });

  // Save to existing path
  ipcMain.handle('file:save', async (_e, args: { filePath: string; content: string }) => {
    await fs.writeFile(args.filePath, args.content, 'utf-8');
    return true;
  });

  // Save As dialog + write
  ipcMain.handle('file:save-as', async (_e, args: { content: string; defaultPath?: string }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      defaultPath: args.defaultPath || 'untitled.md',
    });

    if (canceled || !filePath) return null;

    await fs.writeFile(filePath, args.content, 'utf-8');
    await addRecentFile(filePath);
    return filePath;
  });

  // Build the per-file images folder name: "mynotes-md-images" for "mynotes.md"
  function imagesDirName(filePath: string): string {
    const base = path.basename(filePath); // e.g. "mynotes.md"
    return base.replace(/\./g, '-') + '-images'; // "mynotes-md-images"
  }

  // Save image to per-file images subfolder next to the current .md file
  ipcMain.handle('file:save-image', async (_e, args: { filePath: string; buffer: number[]; mimeType: string }) => {
    const dir = path.dirname(args.filePath);
    const imgFolder = imagesDirName(args.filePath);
    const imagesDir = path.join(dir, imgFolder);
    await fs.mkdir(imagesDir, { recursive: true });

    const ext = args.mimeType === 'image/jpeg' ? 'jpg' : 'png';
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const filename = `paste-${stamp}.${ext}`;

    const absolutePath = path.join(imagesDir, filename);
    await fs.writeFile(absolutePath, Buffer.from(args.buffer));
    return {
      relativePath: `./${imgFolder}/${filename}`,
      absolutePath: absolutePath.replace(/\\/g, '/'),
    };
  });

  // Pick an image via file dialog, copy it to per-file images subfolder, return paths
  ipcMain.handle('file:pick-image', async (_e, args: { filePath: string }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (canceled || filePaths.length === 0) return null;

    const srcPath = filePaths[0];
    const ext = path.extname(srcPath).toLowerCase() || '.png';
    const dir = path.dirname(args.filePath);
    const imgFolder = imagesDirName(args.filePath);
    const imagesDir = path.join(dir, imgFolder);
    await fs.mkdir(imagesDir, { recursive: true });

    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const filename = `image-${stamp}${ext}`;
    const absolutePath = path.join(imagesDir, filename);

    await fs.copyFile(srcPath, absolutePath);
    return {
      relativePath: `./${imgFolder}/${filename}`,
      absolutePath: absolutePath.replace(/\\/g, '/'),
    };
  });

  // --- Recent files ---
  ipcMain.handle('recent-files:get', async () => {
    return readRecentFiles();
  });

  ipcMain.handle('recent-files:add', async (_e, filePath: string) => {
    return addRecentFile(filePath);
  });

  ipcMain.handle('recent-files:clear', async () => {
    await clearRecentFiles();
    return [];
  });

  // Open a specific file by path (used by Recent Files)
  ipcMain.handle('file:open-path', async (_e, filePath: string) => {
    try {
      const stat = await fs.stat(filePath);
      const fileSize = stat.size;
      const content = await fs.readFile(filePath, 'utf-8');
      await addRecentFile(filePath);
      return { filePath, content, fileSize };
    } catch {
      return null;
    }
  });

  // Confirm-discard dialog (used before opening a file when dirty)
  ipcMain.handle('file:confirm-discard', async () => {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      title: 'Unsaved Changes',
      message: 'You have unsaved changes. Do you want to save them first?',
    });
    // 0 = save, 1 = discard, 2 = cancel
    return response;
  });

  // Window title (for taskbar)
  ipcMain.on('window:set-title', (_e, title: string) => {
    if (mainWindow) mainWindow.setTitle(title);
  });

  // --- Export ---
  ipcMain.handle('export:html', async (_e, args: { html: string; title: string }) => {
    const styledHtml = wrapHtmlWithStyles(args.html, args.title);
    const defaultName = args.title.replace(/\.md$/i, '') + '.html';
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      filters: [
        { name: 'HTML', extensions: ['html'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      defaultPath: defaultName,
    });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, styledHtml, 'utf-8');
    return filePath;
  });

  // --- Sidebar ---
  ipcMain.handle('sidebar:get-folder', async () => {
    return readSidebarFolder();
  });

  ipcMain.handle('sidebar:set-folder', async (_e, folderPath: string | null) => {
    await writeSidebarFolder(folderPath);
    if (folderPath) {
      startFolderWatcher(folderPath);
    } else {
      stopFolderWatcher();
    }
  });

  ipcMain.handle('sidebar:choose-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Choose Folder',
    });
    if (canceled || filePaths.length === 0) return null;
    const folderPath = filePaths[0];
    await writeSidebarFolder(folderPath);
    startFolderWatcher(folderPath);
    return folderPath;
  });

  ipcMain.handle('sidebar:read-directory', async (_e, folderPath: string) => {
    return readDirectoryTree(folderPath);
  });

  // --- Toolbar config ---
  ipcMain.handle('toolbar-config:get', async () => {
    return readToolbarConfig();
  });

  ipcMain.handle('toolbar-config:set', async (_e, actions: string[]) => {
    await writeToolbarConfig(actions);
  });

  // --- Spellcheck ---
  ipcMain.handle('spellcheck:get-languages', () => {
    return mainWindow?.webContents.session.getSpellCheckerLanguages() ?? [];
  });

  ipcMain.handle('spellcheck:get-available-languages', () => {
    return mainWindow?.webContents.session.availableSpellCheckerLanguages ?? [];
  });

  ipcMain.handle('spellcheck:set-languages', (_e, languages: string[]) => {
    mainWindow?.webContents.session.setSpellCheckerLanguages(languages);
  });

  ipcMain.handle('spellcheck:add-word', (_e, word: string) => {
    mainWindow?.webContents.session.addWordToSpellCheckerDictionary(word);
  });

  // --- Settings ---
  ipcMain.handle('settings:get', () => {
    return readSettings();
  });

  ipcMain.handle('settings:set', async (_e, settings: AppSettings) => {
    await writeSettings(settings);
  });

  // --- App info ---
  ipcMain.handle('app:get-info', () => {
    return {
      version: app.getVersion(),
      name: app.getName(),
    };
  });

  ipcMain.handle('export:pdf', async (_e, args: { html: string; title: string }) => {
    const styledHtml = wrapHtmlWithStyles(args.html, args.title);
    const defaultName = args.title.replace(/\.md$/i, '') + '.pdf';

    // Write to temp file so the hidden window can load it
    const tempPath = path.join(app.getPath('temp'), `pennivo-export-${Date.now()}.html`);
    await fs.writeFile(tempPath, styledHtml, 'utf-8');

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
        pageSize: 'A4',
        printBackground: true,
      });
      pdfWindow.destroy();
      await fs.unlink(tempPath).catch(() => {});

      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        filters: [
          { name: 'PDF', extensions: ['pdf'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        defaultPath: defaultName,
      });
      if (canceled || !filePath) return null;
      await fs.writeFile(filePath, pdfBuffer);
      return filePath;
    } catch (err) {
      pdfWindow.destroy();
      await fs.unlink(tempPath).catch(() => {});
      throw err;
    }
  });
}

// Register custom protocol to serve local image files in the editor.
// file:// URLs are blocked when the page is served from http://localhost (dev mode).
protocol.registerSchemesAsPrivileged([{
  scheme: 'pennivo-file',
  privileges: { standard: false, supportFetchAPI: true, stream: true },
}]);

app.whenReady().then(() => {
  // Handle pennivo-file:// protocol — serves local files by absolute path
  protocol.handle('pennivo-file', (request) => {
    // URL format: pennivo-file:///C:/path/to/image.png
    const filePath = decodeURIComponent(request.url.replace('pennivo-file:///', ''));
    return net.fetch(pathToFileURL(filePath).href);
  });

  // --- Content Security Policy ---
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const csp = [
    "default-src 'none'",
    isDev
      ? "script-src 'self' 'unsafe-inline'"   // Vite HMR injects inline module scripts
      : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",        // ProseMirror + Mermaid SVG inline styles
    "img-src 'self' data: pennivo-file: file:",
    "font-src 'self' data:",
    isDev
      ? "connect-src 'self' ws:"               // Vite HMR WebSocket
      : "connect-src 'self' pennivo-file:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });

  registerIpcHandlers();
  createMenu();
  createWindow();

  // Restore folder watcher for sidebar if one was persisted
  readSidebarFolder().then((folder) => {
    if (folder) startFolderWatcher(folder);
  });
});

app.on('window-all-closed', () => {
  stopFolderWatcher();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
