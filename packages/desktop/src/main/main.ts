import { app, BrowserWindow, ipcMain, dialog, Menu, net, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let isDirty = false;
let forceClose = false;

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
