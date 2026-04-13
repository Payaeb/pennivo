export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
}

export interface PennivoPlatform {
  readonly platformName: "electron" | "capacitor" | "web";

  // Platform info
  platform: string;
  getPathForFile: (file: File) => string;

  // Window controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  setFullScreen: (flag: boolean) => void;
  isFullScreen: () => Promise<boolean>;

  // Clipboard / zoom
  paste: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;

  // External links
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
  openFilePath: (
    filePath: string,
  ) => Promise<{ filePath: string; content: string; fileSize?: number } | null>;

  // Export
  exportHtml: (html: string, title: string) => Promise<string | null>;
  exportPdf: (html: string, title: string) => Promise<string | null>;

  // Window title
  setTitle: (title: string) => void;

  // Sidebar
  getSidebarFolder: () => Promise<string | null>;
  setSidebarFolder: (folderPath: string | null) => Promise<void>;
  chooseSidebarFolder: () => Promise<string | null>;
  readDirectory: (folderPath: string) => Promise<FileTreeEntry[]>;
  onSidebarFolderChanged: (cb: () => void) => () => void;

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

  // External file import (mobile SAF picker)
  pickExternalFile: () => Promise<{
    filePath: string;
    content: string;
    name: string;
  } | null>;

  // File management (mobile)
  listFiles: (
    directory?: string,
  ) => Promise<
    { name: string; path: string; modified: number; size: number }[]
  >;
  createFile: (
    fileName: string,
  ) => Promise<{ filePath: string; content: string } | null>;
  deleteFile: (filePath: string) => Promise<boolean>;
  renameFile: (oldPath: string, newName: string) => Promise<string | null>;

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
}
