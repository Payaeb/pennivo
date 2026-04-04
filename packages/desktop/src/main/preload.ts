import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('pennivo', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close:    () => ipcRenderer.send('window:close'),
  setFullScreen: (flag: boolean) => ipcRenderer.send('window:set-fullscreen', flag),
  isFullScreen:  () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  paste:         () => ipcRenderer.send('edit:paste'),
  zoomIn:        () => ipcRenderer.send('window:zoom-in'),
  zoomOut:       () => ipcRenderer.send('window:zoom-out'),
  resetZoom:     () => ipcRenderer.send('window:zoom-reset'),

  // File I/O
  openFile:       () => ipcRenderer.invoke('file:open') as Promise<{ filePath: string; content: string } | null>,
  saveFile:       (filePath: string, content: string) => ipcRenderer.invoke('file:save', { filePath, content }) as Promise<boolean>,
  saveFileAs:     (content: string) => ipcRenderer.invoke('file:save-as', { content }) as Promise<string | null>,
  confirmDiscard: () => ipcRenderer.invoke('file:confirm-discard') as Promise<number>,
  setDirty:       (dirty: boolean) => ipcRenderer.send('file:set-dirty', dirty),
  closeAfterSave: () => ipcRenderer.send('file:close-after-save'),

  // Menu events from main process
  onMenuOpen:         (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:open', handler); return () => { ipcRenderer.removeListener('menu:open', handler); }; },
  onMenuSave:         (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save', handler); return () => { ipcRenderer.removeListener('menu:save', handler); }; },
  onMenuSaveAs:       (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save-as', handler); return () => { ipcRenderer.removeListener('menu:save-as', handler); }; },
  onMenuSaveAndClose:     (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:save-and-close', handler); return () => { ipcRenderer.removeListener('menu:save-and-close', handler); }; },
  onMenuToggleFocusMode:  (cb: () => void) => { const handler = () => cb(); ipcRenderer.on('menu:toggle-focus-mode', handler); return () => { ipcRenderer.removeListener('menu:toggle-focus-mode', handler); }; },
});
