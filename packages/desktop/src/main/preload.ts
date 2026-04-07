import { contextBridge, ipcRenderer, webUtils } from 'electron';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeEntry[];
}

contextBridge.exposeInMainWorld('pennivo', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
  setFullScreen: (flag: boolean) => ipcRenderer.send('window:set-fullscreen', flag),
  isFullScreen:  () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  paste:         () => ipcRenderer.send('edit:paste'),
  zoomIn:        () => ipcRenderer.send('window:zoom-in'),
  zoomOut:       () => ipcRenderer.send('window:zoom-out'),
  resetZoom:     () => ipcRenderer.send('window:zoom-reset'),
  openExternal:  (url: string) => ipcRenderer.send('shell:open-external', url),

  // File I/O
  saveImage:      (filePath: string, buffer: number[], mimeType: string) => ipcRenderer.invoke('file:save-image', { filePath, buffer, mimeType }) as Promise<{ relativePath: string; absolutePath: string }>,
  pickImage:      (filePath: string) => ipcRenderer.invoke('file:pick-image', { filePath }) as Promise<{ relativePath: string; absolutePath: string } | null>,
  openFile:       () => ipcRenderer.invoke('file:open') as Promise<{ filePath: string; content: string } | null>,
  saveFile:       (filePath: string, content: string) => ipcRenderer.invoke('file:save', { filePath, content }) as Promise<boolean>,
  saveFileAs:     (content: string, defaultPath?: string) => ipcRenderer.invoke('file:save-as', { content, defaultPath }) as Promise<string | null>,
  confirmDiscard: () => ipcRenderer.invoke('file:confirm-discard') as Promise<number>,
  setDirty:       (dirty: boolean) => ipcRenderer.send('file:set-dirty', dirty),
  closeAfterSave: () => ipcRenderer.send('file:close-after-save'),

  // Recent files
  getRecentFiles:  () => ipcRenderer.invoke('recent-files:get') as Promise<string[]>,
  addRecentFile:   (filePath: string) => ipcRenderer.invoke('recent-files:add', filePath) as Promise<string[]>,
  clearRecentFiles: () => ipcRenderer.invoke('recent-files:clear') as Promise<string[]>,
  openFilePath:    (filePath: string) => ipcRenderer.invoke('file:open-path', filePath) as Promise<{ filePath: string; content: string } | null>,

  // Export
  exportHtml: (html: string, title: string) => ipcRenderer.invoke('export:html', { html, title }) as Promise<string | null>,
  exportPdf: (html: string, title: string) => ipcRenderer.invoke('export:pdf', { html, title }) as Promise<string | null>,

  // Window title
  setTitle: (title: string) => ipcRenderer.send('window:set-title', title),

  // Sidebar
  getSidebarFolder:  () => ipcRenderer.invoke('sidebar:get-folder') as Promise<string | null>,
  setSidebarFolder:  (folderPath: string | null) => ipcRenderer.invoke('sidebar:set-folder', folderPath) as Promise<void>,
  chooseSidebarFolder: () => ipcRenderer.invoke('sidebar:choose-folder') as Promise<string | null>,
  readDirectory:     (folderPath: string) => ipcRenderer.invoke('sidebar:read-directory', folderPath) as Promise<FileTreeEntry[]>,
  onSidebarFolderChanged: (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('sidebar:folder-changed', handler); return () => { ipcRenderer.removeListener('sidebar:folder-changed', handler); }; },

  // Toolbar config
  getToolbarConfig:  () => ipcRenderer.invoke('toolbar-config:get') as Promise<string[] | null>,
  setToolbarConfig:  (actions: string[]) => ipcRenderer.invoke('toolbar-config:set', actions) as Promise<void>,

  // Spellcheck
  getSpellCheckLanguages:      () => ipcRenderer.invoke('spellcheck:get-languages') as Promise<string[]>,
  getAvailableSpellLanguages:  () => ipcRenderer.invoke('spellcheck:get-available-languages') as Promise<string[]>,
  setSpellCheckLanguages:      (languages: string[]) => ipcRenderer.invoke('spellcheck:set-languages', languages) as Promise<void>,
  addWordToDictionary:         (word: string) => ipcRenderer.invoke('spellcheck:add-word', word) as Promise<void>,

  // Menu events from main process
  onMenuPaste:        (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:paste', handler); return () => { ipcRenderer.removeListener('menu:paste', handler); }; },
  onMenuOpen:         (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:open', handler); return () => { ipcRenderer.removeListener('menu:open', handler); }; },
  onMenuSave:         (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save', handler); return () => { ipcRenderer.removeListener('menu:save', handler); }; },
  onMenuSaveAs:       (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save-as', handler); return () => { ipcRenderer.removeListener('menu:save-as', handler); }; },
  onMenuSaveAndClose:     (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save-and-close', handler); return () => { ipcRenderer.removeListener('menu:save-and-close', handler); }; },
  onMenuToggleFocusMode:  (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:toggle-focus-mode', handler); return () => { ipcRenderer.removeListener('menu:toggle-focus-mode', handler); }; },
  onMenuNewFile:      (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:new-file', handler); return () => { ipcRenderer.removeListener('menu:new-file', handler); }; },
  onMenuExportHtml:   (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:export-html', handler); return () => { ipcRenderer.removeListener('menu:export-html', handler); }; },
  onMenuExportPdf:    (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:export-pdf', handler); return () => { ipcRenderer.removeListener('menu:export-pdf', handler); }; },
});
