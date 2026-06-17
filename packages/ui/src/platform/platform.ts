export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
  size?: number;
  mtimeMs?: number;
  lastOpenedMs?: number;
}

/**
 * Trash surface exposed to the renderer (Phase 13a soft-delete).
 *
 * Desktop wires this up to disk via `<userData>/trash/`. Mobile and web
 * stub these out (empty list, throw on mutations) — same pattern as
 * `SnapshotPlatform` below.
 *
 * `list` returns `unknown[]` here; the renderer narrows it via the
 * `TrashEntry` type re-exported from `@pennivo/core`. We don't import that
 * here to keep the platform surface dependency-free of core types — the
 * IPC boundary is intentionally JSON-shaped.
 */
export interface TrashPlatform {
  list: () => Promise<unknown[]>;
  restore: (trashId: string) => Promise<{ restoredPath: string } | null>;
  permanentlyDelete: (trashId: string) => Promise<boolean>;
  sweep: () => Promise<{ removedCount: number }>;
  /**
   * Read the markdown content of a trash entry — used by the Trash list's
   * preview pane. Returns `null` if the entry is gone or unreadable.
   */
  read: (trashId: string) => Promise<{ content: string } | null>;
  /**
   * Subscribe to trash count changes. Fired by the main process after every
   * `moveToTrash` / `restoreFromTrash` / `permanentlyDelete` / `sweepExpired`.
   * Returns an unsubscribe function.
   */
  onCountChanged: (cb: (count: number) => void) => () => void;
}

/**
 * Snapshot/recovery surface exposed to the renderer (Phase 13a). Desktop
 * provides full disk-backed implementations; mobile / web stub these out
 * (no-op or empty results) — there is no v1 plan for snapshots on those
 * platforms, but having the surface defined here keeps the renderer free
 * of platform branches.
 */
export interface SnapshotPlatform {
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
  /** Total bytes used by the local snapshots store (best-effort). */
  getStorageUsage: () => Promise<{ bytes: number }>;
  /** Open `<userData>/snapshots/` in the OS file manager. */
  openFolder: () => Promise<boolean>;
  /** Permanently delete every snapshot for every file. Destructive. */
  clearAll: () => Promise<boolean>;
  onCapExceeded: (cb: (warning: unknown) => void) => () => void;
  onArchiveStatus: (cb: (status: unknown) => void) => () => void;
  /**
   * Ask the main process to probe the archive folder and emit the current
   * `recovery:archive-status` state. Used by the renderer on mount so the
   * titlebar chip reflects current reachability even if the engine's
   * boot-time emit raced ahead of the renderer's subscription.
   */
  probeArchiveStatus: () => Promise<boolean>;
  onExternalChangeDetected: (
    cb: (payload: { absolutePath: string; snapshotId: string }) => void,
  ) => () => void;
  /**
   * Save a user-merged document. `mode: 'overwrite'` writes back to
   * `filePath` AFTER taking a pre-restore snapshot tagged with
   * `mergedFrom: { left, right }`. `mode: 'as-new-file'` writes alongside
   * the original as `<name> (merged YYYY-MM-DD).md`. Returns the saved
   * path. Used by Compare & merge.
   */
  saveMerged: (args: {
    filePath: string;
    content: string;
    mode: "overwrite" | "as-new-file";
    left: string | null;
    right: string | null;
  }) => Promise<{ savedPath: string } | null>;
}

/** One recorded MCP tool/resource call, surfaced in Settings → MCP. */
export interface McpAuditEntry {
  ts: number;
  agent: string;
  tool: string;
  path?: string;
  outcome: "ok" | "error" | "denied";
  detail?: string;
}

/**
 * MCP server surface (Phase 12a). The server itself runs in a separate
 * `pennivo --mcp` process; these methods serve the Settings → MCP panel:
 * reading the cross-process audit log and the "Connect to Claude" flow.
 * Desktop-only — web/mobile stub these out.
 */
export interface McpPlatform {
  /** Most recent MCP tool calls (newest first), read from the audit log. */
  getAudit: (limit?: number) => Promise<McpAuditEntry[]>;
  /** Detect the Claude Desktop config file and return a paste-ready snippet. */
  detectClaude: () => Promise<{
    found: boolean;
    path: string;
    snippet: string;
  }>;
  /** Merge the Pennivo server into the Claude Desktop config (preserves others). */
  writeClaudeConfig: () => Promise<{
    ok: boolean;
    path: string;
    error?: string;
  }>;
  /** Copy the MCP config snippet to the clipboard; returns the snippet text. */
  copyConfigSnippet: () => Promise<string>;
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
  readDirectory: (folderPath: string) => Promise<FileTreeEntry[]>;
  onSidebarFolderChanged: (cb: () => void) => () => void;

  // Reveal a file in the OS file manager (Electron-only; no-op on web/mobile).
  // Returns true if the call succeeded.
  showItemInFolder: (filePath: string) => Promise<boolean>;

  // Move a file into a different folder. Returns ok=true with the new
  // absolute path on success. On a name collision in destDir, returns
  // ok=false with reason="collision" — caller may retry with overwrite=true
  // to replace the existing file. Other failures return reason="error".
  moveFile: (
    srcPath: string,
    destDir: string,
    overwrite?: boolean,
  ) => Promise<{
    ok: boolean;
    newPath?: string;
    reason?: "collision" | "error";
  }>;

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
  deleteFile: (filePath: string, includeAssets?: boolean) => Promise<boolean>;
  /**
   * Hard-delete bypass — `fs.unlink` (and asset folder rm) without going
   * through trash. Wired for the future "Delete permanently" right-click
   * option. Mobile/web stub to throw.
   */
  deleteFilePermanently: (
    filePath: string,
    includeAssets?: boolean,
  ) => Promise<boolean>;

  // Summarize what owns this file's assets — used by the delete-confirm
  // dialog to ask "Also delete N asset file(s)?". Lists owned `*-md-images/`
  // folders (content-referenced + convention-named) and total file count
  // across them. Electron-only (web/mobile return zeros).
  getAssetSummary: (
    filePath: string,
  ) => Promise<{ folders: string[]; assetCount: number }>;
  renameFile: (oldPath: string, newName: string) => Promise<string | null>;

  // Snapshot recovery (Phase 13a)
  snapshot: SnapshotPlatform;

  // Trash (Phase 13a soft-delete)
  trash: TrashPlatform;

  // MCP server (Phase 12a)
  mcp: McpPlatform;

  /**
   * Open an OS folder picker dialog (Settings → Recovery archive folder).
   * Returns the chosen path or `null` when cancelled. No-op on web/mobile
   * (returns `null`).
   */
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
  /** File menu → History… (Ctrl+Alt+H). Opens the recovery modal. */
  onMenuOpenHistory: (cb: () => void) => () => void;
}
