import type { PennivoPlatform } from './platform';

export function createElectronPlatform(): PennivoPlatform {
  const api = window.pennivo!;

  return {
    platformName: 'electron',

    // Platform info
    platform: api.platform,
    getPathForFile: (file) => api.getPathForFile(file),

    // Window controls
    minimize: () => api.minimize(),
    maximize: () => api.maximize(),
    close: () => api.close(),
    setFullScreen: (flag) => api.setFullScreen(flag),
    isFullScreen: () => api.isFullScreen(),

    // Clipboard / zoom
    paste: () => api.paste(),
    zoomIn: () => api.zoomIn(),
    zoomOut: () => api.zoomOut(),
    resetZoom: () => api.resetZoom(),

    // External links
    openExternal: (url) => api.openExternal(url),

    // File I/O
    saveImage: (filePath, buffer, mimeType) =>
      api.saveImage(filePath, buffer, mimeType),
    pickImage: (filePath) => api.pickImage(filePath),
    openFile: () => api.openFile(),
    saveFile: (filePath, content) => api.saveFile(filePath, content),
    saveFileAs: (content, defaultPath) => api.saveFileAs(content, defaultPath),
    confirmDiscard: () => api.confirmDiscard(),
    setDirty: (dirty) => api.setDirty(dirty),
    closeAfterSave: () => api.closeAfterSave(),

    // Recent files
    getRecentFiles: () => api.getRecentFiles(),
    addRecentFile: (filePath) => api.addRecentFile(filePath),
    clearRecentFiles: () => api.clearRecentFiles(),
    openFilePath: (filePath) => api.openFilePath(filePath),

    // Export
    exportHtml: (html, title) => api.exportHtml(html, title),
    exportPdf: (html, title) => api.exportPdf(html, title),

    // Window title
    setTitle: (title) => api.setTitle(title),

    // Sidebar
    getSidebarFolder: () => api.getSidebarFolder(),
    setSidebarFolder: (folderPath) => api.setSidebarFolder(folderPath),
    chooseSidebarFolder: () => api.chooseSidebarFolder(),
    readDirectory: (folderPath) => api.readDirectory(folderPath),
    onSidebarFolderChanged: (cb) => api.onSidebarFolderChanged(cb),

    // Toolbar config
    getToolbarConfig: () => api.getToolbarConfig(),
    setToolbarConfig: (actions) => api.setToolbarConfig(actions),

    // Spellcheck
    getSpellCheckLanguages: () => api.getSpellCheckLanguages(),
    getAvailableSpellLanguages: () => api.getAvailableSpellLanguages(),
    setSpellCheckLanguages: (languages) =>
      api.setSpellCheckLanguages(languages),
    addWordToDictionary: (word) => api.addWordToDictionary(word),

    // Settings
    getSettings: () => api.getSettings(),
    setSettings: (settings) => api.setSettings(settings),

    // App info
    getAppInfo: () => api.getAppInfo(),

    // File-from-OS
    getPendingFilePath: () => api.getPendingFilePath(),
    onFileOpenFromOS: (cb) => api.onFileOpenFromOS(cb),

    // Auto-update
    onUpdateAvailable: (cb) => api.onUpdateAvailable(cb),
    installUpdate: () => api.installUpdate(),

    // External file import — desktop uses openFile dialog instead
    pickExternalFile: async () => {
      // Desktop uses its own openFile dialog; this method is for mobile SAF only
      const result = await api.openFile();
      if (!result) return null;
      const name = result.filePath.split(/[/\\]/).pop() || 'untitled.md';
      return { filePath: result.filePath, content: result.content, name };
    },

    // File management — not used on desktop (sidebar handles file management)
    listFiles: async () => {
      throw new Error('Not implemented: desktop uses sidebar for file management');
    },
    createFile: async () => {
      throw new Error('Not implemented: desktop uses sidebar for file management');
    },
    deleteFile: async () => {
      throw new Error('Not implemented: desktop uses sidebar for file management');
    },
    renameFile: async () => {
      throw new Error('Not implemented: desktop uses sidebar for file management');
    },

    // Menu events
    onMenuPaste: (cb) => api.onMenuPaste(cb),
    onMenuOpen: (cb) => api.onMenuOpen(cb),
    onMenuSave: (cb) => api.onMenuSave(cb),
    onMenuSaveAs: (cb) => api.onMenuSaveAs(cb),
    onMenuSaveAndClose: (cb) => api.onMenuSaveAndClose(cb),
    onMenuToggleFocusMode: (cb) => api.onMenuToggleFocusMode(cb),
    onMenuNewFile: (cb) => api.onMenuNewFile(cb),
    onMenuExportHtml: (cb) => api.onMenuExportHtml(cb),
    onMenuExportPdf: (cb) => api.onMenuExportPdf(cb),
  };
}
