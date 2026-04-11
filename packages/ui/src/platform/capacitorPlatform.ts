import type { PennivoPlatform } from './platform';

const noop = () => {};

function notSupported(feature: string): never {
  throw new Error(`Not supported on Android yet: ${feature}`);
}

// Dynamic imports — only resolved at runtime on Android, never bundled for desktop
async function getFilesystem() {
  const { Filesystem, Directory, Encoding } = await import(
    '@capacitor/filesystem'
  );
  return { Filesystem, Directory, Encoding };
}

async function getPreferences() {
  const { Preferences } = await import('@capacitor/preferences');
  return { Preferences };
}

// Preference key constants
const PREF_RECENT_FILES = 'pennivo_recent_files';
const PREF_SETTINGS = 'pennivo_settings';
const PREF_TOOLBAR_CONFIG = 'pennivo_toolbar_config';
const MAX_RECENT_FILES = 10;

export function createCapacitorPlatform(): PennivoPlatform {
  return {
    platformName: 'capacitor',

    // Platform info
    platform: 'capacitor',
    getPathForFile: () => '',

    // Window controls — no-op on mobile
    minimize: noop,
    maximize: noop,
    close: noop,
    setFullScreen: noop,
    isFullScreen: () => Promise.resolve(false),

    // Clipboard / zoom — no-op on mobile
    paste: noop,
    zoomIn: noop,
    zoomOut: noop,
    resetZoom: noop,

    // External links
    openExternal: (url) => {
      // TODO: implement with Capacitor Browser plugin
      window.open(url, '_blank');
    },

    // File I/O
    saveImage: (_filePath, _buffer, _mimeType) => {
      notSupported('saveImage');
    },
    pickImage: (_filePath) => {
      notSupported('pickImage');
    },

    openFile: async () => {
      // TODO Phase 11: implement Android SAF document picker
      return null;
    },

    saveFile: async (filePath, content) => {
      try {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        await Filesystem.writeFile({
          path: filePath,
          data: content,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        return true;
      } catch (err) {
        console.error('[Pennivo] saveFile failed:', err);
        return false;
      }
    },

    saveFileAs: async (content, _defaultPath?) => {
      // TODO Phase 11: implement SAF CREATE_DOCUMENT
      try {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        const filename = `pennivo-${Date.now()}.md`;
        await Filesystem.writeFile({
          path: filename,
          data: content,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        return filename;
      } catch (err) {
        console.error('[Pennivo] saveFileAs failed:', err);
        return null;
      }
    },

    confirmDiscard: async () => {
      // TODO Phase 11: implement native confirmation dialog
      // Return 1 (discard) — auto-save handles persistence on mobile
      return 1;
    },

    setDirty: noop, // No window chrome on mobile
    closeAfterSave: noop, // No window chrome on mobile

    // Recent files
    getRecentFiles: async () => {
      try {
        const { Preferences } = await getPreferences();
        const { value } = await Preferences.get({ key: PREF_RECENT_FILES });
        if (!value) return [];
        return JSON.parse(value) as string[];
      } catch (err) {
        console.error('[Pennivo] getRecentFiles failed:', err);
        return [];
      }
    },

    addRecentFile: async (filePath) => {
      try {
        const { Preferences } = await getPreferences();
        const { value } = await Preferences.get({ key: PREF_RECENT_FILES });
        const existing: string[] = value ? JSON.parse(value) : [];
        const filtered = existing.filter((p) => p !== filePath);
        const updated = [filePath, ...filtered].slice(0, MAX_RECENT_FILES);
        await Preferences.set({
          key: PREF_RECENT_FILES,
          value: JSON.stringify(updated),
        });
        return updated;
      } catch (err) {
        console.error('[Pennivo] addRecentFile failed:', err);
        return [];
      }
    },

    clearRecentFiles: async () => {
      try {
        const { Preferences } = await getPreferences();
        await Preferences.set({
          key: PREF_RECENT_FILES,
          value: JSON.stringify([]),
        });
        return [];
      } catch (err) {
        console.error('[Pennivo] clearRecentFiles failed:', err);
        return [];
      }
    },

    openFilePath: async (filePath) => {
      try {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        const result = await Filesystem.readFile({
          path: filePath,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        const data =
          typeof result.data === 'string'
            ? result.data
            : await (result.data as Blob).text();
        return { filePath, content: data, fileSize: data.length };
      } catch (err) {
        console.error('[Pennivo] openFilePath failed:', err);
        return null;
      }
    },

    // Export — not supported yet
    exportHtml: (_html, _title) => {
      notSupported('exportHtml');
    },
    exportPdf: (_html, _title) => {
      notSupported('exportPdf');
    },

    // Window title — no-op, managed by mobile shell
    setTitle: noop,

    // Sidebar — not supported yet
    getSidebarFolder: () => {
      notSupported('getSidebarFolder');
    },
    setSidebarFolder: (_folderPath) => {
      notSupported('setSidebarFolder');
    },
    chooseSidebarFolder: () => {
      notSupported('chooseSidebarFolder');
    },
    readDirectory: (_folderPath) => {
      notSupported('readDirectory');
    },
    onSidebarFolderChanged: (_cb) => {
      notSupported('onSidebarFolderChanged');
    },

    // Toolbar config
    getToolbarConfig: async () => {
      try {
        const { Preferences } = await getPreferences();
        const { value } = await Preferences.get({ key: PREF_TOOLBAR_CONFIG });
        if (!value) return null;
        return JSON.parse(value) as string[];
      } catch (err) {
        console.error('[Pennivo] getToolbarConfig failed:', err);
        return null;
      }
    },

    setToolbarConfig: async (actions) => {
      try {
        const { Preferences } = await getPreferences();
        await Preferences.set({
          key: PREF_TOOLBAR_CONFIG,
          value: JSON.stringify(actions),
        });
      } catch (err) {
        console.error('[Pennivo] setToolbarConfig failed:', err);
      }
    },

    // Spellcheck — not supported yet
    getSpellCheckLanguages: () => {
      notSupported('getSpellCheckLanguages');
    },
    getAvailableSpellLanguages: () => {
      notSupported('getAvailableSpellLanguages');
    },
    setSpellCheckLanguages: (_languages) => {
      notSupported('setSpellCheckLanguages');
    },
    addWordToDictionary: (_word) => {
      notSupported('addWordToDictionary');
    },

    // Settings
    getSettings: async () => {
      try {
        const { Preferences } = await getPreferences();
        const { value } = await Preferences.get({ key: PREF_SETTINGS });
        if (!value) return {};
        return JSON.parse(value) as Record<string, unknown>;
      } catch (err) {
        console.error('[Pennivo] getSettings failed:', err);
        return {};
      }
    },

    setSettings: async (settings) => {
      try {
        const { Preferences } = await getPreferences();
        const { value } = await Preferences.get({ key: PREF_SETTINGS });
        const existing: Record<string, unknown> = value
          ? JSON.parse(value)
          : {};
        const merged = { ...existing, ...settings };
        await Preferences.set({
          key: PREF_SETTINGS,
          value: JSON.stringify(merged),
        });
      } catch (err) {
        console.error('[Pennivo] setSettings failed:', err);
      }
    },

    // App info
    getAppInfo: async () => {
      return { version: '0.1.0', name: 'Pennivo' };
    },

    // File-from-OS — no-op on mobile
    getPendingFilePath: () => Promise.resolve(null),
    onFileOpenFromOS: (_cb) => noop,

    // Auto-update — no-op on mobile (handled by app stores)
    onUpdateAvailable: (_cb) => noop,
    installUpdate: noop,

    // Menu events — no-op on mobile (no native menu bar)
    onMenuPaste: (_cb) => noop,
    onMenuOpen: (_cb) => noop,
    onMenuSave: (_cb) => noop,
    onMenuSaveAs: (_cb) => noop,
    onMenuSaveAndClose: (_cb) => noop,
    onMenuToggleFocusMode: (_cb) => noop,
    onMenuNewFile: (_cb) => noop,
    onMenuExportHtml: (_cb) => noop,
    onMenuExportPdf: (_cb) => noop,
  };
}
