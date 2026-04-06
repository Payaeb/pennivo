interface PennivoAPI {
  platform: string;
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
  saveFileAs: (content: string) => Promise<string | null>;
  confirmDiscard: () => Promise<number>;
  setDirty: (dirty: boolean) => void;
  closeAfterSave: () => void;

  // Recent files
  getRecentFiles: () => Promise<string[]>;
  addRecentFile: (filePath: string) => Promise<string[]>;
  clearRecentFiles: () => Promise<string[]>;
  openFilePath: (filePath: string) => Promise<{ filePath: string; content: string } | null>;

  // Menu events (returns cleanup function)
  onMenuPaste: (cb: () => void) => () => void;
  onMenuOpen: (cb: () => void) => () => void;
  onMenuSave: (cb: () => void) => () => void;
  onMenuSaveAs: (cb: () => void) => () => void;
  onMenuSaveAndClose: (cb: () => void) => () => void;
  onMenuToggleFocusMode: (cb: () => void) => () => void;
}

declare interface Window {
  pennivo?: PennivoAPI;
}
