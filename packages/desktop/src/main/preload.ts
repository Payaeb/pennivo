import { contextBridge, ipcRenderer, webUtils } from "electron";

interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: FileTreeEntry[];
  size?: number;
  mtimeMs?: number;
  lastOpenedMs?: number;
}

contextBridge.exposeInMainWorld("pennivo", {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  minimize: () => ipcRenderer.send("window:minimize"),
  maximize: () => ipcRenderer.send("window:maximize"),
  close: () => ipcRenderer.send("window:close"),
  setFullScreen: (flag: boolean) =>
    ipcRenderer.send("window:set-fullscreen", flag),
  isFullScreen: () =>
    ipcRenderer.invoke("window:is-fullscreen") as Promise<boolean>,
  paste: () => ipcRenderer.send("edit:paste"),
  zoomIn: () => ipcRenderer.send("window:zoom-in"),
  zoomOut: () => ipcRenderer.send("window:zoom-out"),
  resetZoom: () => ipcRenderer.send("window:zoom-reset"),
  openExternal: (url: string) => ipcRenderer.send("shell:open-external", url),

  // File I/O
  saveImage: (filePath: string, buffer: number[], mimeType: string) =>
    ipcRenderer.invoke("file:save-image", {
      filePath,
      buffer,
      mimeType,
    }) as Promise<{ relativePath: string; absolutePath: string }>,
  pickImage: (filePath: string) =>
    ipcRenderer.invoke("file:pick-image", { filePath }) as Promise<{
      relativePath: string;
      absolutePath: string;
    } | null>,
  openFile: () =>
    ipcRenderer.invoke("file:open") as Promise<{
      filePath: string;
      content: string;
      fileSize?: number;
      healed?: boolean;
    } | null>,
  saveFile: (filePath: string, content: string) =>
    ipcRenderer.invoke("file:save", { filePath, content }) as Promise<boolean>,
  saveFileAs: (content: string, defaultPath?: string) =>
    ipcRenderer.invoke("file:save-as", { content, defaultPath }) as Promise<
      string | null
    >,
  confirmDiscard: () =>
    ipcRenderer.invoke("file:confirm-discard") as Promise<number>,
  setDirty: (dirty: boolean) => ipcRenderer.send("file:set-dirty", dirty),
  closeAfterSave: () => ipcRenderer.send("file:close-after-save"),

  // Recent files
  getRecentFiles: () =>
    ipcRenderer.invoke("recent-files:get") as Promise<string[]>,
  addRecentFile: (filePath: string) =>
    ipcRenderer.invoke("recent-files:add", filePath) as Promise<string[]>,
  clearRecentFiles: () =>
    ipcRenderer.invoke("recent-files:clear") as Promise<string[]>,
  openFilePath: (filePath: string) =>
    ipcRenderer.invoke("file:open-path", filePath) as Promise<{
      filePath: string;
      content: string;
      fileSize?: number;
      healed?: boolean;
    } | null>,

  // Export
  exportHtml: (html: string, title: string) =>
    ipcRenderer.invoke("export:html", { html, title }) as Promise<
      string | null
    >,
  exportPdf: (html: string, title: string) =>
    ipcRenderer.invoke("export:pdf", { html, title }) as Promise<string | null>,

  // Window title
  setTitle: (title: string) => ipcRenderer.send("window:set-title", title),

  // Sidebar
  getSidebarFolder: () =>
    ipcRenderer.invoke("sidebar:get-folder") as Promise<string | null>,
  setSidebarFolder: (folderPath: string | null) =>
    ipcRenderer.invoke("sidebar:set-folder", folderPath) as Promise<void>,
  chooseSidebarFolder: () =>
    ipcRenderer.invoke("sidebar:choose-folder") as Promise<string | null>,
  readDirectory: (folderPath: string, showEmptyFolders?: boolean) =>
    ipcRenderer.invoke(
      "sidebar:read-directory",
      folderPath,
      showEmptyFolders,
    ) as Promise<FileTreeEntry[]>,
  onSidebarFolderChanged: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("sidebar:folder-changed", handler);
    return () => {
      ipcRenderer.removeListener("sidebar:folder-changed", handler);
    };
  },
  // Report the currently-open file so the main-process watcher can live-reload
  // it on external change (Phase 12d-pre). `null` clears it.
  setOpenFile: (filePath: string | null) =>
    ipcRenderer.invoke("watch:set-open-file", filePath) as Promise<void>,

  // Workspaces (Phase 2): multi-root state persisted in settings.json.
  // The boundary is JSON-shaped; the renderer narrows the returned objects
  // via the `WorkspacesState` / `WorkspacePrefs` types from @pennivo/core.
  workspaces: {
    get: () => ipcRenderer.invoke("workspaces:get") as Promise<unknown>,
    setActive: (id: string | null) =>
      ipcRenderer.invoke("workspaces:set-active", id) as Promise<unknown>,
    add: (rootPath: string, name?: string) =>
      ipcRenderer.invoke("workspaces:add", rootPath, name) as Promise<unknown>,
    remove: (id: string) =>
      ipcRenderer.invoke("workspaces:remove", id) as Promise<unknown>,
    setPrefs: (id: string, prefs: unknown) =>
      ipcRenderer.invoke("workspaces:set-prefs", id, prefs) as Promise<unknown>,
  },

  // Sidebar file operations
  showItemInFolder: (filePath: string) =>
    ipcRenderer.invoke("sidebar:show-in-folder", filePath) as Promise<boolean>,
  getAssetSummary: (filePath: string) =>
    ipcRenderer.invoke("sidebar:get-asset-summary", filePath) as Promise<{
      folders: string[];
      assetCount: number;
    }>,
  deleteFile: (filePath: string, includeAssets: boolean = false) =>
    ipcRenderer.invoke(
      "sidebar:delete-file",
      filePath,
      includeAssets,
    ) as Promise<boolean>,
  deleteFilePermanently: (filePath: string, includeAssets: boolean = false) =>
    ipcRenderer.invoke(
      "sidebar:delete-permanently",
      filePath,
      includeAssets,
    ) as Promise<boolean>,
  renameFile: (oldPath: string, newName: string) =>
    ipcRenderer.invoke("sidebar:rename-file", oldPath, newName) as Promise<
      string | null
    >,
  moveFile: (srcPath: string, destDir: string, overwrite: boolean) =>
    ipcRenderer.invoke(
      "sidebar:move-file",
      srcPath,
      destDir,
      overwrite,
    ) as Promise<{
      ok: boolean;
      newPath?: string;
      reason?: "collision" | "error";
    }>,
  createSidebarFile: (parentDir: string, name: string) =>
    ipcRenderer.invoke("sidebar:create-file", parentDir, name) as Promise<
      string | null
    >,
  createSidebarFolder: (parentDir: string, name: string) =>
    ipcRenderer.invoke("sidebar:create-folder", parentDir, name) as Promise<
      string | null
    >,

  // Toolbar config
  getToolbarConfig: () =>
    ipcRenderer.invoke("toolbar-config:get") as Promise<string[] | null>,
  setToolbarConfig: (actions: string[]) =>
    ipcRenderer.invoke("toolbar-config:set", actions) as Promise<void>,

  // Spellcheck
  getSpellCheckLanguages: () =>
    ipcRenderer.invoke("spellcheck:get-languages") as Promise<string[]>,
  getAvailableSpellLanguages: () =>
    ipcRenderer.invoke("spellcheck:get-available-languages") as Promise<
      string[]
    >,
  setSpellCheckLanguages: (languages: string[]) =>
    ipcRenderer.invoke("spellcheck:set-languages", languages) as Promise<void>,
  addWordToDictionary: (word: string) =>
    ipcRenderer.invoke("spellcheck:add-word", word) as Promise<void>,

  // Settings
  getSettings: () =>
    ipcRenderer.invoke("settings:get") as Promise<Record<string, unknown>>,
  setSettings: (settings: Record<string, unknown>) =>
    ipcRenderer.invoke("settings:set", settings) as Promise<void>,

  // App info
  getAppInfo: () =>
    ipcRenderer.invoke("app:get-info") as Promise<{
      version: string;
      name: string;
    }>,

  // File-from-OS (double-click .md in Explorer / second-instance launch)
  getPendingFilePath: () =>
    ipcRenderer.invoke("app:get-pending-file") as Promise<string | null>,
  onFileOpenFromOS: (cb: (filePath: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, filePath: string) =>
      cb(filePath);
    ipcRenderer.on("file:open-from-os", handler);
    return () => {
      ipcRenderer.removeListener("file:open-from-os", handler);
    };
  },

  // Auto-update (production only — main process never fires these in dev)
  onUpdateAvailable: (cb: (version: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, version: string) =>
      cb(version);
    ipcRenderer.on("update:available", handler);
    return () => {
      ipcRenderer.removeListener("update:available", handler);
    };
  },
  installUpdate: () => ipcRenderer.send("update:install"),

  // MCP server (Phase 12a) — Settings → MCP panel surface
  mcp: {
    getAudit: (limit?: number) =>
      ipcRenderer.invoke("mcp:get-audit", limit) as Promise<unknown[]>,
    detectClaude: () =>
      ipcRenderer.invoke("mcp:detect-claude") as Promise<{
        found: boolean;
        path: string;
        snippet: string;
      }>,
    writeClaudeConfig: () =>
      ipcRenderer.invoke("mcp:write-claude-config") as Promise<{
        ok: boolean;
        path: string;
        error?: string;
      }>,
    copyConfigSnippet: () =>
      ipcRenderer.invoke("mcp:copy-config-snippet") as Promise<string>,
  },

  // Snapshot recovery (Phase 13a)
  snapshot: {
    list: (absolutePath: string) =>
      ipcRenderer.invoke("snapshot:list", absolutePath) as Promise<unknown[]>,
    read: (absolutePath: string, snapshotId: string) =>
      ipcRenderer.invoke("snapshot:read", absolutePath, snapshotId) as Promise<{
        content: string;
        meta: unknown;
      } | null>,
    restore: (
      absolutePath: string,
      snapshotId: string,
      mode: "overwrite" | "as-new-file",
      targetPath?: string,
    ) =>
      ipcRenderer.invoke("snapshot:restore", {
        absolutePath,
        snapshotId,
        mode,
        targetPath,
      }) as Promise<{ newPath: string } | null>,
    getCapStatus: () =>
      ipcRenderer.invoke("snapshot:get-cap-status") as Promise<unknown | null>,
    getStorageUsage: () =>
      ipcRenderer.invoke("snapshot:get-storage-usage") as Promise<{
        bytes: number;
      }>,
    openFolder: () =>
      ipcRenderer.invoke("snapshot:open-folder") as Promise<boolean>,
    clearAll: () =>
      ipcRenderer.invoke("snapshot:clear-all") as Promise<boolean>,
    onCapExceeded: (cb: (warning: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, warning: unknown) =>
        cb(warning);
      ipcRenderer.on("recovery:cap-exceeded", handler);
      return () => {
        ipcRenderer.removeListener("recovery:cap-exceeded", handler);
      };
    },
    onArchiveStatus: (cb: (status: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: unknown) =>
        cb(status);
      ipcRenderer.on("recovery:archive-status", handler);
      return () => {
        ipcRenderer.removeListener("recovery:archive-status", handler);
      };
    },
    probeArchiveStatus: () =>
      ipcRenderer.invoke("snapshot:probe-archive-status") as Promise<boolean>,
    onExternalChangeDetected: (
      cb: (payload: { absolutePath: string; snapshotId: string }) => void,
    ) => {
      const handler = (
        _e: Electron.IpcRendererEvent,
        payload: { absolutePath: string; snapshotId: string },
      ) => cb(payload);
      ipcRenderer.on("recovery:external-change-detected", handler);
      return () => {
        ipcRenderer.removeListener(
          "recovery:external-change-detected",
          handler,
        );
      };
    },
    saveMerged: (args: {
      filePath: string;
      content: string;
      mode: "overwrite" | "as-new-file";
      left: string | null;
      right: string | null;
    }) =>
      ipcRenderer.invoke("snapshot:save-merged", args) as Promise<{
        savedPath: string;
      } | null>,
  },

  // Trash (Phase 13a soft-delete)
  trash: {
    list: () => ipcRenderer.invoke("trash:list") as Promise<unknown[]>,
    restore: (trashId: string) =>
      ipcRenderer.invoke("trash:restore", trashId) as Promise<{
        restoredPath: string;
      } | null>,
    permanentlyDelete: (trashId: string) =>
      ipcRenderer.invoke(
        "trash:permanently-delete",
        trashId,
      ) as Promise<boolean>,
    sweep: () =>
      ipcRenderer.invoke("trash:sweep") as Promise<{ removedCount: number }>,
    read: (trashId: string) =>
      ipcRenderer.invoke("trash:read", trashId) as Promise<{
        content: string;
      } | null>,
    onCountChanged: (cb: (count: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, count: number) =>
        cb(count);
      ipcRenderer.on("trash:count-changed", handler);
      return () => {
        ipcRenderer.removeListener("trash:count-changed", handler);
      };
    },
  },

  // Folder picker for Settings → Recovery archive folder. Reuses the same
  // showOpenDialog as `sidebar:choose-folder` but doesn't persist anything.
  openFolderDialog: () =>
    ipcRenderer.invoke("dialog:open-folder") as Promise<string | null>,

  // Menu events from main process
  onMenuPaste: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:paste", handler);
    return () => {
      ipcRenderer.removeListener("menu:paste", handler);
    };
  },
  onMenuOpen: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:open", handler);
    return () => {
      ipcRenderer.removeListener("menu:open", handler);
    };
  },
  onMenuSave: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:save", handler);
    return () => {
      ipcRenderer.removeListener("menu:save", handler);
    };
  },
  onMenuSaveAs: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:save-as", handler);
    return () => {
      ipcRenderer.removeListener("menu:save-as", handler);
    };
  },
  onMenuSaveAndClose: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:save-and-close", handler);
    return () => {
      ipcRenderer.removeListener("menu:save-and-close", handler);
    };
  },
  onMenuToggleFocusMode: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:toggle-focus-mode", handler);
    return () => {
      ipcRenderer.removeListener("menu:toggle-focus-mode", handler);
    };
  },
  onMenuNewFile: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:new-file", handler);
    return () => {
      ipcRenderer.removeListener("menu:new-file", handler);
    };
  },
  onMenuExportHtml: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:export-html", handler);
    return () => {
      ipcRenderer.removeListener("menu:export-html", handler);
    };
  },
  onMenuExportPdf: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:export-pdf", handler);
    return () => {
      ipcRenderer.removeListener("menu:export-pdf", handler);
    };
  },
  onMenuOpenHistory: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on("menu:open-history", handler);
    return () => {
      ipcRenderer.removeListener("menu:open-history", handler);
    };
  },
});
