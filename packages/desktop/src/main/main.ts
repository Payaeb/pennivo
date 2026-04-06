import { app, BrowserWindow, ipcMain, dialog, Menu, net, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let forceClose = false;

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

function wrapHtmlWithStyles(bodyHtml: string, title: string): string {
  // Convert pennivo-file:// protocol URLs to file:// for standalone HTML
  let html = bodyHtml.replace(/pennivo-file:\/\/\//g, 'file:///');
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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 600,
    minHeight: 400,
    title: 'Pennivo',
    frame: false,
    backgroundColor: '#FAFAF8',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Prevent Electron from navigating when files are dragged onto the window
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault();
  });

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('close', async (e) => {
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
          accelerator: 'CmdOrCtrl+Shift+P',
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

    const filePath = filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    await addRecentFile(filePath);
    return { filePath, content };
  });

  // Save to existing path
  ipcMain.handle('file:save', async (_e, args: { filePath: string; content: string }) => {
    await fs.writeFile(args.filePath, args.content, 'utf-8');
    return true;
  });

  // Save As dialog + write
  ipcMain.handle('file:save-as', async (_e, args: { content: string }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      defaultPath: 'untitled.md',
    });

    if (canceled || !filePath) return null;

    await fs.writeFile(filePath, args.content, 'utf-8');
    await addRecentFile(filePath);
    return filePath;
  });

  // Save image to images/ subfolder next to the current .md file
  ipcMain.handle('file:save-image', async (_e, args: { filePath: string; buffer: number[]; mimeType: string }) => {
    const dir = path.dirname(args.filePath);
    const imagesDir = path.join(dir, 'images');
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
      relativePath: `./images/${filename}`,
      absolutePath: absolutePath.replace(/\\/g, '/'),
    };
  });

  // Pick an image via file dialog, copy it to images/ subfolder, return paths
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
    const imagesDir = path.join(dir, 'images');
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
      relativePath: `./images/${filename}`,
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
      const content = await fs.readFile(filePath, 'utf-8');
      await addRecentFile(filePath);
      return { filePath, content };
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
      webPreferences: { offscreen: true },
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

  registerIpcHandlers();
  createMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
