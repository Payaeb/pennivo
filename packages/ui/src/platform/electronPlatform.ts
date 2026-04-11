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
