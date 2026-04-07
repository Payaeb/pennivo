interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileTreeEntry[];
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
  saveImage: (filePath: string, buffer: number[], mimeType: string) => Promise<{ relativePath: string; absolutePath: string }>;
  pickImage: (filePath: string) => Promise<{ relativePath: string; absolutePath: string } | null>;
  openFile: () => Promise<{ filePath: string; content: string } | null>;
  saveFile: (filePath: string, content: string) => Promise<boolean>;
  saveFileAs: (content: string, defaultPath?: string) => Promise<string | null>;
  confirmDiscard: () => Promise<number>;
  setDirty: (dirty: boolean) => void;
  closeAfterSave: () => void;

  // Recent files
  getRecentFiles: () => Promise<string[]>;
  addRecentFile: (filePath: string) => Promise<string[]>;
  clearRecentFiles: () => Promise<string[]>;
  openFilePath: (filePath: string) => Promise<{ filePath: string; content: string } | null>;

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

declare interface Window {
  pennivo: PennivoAPI;
}
