interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
  size?: number;
  mtimeMs?: number;
  lastOpenedMs?: number;
}

interface PennivoAPI {
  platform: NodeJS.Platform;
  getPathForFile: (file: File) => string;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  setFullScreen: (flag: boolean) => void;
  isFullScreen: () => Promise<boolean>;
  paste: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  openExternal: (url: string) => void;

  // File I/O
  saveImage: (
    filePath: string,
    buffer: number[],
    mimeType: string,
  ) => Promise<{ relativePath: string; absolutePath: string }>;
  pickImage: (
    filePath: string,
  ) => Promise<{ relativePath: string; absolutePath: string } | null>;
  openFile: () => Promise<{
    filePath: string;
    content: string;
    fileSize?: number;
    healed?: boolean;
  } | null>;
  saveFile: (filePath: string, content: string) => Promise<boolean>;
  saveFileAs: (content: string, defaultPath?: string) => Promise<string | null>;
  confirmDiscard: () => Promise<number>;
  setDirty: (dirty: boolean) => void;
  closeAfterSave: () => void;

  // Recent files
  getRecentFiles: () => Promise<string[]>;
  addRecentFile: (filePath: string) => Promise<string[]>;
  clearRecentFiles: () => Promise<string[]>;
  openFilePath: (filePath: string) => Promise<{
    filePath: string;
    content: string;
    fileSize?: number;
    healed?: boolean;
  } | null>;

  // Export
  exportHtml: (html: string, title: string) => Promise<string | null>;
  exportPdf: (html: string, title: string) => Promise<string | null>;

  // Window title
  setTitle: (title: string) => void;

  // Sidebar
  getSidebarFolder: () => Promise<string | null>;
  setSidebarFolder: (folderPath: string | null) => Promise<void>;
  chooseSidebarFolder: () => Promise<string | null>;
  readDirectory: (
    folderPath: string,
    showEmptyFolders?: boolean,
  ) => Promise<FileTreeEntry[]>;
  onSidebarFolderChanged: (cb: () => void) => () => void;
  setOpenFile: (filePath: string | null) => Promise<void>;

  // Workspaces (Phase 2): JSON-shaped boundary, narrowed by the renderer.
  workspaces: {
    get: () => Promise<unknown>;
    setActive: (id: string | null) => Promise<unknown>;
    add: (rootPath: string, name?: string) => Promise<unknown>;
    remove: (id: string) => Promise<unknown>;
    setPrefs: (id: string, prefs: unknown) => Promise<unknown>;
  };

  // Sidebar file operations
  showItemInFolder: (filePath: string) => Promise<boolean>;
  getAssetSummary: (
    filePath: string,
  ) => Promise<{ folders: string[]; assetCount: number }>;
  deleteFile: (filePath: string, includeAssets?: boolean) => Promise<boolean>;
  deleteFilePermanently: (
    filePath: string,
    includeAssets?: boolean,
  ) => Promise<boolean>;
  renameFile: (oldPath: string, newName: string) => Promise<string | null>;
  moveFile: (
    srcPath: string,
    destDir: string,
    overwrite: boolean,
  ) => Promise<{
    ok: boolean;
    newPath?: string;
    reason?: "collision" | "error";
  }>;
  createSidebarFile: (
    parentDir: string,
    name: string,
  ) => Promise<string | null>;
  createSidebarFolder: (
    parentDir: string,
    name: string,
  ) => Promise<string | null>;

  // Toolbar config
  getToolbarConfig: () => Promise<string[] | null>;
  setToolbarConfig: (actions: string[]) => Promise<void>;

  // Spellcheck
  getSpellCheckLanguages: () => Promise<string[]>;
  getAvailableSpellLanguages: () => Promise<string[]>;
  setSpellCheckLanguages: (languages: string[]) => Promise<void>;
  addWordToDictionary: (word: string) => Promise<void>;

  // Settings
  getSettings: () => Promise<Record<string, unknown>>;
  setSettings: (settings: Record<string, unknown>) => Promise<void>;

  // App info
  getAppInfo: () => Promise<{ version: string; name: string }>;

  // File-from-OS (double-click .md in Explorer / second-instance launch)
  getPendingFilePath: () => Promise<string | null>;
  onFileOpenFromOS: (cb: (filePath: string) => void) => () => void;

  // Auto-update
  onUpdateAvailable: (cb: (version: string) => void) => () => void;
  installUpdate: () => void;

  // Snapshot recovery (Phase 13a)
  snapshot: {
    list: (absolutePath: string) => Promise<unknown[]>;
    read: (
      absolutePath: string,
      snapshotId: string,
    ) => Promise<{ content: string; meta: unknown } | null>;
    restore: (
      absolutePath: string,
      snapshotId: string,
      mode: "overwrite" | "as-new-file",
      targetPath?: string,
    ) => Promise<{ newPath: string } | null>;
    getCapStatus: () => Promise<unknown | null>;
    getStorageUsage: () => Promise<{ bytes: number }>;
    openFolder: () => Promise<boolean>;
    clearAll: () => Promise<boolean>;
    onCapExceeded: (cb: (warning: unknown) => void) => () => void;
    onArchiveStatus: (cb: (status: unknown) => void) => () => void;
    probeArchiveStatus: () => Promise<boolean>;
    onExternalChangeDetected: (
      cb: (payload: { absolutePath: string; snapshotId: string }) => void,
    ) => () => void;
    saveMerged: (args: {
      filePath: string;
      content: string;
      mode: "overwrite" | "as-new-file";
      left: string | null;
      right: string | null;
    }) => Promise<{ savedPath: string } | null>;
  };

  // Trash (Phase 13a soft-delete)
  trash: {
    list: () => Promise<unknown[]>;
    restore: (trashId: string) => Promise<{ restoredPath: string } | null>;
    permanentlyDelete: (trashId: string) => Promise<boolean>;
    sweep: () => Promise<{ removedCount: number }>;
    read: (trashId: string) => Promise<{ content: string } | null>;
    onCountChanged: (cb: (count: number) => void) => () => void;
  };

  // MCP server (Phase 12a)
  mcp: {
    getAudit: (limit?: number) => Promise<unknown[]>;
    detectClaude: () => Promise<{
      found: boolean;
      path: string;
      snippet: string;
    }>;
    writeClaudeConfig: () => Promise<{
      ok: boolean;
      path: string;
      error?: string;
    }>;
    copyConfigSnippet: () => Promise<string>;
  };

  // Folder picker (Settings → Recovery archive folder)
  openFolderDialog: () => Promise<string | null>;

  // Menu events (returns cleanup function)
  onMenuPaste: (cb: () => void) => () => void;
  onMenuOpen: (cb: () => void) => () => void;
  onMenuSave: (cb: () => void) => () => void;
  onMenuSaveAs: (cb: () => void) => () => void;
  onMenuSaveAndClose: (cb: () => void) => () => void;
  onMenuToggleFocusMode: (cb: () => void) => () => void;
  onMenuNewFile: (cb: () => void) => () => void;
  onMenuExportHtml: (cb: () => void) => () => void;
  onMenuExportPdf: (cb: () => void) => () => void;
  onMenuOpenHistory: (cb: () => void) => () => void;
}

declare interface Window {
  pennivo: PennivoAPI;
}
