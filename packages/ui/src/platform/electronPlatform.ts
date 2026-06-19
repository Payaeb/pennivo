import type { PennivoPlatform } from "./platform";

export function createElectronPlatform(): PennivoPlatform {
  const api = window.pennivo!;

  return {
    platformName: "electron",

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
    readDirectory: (folderPath, showEmptyFolders) =>
      api.readDirectory(folderPath, showEmptyFolders),
    onSidebarFolderChanged: (cb) => api.onSidebarFolderChanged(cb),
    setOpenFile: (filePath) => api.setOpenFile(filePath),
    showItemInFolder: (filePath) => api.showItemInFolder(filePath),

    // Workspaces (Phase 2): wired to the preload `workspaces` bridge.
    workspaces: {
      get: () => api.workspaces.get(),
      setActive: (id) => api.workspaces.setActive(id),
      add: (rootPath, name) => api.workspaces.add(rootPath, name),
      remove: (id) => api.workspaces.remove(id),
      setPrefs: (id, prefs) => api.workspaces.setPrefs(id, prefs),
    },
    getWorkspaces: () => api.workspaces.get(),

    // Global search (Phase 2): delegate to the preload `searchWorkspace`
    // bridge, which runs the core matcher in the main process.
    searchWorkspace: (query, options) => api.searchWorkspace(query, options),

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
      const name = result.filePath.split(/[/\\]/).pop() || "untitled.md";
      return { filePath: result.filePath, content: result.content, name };
    },

    // File management — not used on desktop (sidebar handles file management)
    listFiles: async () => {
      throw new Error(
        "Not implemented: desktop uses sidebar for file management",
      );
    },
    createFile: async () => {
      throw new Error(
        "Not implemented: desktop uses sidebar for file management",
      );
    },
    deleteFile: (filePath, includeAssets = false) =>
      api.deleteFile(filePath, includeAssets),
    deleteFilePermanently: (filePath, includeAssets = false) =>
      api.deleteFilePermanently(filePath, includeAssets),
    getAssetSummary: (filePath) => api.getAssetSummary(filePath),
    renameFile: (oldPath, newName) => api.renameFile(oldPath, newName),
    moveFile: (srcPath, destDir, overwrite = false) =>
      api.moveFile(srcPath, destDir, overwrite),
    createSidebarFile: (parentDir, name) =>
      api.createSidebarFile(parentDir, name),
    createSidebarFolder: (parentDir, name) =>
      api.createSidebarFolder(parentDir, name),

    // Snapshot recovery (Phase 13a) — wired to the preload `snapshot` bridge
    snapshot: {
      list: (absolutePath) => api.snapshot.list(absolutePath),
      read: (absolutePath, snapshotId) =>
        api.snapshot.read(absolutePath, snapshotId),
      restore: (absolutePath, snapshotId, mode, targetPath) =>
        api.snapshot.restore(absolutePath, snapshotId, mode, targetPath),
      getCapStatus: () => api.snapshot.getCapStatus(),
      getStorageUsage: () => api.snapshot.getStorageUsage(),
      openFolder: () => api.snapshot.openFolder(),
      clearAll: () => api.snapshot.clearAll(),
      onCapExceeded: (cb) => api.snapshot.onCapExceeded(cb),
      onArchiveStatus: (cb) => api.snapshot.onArchiveStatus(cb),
      probeArchiveStatus: () => api.snapshot.probeArchiveStatus(),
      onExternalChangeDetected: (cb) =>
        api.snapshot.onExternalChangeDetected(cb),
      saveMerged: (args) => api.snapshot.saveMerged(args),
    },

    // Trash (Phase 13a soft-delete) — wired to the preload `trash` bridge
    trash: {
      list: () => api.trash.list(),
      restore: (trashId) => api.trash.restore(trashId),
      permanentlyDelete: (trashId) => api.trash.permanentlyDelete(trashId),
      sweep: () => api.trash.sweep(),
      read: (trashId) => api.trash.read(trashId),
      onCountChanged: (cb) => api.trash.onCountChanged(cb),
    },

    mcp: {
      getAudit: (limit) =>
        api.mcp.getAudit(limit) as Promise<
          import("./platform").McpAuditEntry[]
        >,
      detectClaude: () => api.mcp.detectClaude(),
      writeClaudeConfig: () => api.mcp.writeClaudeConfig(),
      copyConfigSnippet: () => api.mcp.copyConfigSnippet(),
    },

    openFolderDialog: () => api.openFolderDialog(),

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
    onMenuOpenHistory: (cb) => api.onMenuOpenHistory(cb),
  };
}
