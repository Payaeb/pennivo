import type { PennivoPlatform } from './platform';
import { wrapHtmlWithStyles } from '../utils/exportHtml';

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

/**
 * Share an HTML file via the Android share sheet using the Web Share API.
 * Falls back to opening the HTML in a new tab if sharing is unavailable.
 */
async function shareHtmlFile(
  styledHtml: string,
  fileName: string,
): Promise<string | null> {
  const blob = new Blob([styledHtml], { type: 'text/html' });
  const file = new File([blob], fileName, { type: 'text/html' });

  // Prefer Web Share API with file support (available on modern Android WebViews)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: fileName,
      });
      return fileName;
    } catch (err) {
      // User cancelled the share — not an error
      if (err instanceof Error && err.name === 'AbortError') {
        return null;
      }
      console.error('[Pennivo] Web Share failed:', err);
    }
  }

  // Fallback: write to Documents via Capacitor Filesystem and notify user
  try {
    const { Filesystem, Directory, Encoding } = await getFilesystem();
    await Filesystem.writeFile({
      path: fileName,
      data: styledHtml,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return fileName;
  } catch (err) {
    console.error('[Pennivo] exportHtml fallback write failed:', err);
    return null;
  }
}

/**
 * Trigger the Android print dialog (which includes "Save as PDF") by
 * rendering styled HTML in a hidden iframe and calling print on it.
 */
function printHtmlAsPdf(styledHtml: string): Promise<string | null> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-10000px';
    iframe.style.left = '-10000px';
    iframe.style.width = '800px';
    iframe.style.height = '600px';
    iframe.style.border = 'none';

    const cleanup = () => {
      if (iframe.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
    };

    iframe.onload = () => {
      try {
        const iframeWindow = iframe.contentWindow;
        if (!iframeWindow) {
          cleanup();
          resolve(null);
          return;
        }

        // Give the content a moment to render, then trigger print
        setTimeout(() => {
          try {
            iframeWindow.print();
            // The print dialog is modal on Android — when it returns,
            // the user has either printed/saved or cancelled.
            // Clean up after a brief delay to let the print dialog finish.
            setTimeout(cleanup, 1000);
            resolve('pdf');
          } catch (printErr) {
            console.error('[Pennivo] print() failed:', printErr);
            cleanup();
            resolve(null);
          }
        }, 300);
      } catch (err) {
        console.error('[Pennivo] iframe print setup failed:', err);
        cleanup();
        resolve(null);
      }
    };

    document.body.appendChild(iframe);

    // Write the styled HTML into the iframe
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(styledHtml);
      doc.close();
    } else {
      // If contentDocument is not available, use srcdoc
      iframe.srcdoc = styledHtml;
    }
  });
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

/**
 * Compress a data URL via canvas: downscale to a max edge and re-encode as JPEG.
 * Used to keep embedded images small enough to avoid the document lock guard
 * and to keep editor performance reasonable. Falls back to the original data URL
 * if the canvas path fails or produces a larger result.
 */
async function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX_DIM = 2048;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const scale = MAX_DIM / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      try {
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.82);
        // If compression made it bigger (e.g. small PNG), keep the original.
        resolve(compressed.length < dataUrl.length ? compressed : dataUrl);
      } catch (err) {
        console.warn('[Pennivo] compressImage drawImage failed:', err);
        resolve(dataUrl);
      }
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Opens the system image picker (gallery + camera) using a hidden <input type="file">.
 * Capacitor WebViews delegate image inputs to the native Android image picker, which
 * offers "Choose from gallery" and "Take a photo" options.
 *
 * Returns a data URL that can be embedded directly in markdown as an image src.
 * Handles cancellation gracefully (returns null).
 *
 * Images are compressed client-side (downscale to 2048px max edge, JPEG @ 0.82)
 * unless already small (< 500KB) or animated (image/gif). This keeps the data
 * URL under the document lock threshold so the editor doesn't flip to source mode.
 */
function pickImageViaInput(): Promise<{
  relativePath: string;
  absolutePath: string;
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    // Intentionally no `capture` attribute — that would force camera-only mode.
    // With just accept="image/*", Android shows both gallery and camera options.
    input.style.display = 'none';

    let settled = false;

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onWindowFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onChange = () => {
      if (settled) return;
      settled = true;
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl =
          typeof reader.result === 'string' ? reader.result : null;
        cleanup();
        if (!dataUrl) {
          resolve(null);
          return;
        }
        // Skip compression for GIFs (would lose animation) and for small images
        // (< 500KB) to preserve quality. Everything else gets downscaled+re-encoded.
        const isGif = file.type === 'image/gif';
        const isSmall = file.size < 500 * 1024;
        let finalDataUrl = dataUrl;
        if (!isGif && !isSmall) {
          try {
            finalDataUrl = await compressImage(dataUrl);
          } catch (err) {
            console.warn(
              '[Pennivo] compressImage failed, using original:',
              err,
            );
            finalDataUrl = dataUrl;
          }
        }
        // Desktop returns { relativePath, absolutePath } where the caller uses
        // absolutePath to build a pennivo-file:// URL. On mobile there is no
        // local filesystem reference, so we hand back the data URL in both
        // fields — callers that know they're on mobile will use it directly.
        resolve({ relativePath: finalDataUrl, absolutePath: finalDataUrl });
      };
      reader.onerror = () => {
        console.error('[Pennivo] pickImage FileReader failed:', reader.error);
        cleanup();
        resolve(null);
      };
      reader.readAsDataURL(file);
    };

    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    // Fallback: if the user dismisses the picker, focus returns to the window
    // without a change event. Delayed focus handler catches this.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, 500);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Opens the system file picker (SAF on Android) using a hidden <input type="file">.
 * Capacitor WebViews delegate file inputs to the native picker, so this triggers
 * the full Android SAF document picker without needing a third-party plugin.
 */
function pickFileViaSAF(): Promise<{
  filePath: string;
  content: string;
  name: string;
} | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.md,.markdown,.txt,text/markdown,text/plain';
    input.style.display = 'none';

    let settled = false;

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onWindowFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const onChange = async () => {
      if (settled) return;
      settled = true;
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      try {
        const content = await file.text();
        const name = file.name || 'imported.md';
        cleanup();
        resolve({ filePath: name, content, name });
      } catch (err) {
        console.error('[Pennivo] pickFileViaSAF read failed:', err);
        cleanup();
        resolve(null);
      }
    };

    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    // Fallback: if the user dismisses the picker, the window regains focus
    // but no change event fires. Use a delayed focus handler as backup.
    const onWindowFocus = () => {
      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(null);
        }
      }, 500);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onWindowFocus);

    document.body.appendChild(input);
    input.click();
  });
}

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
    pickImage: (_filePath) => pickImageViaInput(),

    openFile: async () => {
      // On Android, openFile delegates to the SAF picker
      const result = await pickFileViaSAF();
      if (!result) return null;
      return {
        filePath: result.filePath,
        content: result.content,
        fileSize: result.content.length,
      };
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

    // Export
    exportHtml: async (html, title) => {
      const styledHtml = wrapHtmlWithStyles(html, title);
      const fileName = title.replace(/\.md$/i, '') + '.html';
      return shareHtmlFile(styledHtml, fileName);
    },

    exportPdf: async (html, title) => {
      const styledHtml = wrapHtmlWithStyles(html, title);
      return printHtmlAsPdf(styledHtml);
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

    // External file import (mobile SAF picker)
    pickExternalFile: () => pickFileViaSAF(),

    // File management (mobile)
    listFiles: async (_directory?: string) => {
      try {
        const { Filesystem, Directory } = await getFilesystem();
        const result = await Filesystem.readdir({
          path: _directory || '',
          directory: Directory.Documents,
        });
        const mdFiles = result.files.filter(
          (f) => f.type === 'file' && f.name.endsWith('.md'),
        );
        const entries = mdFiles.map((f) => ({
          name: f.name,
          path: _directory ? `${_directory}/${f.name}` : f.name,
          modified: f.mtime ? new Date(f.mtime).getTime() : 0,
          size: f.size ?? 0,
        }));
        entries.sort((a, b) => b.modified - a.modified);
        return entries;
      } catch (err) {
        console.error('[Pennivo] listFiles failed:', err);
        return [];
      }
    },

    createFile: async (fileName) => {
      try {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        const safeName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
        await Filesystem.writeFile({
          path: safeName,
          data: '',
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        return { filePath: safeName, content: '' };
      } catch (err) {
        console.error('[Pennivo] createFile failed:', err);
        return null;
      }
    },

    deleteFile: async (filePath) => {
      try {
        const { Filesystem, Directory } = await getFilesystem();
        await Filesystem.deleteFile({
          path: filePath,
          directory: Directory.Documents,
        });
        return true;
      } catch (err) {
        console.error('[Pennivo] deleteFile failed:', err);
        return false;
      }
    },

    renameFile: async (oldPath, newName) => {
      try {
        const { Filesystem, Directory, Encoding } = await getFilesystem();
        const safeName = newName.endsWith('.md') ? newName : `${newName}.md`;
        // Read old file
        const result = await Filesystem.readFile({
          path: oldPath,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
        });
        const data =
          typeof result.data === 'string'
            ? result.data
            : await (result.data as Blob).text();
        // Write to new path
        await Filesystem.writeFile({
          path: safeName,
          data,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        // Delete old file
        await Filesystem.deleteFile({
          path: oldPath,
          directory: Directory.Documents,
        });
        return safeName;
      } catch (err) {
        console.error('[Pennivo] renameFile failed:', err);
        return null;
      }
    },

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
