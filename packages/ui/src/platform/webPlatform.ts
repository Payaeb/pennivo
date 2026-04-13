import type { PennivoPlatform } from "./platform";
import { wrapHtmlWithStyles } from "../utils/exportHtml";

/**
 * Neutral browser fallback platform used when the renderer runs in a plain
 * browser (Chrome UAT, web preview) without Electron preload or Capacitor
 * runtime. Everything degrades gracefully: no-op where possible, localStorage
 * for persistence, warn-and-return for file I/O.
 *
 * This platform is deliberately side-effect-light and never throws — the goal
 * is to make the UI boot cleanly in a browser so we can run visual QA and
 * automated integration tests.
 */

const noop = () => {};

const LS_RECENT_FILES = "pennivo.web.recentFiles";
const LS_SETTINGS = "pennivo.web.settings";
const LS_TOOLBAR_CONFIG = "pennivo.web.toolbarConfig";
const LS_SIDEBAR_FOLDER = "pennivo.web.sidebarFolder";
const MAX_RECENT_FILES = 10;

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn("[Pennivo:web] localStorage set failed:", err);
  }
}

function warnUnsupported(feature: string): void {
  console.warn(`[Pennivo:web] ${feature} is not available in browser preview.`);
}

export function createWebPlatform(): PennivoPlatform {
  return {
    platformName: "web",

    // Platform info
    platform: "web",
    getPathForFile: () => "",

    // Window controls — no-op in browser
    minimize: noop,
    maximize: noop,
    close: noop,
    setFullScreen: noop,
    isFullScreen: () => Promise.resolve(false),

    // Clipboard / zoom — no-op in browser (browser handles natively)
    paste: noop,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,

    // External links
    openExternal: (url) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },

    // File I/O — not supported in plain browser
    saveImage: async () => {
      warnUnsupported("saveImage");
      return { relativePath: "", absolutePath: "" };
    },
    pickImage: async () => {
      warnUnsupported("pickImage");
      return null;
    },
    openFile: async () => {
      warnUnsupported("openFile");
      return null;
    },
    saveFile: async () => {
      warnUnsupported("saveFile");
      return false;
    },
    saveFileAs: async () => {
      warnUnsupported("saveFileAs");
      return null;
    },
    confirmDiscard: async () => {
      // Default to discard so the UI doesn't hang on modal
      return 1;
    },
    setDirty: noop,
    closeAfterSave: noop,

    // Recent files — persisted in localStorage
    getRecentFiles: async () => lsGet<string[]>(LS_RECENT_FILES, []),
    addRecentFile: async (filePath) => {
      const existing = lsGet<string[]>(LS_RECENT_FILES, []);
      const filtered = existing.filter((p) => p !== filePath);
      const updated = [filePath, ...filtered].slice(0, MAX_RECENT_FILES);
      lsSet(LS_RECENT_FILES, updated);
      return updated;
    },
    clearRecentFiles: async () => {
      lsSet(LS_RECENT_FILES, []);
      return [];
    },
    openFilePath: async () => {
      warnUnsupported("openFilePath");
      return null;
    },

    // Export — best-effort via download link
    exportHtml: async (html, title) => {
      const styledHtml = wrapHtmlWithStyles(html, title);
      const fileName = title.replace(/\.md$/i, "") + ".html";
      try {
        const blob = new Blob([styledHtml], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return fileName;
      } catch (err) {
        console.error("[Pennivo:web] exportHtml failed:", err);
        return null;
      }
    },
    exportPdf: async (html, title) => {
      // No native PDF in plain browser — fall back to print dialog
      const styledHtml = wrapHtmlWithStyles(html, title);
      try {
        const w = window.open("", "_blank");
        if (!w) return null;
        w.document.write(styledHtml);
        w.document.close();
        w.focus();
        w.print();
        return title;
      } catch (err) {
        console.error("[Pennivo:web] exportPdf failed:", err);
        return null;
      }
    },

    // Window title — update document title in browser
    setTitle: (title) => {
      document.title = title;
    },

    // Sidebar — remember folder string in localStorage, no directory reads
    getSidebarFolder: async () => lsGet<string | null>(LS_SIDEBAR_FOLDER, null),
    setSidebarFolder: async (folderPath) => {
      lsSet(LS_SIDEBAR_FOLDER, folderPath);
    },
    chooseSidebarFolder: async () => {
      warnUnsupported("chooseSidebarFolder");
      return null;
    },
    readDirectory: async () => [],
    onSidebarFolderChanged: () => noop,

    // Toolbar config — persisted in localStorage
    getToolbarConfig: async () =>
      lsGet<string[] | null>(LS_TOOLBAR_CONFIG, null),
    setToolbarConfig: async (actions) => {
      lsSet(LS_TOOLBAR_CONFIG, actions);
    },

    // Spellcheck — browser handles natively
    getSpellCheckLanguages: async () => [],
    getAvailableSpellLanguages: async () => [],
    setSpellCheckLanguages: async () => {},
    addWordToDictionary: async () => {},

    // Settings — persisted in localStorage
    getSettings: async () => lsGet<Record<string, unknown>>(LS_SETTINGS, {}),
    setSettings: async (settings) => {
      const existing = lsGet<Record<string, unknown>>(LS_SETTINGS, {});
      lsSet(LS_SETTINGS, { ...existing, ...settings });
    },

    // App info
    getAppInfo: async () => ({ version: "0.0.0-web", name: "Pennivo (web)" }),

    // File-from-OS — not applicable in browser
    getPendingFilePath: () => Promise.resolve(null),
    onFileOpenFromOS: () => noop,

    // Auto-update — not applicable in browser
    onUpdateAvailable: () => noop,
    installUpdate: noop,

    // External file import — not supported in plain browser
    pickExternalFile: async () => {
      warnUnsupported("pickExternalFile");
      return null;
    },

    // File management — return empty results, warn on write
    listFiles: async () => [],
    createFile: async () => {
      warnUnsupported("createFile");
      return null;
    },
    deleteFile: async () => {
      warnUnsupported("deleteFile");
      return false;
    },
    renameFile: async () => {
      warnUnsupported("renameFile");
      return null;
    },

    // Menu events — no native menu in browser
    onMenuPaste: () => noop,
    onMenuOpen: () => noop,
    onMenuSave: () => noop,
    onMenuSaveAs: () => noop,
    onMenuSaveAndClose: () => noop,
    onMenuToggleFocusMode: () => noop,
    onMenuNewFile: () => noop,
    onMenuExportHtml: () => noop,
    onMenuExportPdf: () => noop,
  };
}
