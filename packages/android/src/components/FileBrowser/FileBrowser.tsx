import { useState, useEffect, useCallback, useRef } from "react";
import { getPlatform, COLOR_SCHEMES } from "@pennivo/ui";
import type { Theme, ColorScheme } from "@pennivo/ui";
import "./FileBrowser.css";

interface FileEntry {
  name: string;
  path: string;
  modified: number;
  size: number;
}

export interface FileBrowserProps {
  onOpenFile: (filePath: string) => void;
  onNewFile: (filePath: string) => void;
  currentFilePath: string | null;
  themeMode: Theme;
  colorScheme: ColorScheme;
  onColorSchemeChange: (scheme: ColorScheme) => void;
  onModeChange: (mode: Theme) => void;
  onOpenSettings?: () => void;
}

type ContextMenu = {
  file: FileEntry;
  x: number;
  y: number;
} | null;

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return (
      "Today, " +
      date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    );
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function FileBrowser({
  onOpenFile,
  onNewFile,
  currentFilePath,
  themeMode,
  colorScheme,
  onColorSchemeChange,
  onModeChange,
  onOpenSettings,
}: FileBrowserProps) {
  const platform = getPlatform();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenu>(null);
  const [renamingFile, setRenamingFile] = useState<FileEntry | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Pull-to-refresh state
  const pullStartY = useRef(0);
  const pullDelta = useRef(0);
  const isPulling = useRef(false);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const [result, recentResult] = await Promise.all([
        platform.listFiles(),
        platform.getRecentFiles(),
      ]);
      setFiles(result);
      setRecentPaths(recentResult);
    } catch (err) {
      console.error("[Pennivo] Failed to list files:", err);
    } finally {
      setLoading(false);
    }
  }, [platform]);

  // Load files on mount
  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  // Focus new file input when shown
  useEffect(() => {
    if (showNewInput && newInputRef.current) {
      newInputRef.current.focus();
    }
  }, [showNewInput]);

  // Focus rename input when shown
  useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  // Close context menu on backdrop tap
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [contextMenu]);

  // Pull-to-refresh handlers
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop <= 0) {
        pullStartY.current = e.touches[0]!.clientY;
        isPulling.current = true;
        pullDelta.current = 0;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!isPulling.current) return;
      const delta = e.touches[0]!.clientY - pullStartY.current;
      if (delta > 0 && el.scrollTop <= 0) {
        pullDelta.current = delta;
        const indicator = el.querySelector(".file-browser__pull-indicator") as HTMLElement | null;
        if (indicator) {
          const progress = Math.min(delta / 80, 1);
          indicator.style.height = `${Math.min(delta * 0.5, 48)}px`;
          indicator.style.opacity = `${progress}`;
        }
      } else {
        isPulling.current = false;
      }
    };

    const onTouchEnd = async () => {
      if (!isPulling.current) return;
      isPulling.current = false;

      const indicator = el.querySelector(".file-browser__pull-indicator") as HTMLElement | null;

      if (pullDelta.current > 80) {
        setRefreshing(true);
        if (indicator) {
          indicator.style.height = "36px";
          indicator.style.opacity = "1";
        }
        await loadFiles();
        setRefreshing(false);
      }

      if (indicator) {
        indicator.style.height = "0px";
        indicator.style.opacity = "0";
      }
      pullDelta.current = 0;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, [loadFiles]);

  const handleOpenFile = useCallback(
    (filePath: string) => {
      setContextMenu(null);
      onOpenFile(filePath);
    },
    [onOpenFile],
  );

  const handleNewFileStart = useCallback(() => {
    setNewFileName("");
    setShowNewInput(true);
  }, []);

  const handleNewFileConfirm = useCallback(async () => {
    const name = newFileName.trim();
    if (!name) return;
    const result = await platform.createFile(name);
    if (result) {
      setShowNewInput(false);
      setNewFileName("");
      onNewFile(result.filePath);
    }
  }, [newFileName, platform, onNewFile]);

  const handleNewFileCancel = useCallback(() => {
    setShowNewInput(false);
    setNewFileName("");
  }, []);

  const handleNewFileKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleNewFileConfirm();
      if (e.key === "Escape") handleNewFileCancel();
    },
    [handleNewFileConfirm, handleNewFileCancel],
  );

  const handleContextMenu = useCallback(
    (file: FileEntry, e: React.MouseEvent | React.PointerEvent) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setContextMenu({
        file,
        x: Math.min(rect.right, window.innerWidth - 176),
        y: rect.bottom + 4,
      });
    },
    [],
  );

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;
    const file = contextMenu.file;
    setContextMenu(null);

    const confirmed = window.confirm(
      `Delete "${file.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    const success = await platform.deleteFile(file.path);
    if (success) {
      if (currentFilePath === file.path) {
        const result = await platform.createFile("untitled");
        if (result) {
          onNewFile(result.filePath);
        }
      }
      loadFiles();
    }
  }, [contextMenu, platform, currentFilePath, onNewFile, loadFiles]);

  const handleRenameStart = useCallback(() => {
    if (!contextMenu) return;
    const file = contextMenu.file;
    setContextMenu(null);
    setRenamingFile(file);
    setRenameValue(file.name.replace(/\.md$/i, ""));
  }, [contextMenu]);

  const handleRenameConfirm = useCallback(async () => {
    if (!renamingFile) return;
    const name = renameValue.trim();
    if (!name) return;

    const newPath = await platform.renameFile(renamingFile.path, name);
    if (newPath) {
      if (currentFilePath === renamingFile.path) {
        onOpenFile(newPath);
      }
      setRenamingFile(null);
      setRenameValue("");
      loadFiles();
    }
  }, [renamingFile, renameValue, platform, currentFilePath, onOpenFile, loadFiles]);

  const handleRenameCancel = useCallback(() => {
    setRenamingFile(null);
    setRenameValue("");
  }, []);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRenameConfirm();
      if (e.key === "Escape") handleRenameCancel();
    },
    [handleRenameConfirm, handleRenameCancel],
  );

  // Auto-dismiss import status toast
  useEffect(() => {
    if (!importStatus) return;
    const timer = setTimeout(() => setImportStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [importStatus]);

  const handleImportFile = useCallback(async () => {
    try {
      const result = await platform.pickExternalFile();
      if (!result) return; // User cancelled

      // Determine a safe local filename (avoid collisions)
      let localName = result.name;
      if (!localName.endsWith('.md') && !localName.endsWith('.markdown') && !localName.endsWith('.txt')) {
        localName = localName + '.md';
      }

      // Save imported content to Documents directory
      const saved = await platform.saveFile(localName, result.content);
      if (saved) {
        setImportStatus(`Imported "${localName}"`);
        await loadFiles();
        onOpenFile(localName);
      } else {
        setImportStatus('Import failed');
      }
    } catch (err) {
      console.error('[Pennivo] Import file failed:', err);
      setImportStatus('Import failed');
    }
  }, [platform, loadFiles, onOpenFile]);

  // Build recent files list: only files that exist on disk, preserving recency order
  const fileMap = new Map(files.map((f) => [f.path, f]));
  const recentFiles: FileEntry[] = [];
  const recentPathSet = new Set<string>();
  for (const rp of recentPaths) {
    const entry = fileMap.get(rp);
    if (entry && !recentPathSet.has(rp)) {
      recentFiles.push(entry);
      recentPathSet.add(rp);
    }
  }

  // Remaining files not in recent, sorted by modified desc
  const otherFiles = files.filter((f) => !recentPathSet.has(f.path));

  const renderFileRow = (file: FileEntry) => {
    if (renamingFile && renamingFile.path === file.path) {
      return (
        <div key={file.path} className="file-browser__rename-row" role="listitem">
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={handleRenameCancel}
            placeholder="New name"
            aria-label="Rename file"
          />
          <button
            className="file-browser__inline-input-confirm"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleRenameConfirm}
            aria-label="Confirm rename"
            type="button"
          >
            <CheckIcon />
          </button>
          <button
            className="file-browser__inline-input-cancel"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleRenameCancel}
            aria-label="Cancel rename"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      );
    }

    return (
      <div
        key={file.path}
        className={`file-browser__item ${currentFilePath === file.path ? "file-browser__item--current" : ""}`}
        onClick={() => handleOpenFile(file.path)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenFile(file.path); } }}
        role="listitem"
        tabIndex={0}
        aria-current={currentFilePath === file.path ? "true" : undefined}
        aria-label={`${file.name.replace(/\.md$/i, "")}, ${formatDate(file.modified)}${file.size > 0 ? `, ${formatSize(file.size)}` : ""}`}
      >
        <FileIcon />
        <div className="file-browser__item-info">
          <div className="file-browser__item-name">
            {file.name.replace(/\.md$/i, "")}
          </div>
          <div className="file-browser__item-meta">
            {formatDate(file.modified)}
            {file.size > 0 ? ` \u00B7 ${formatSize(file.size)}` : ""}
          </div>
        </div>
        <button
          className="file-browser__item-menu-btn"
          onClick={(e) => {
            e.stopPropagation();
            handleContextMenu(file, e);
          }}
          aria-label={`Options for ${file.name}`}
          type="button"
        >
          <MoreVertIcon />
        </button>
      </div>
    );
  };

  return (
    <div className="file-browser">
      {/* Header */}
      <div className="file-browser__header">
        <h2 className="file-browser__title">Files</h2>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button
            className="mobile-theme-btn"
            onClick={() => setShowThemePicker((v) => !v)}
            aria-label="Theme settings"
            aria-expanded={showThemePicker}
            type="button"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="10" cy="10" r="4" />
              <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
            </svg>
          </button>
          {onOpenSettings && (
            <button
              className="mobile-command-btn"
              onClick={onOpenSettings}
              aria-label="Settings"
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="10" cy="10" r="2.5" />
                <path d="M16.2 12.2a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.35v.15a1.8 1.8 0 1 1-3.6 0v-.08a1.5 1.5 0 0 0-1-1.35 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.35-.9H1.4a1.8 1.8 0 1 1 0-3.6h.08a1.5 1.5 0 0 0 1.35-1 1.5 1.5 0 0 0-.3-1.65l-.05-.05a1.8 1.8 0 1 1 2.55-2.55l.05.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.35V1.4a1.8 1.8 0 1 1 3.6 0v.08a1.5 1.5 0 0 0 .9 1.35 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.35.9h.15a1.8 1.8 0 1 1 0 3.6h-.08a1.5 1.5 0 0 0-1.35.9z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Theme picker panel */}
      {showThemePicker && (
        <div
          className="mobile-theme-picker-backdrop"
          onClick={() => setShowThemePicker(false)}
        >
          <div
            className="mobile-theme-picker"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Theme settings"
          >
            <div className="mobile-theme-picker__section">
              <div className="mobile-theme-picker__label">Mode</div>
              <div className="mobile-theme-picker__options">
                <button
                  className={`mobile-theme-picker__option ${themeMode === "light" ? "mobile-theme-picker__option--active" : ""}`}
                  onClick={() => onModeChange("light")}
                  type="button"
                >
                  <span className="mobile-theme-picker__swatch mobile-theme-picker__swatch--light" />
                  Light
                </button>
                <button
                  className={`mobile-theme-picker__option ${themeMode === "dark" ? "mobile-theme-picker__option--active" : ""}`}
                  onClick={() => onModeChange("dark")}
                  type="button"
                >
                  <span className="mobile-theme-picker__swatch mobile-theme-picker__swatch--dark" />
                  Dark
                </button>
              </div>
            </div>
            <div className="mobile-theme-picker__section">
              <div className="mobile-theme-picker__label">Color Scheme</div>
              <div className="mobile-theme-picker__options">
                {COLOR_SCHEMES.map((scheme) => (
                  <button
                    key={scheme.id}
                    className={`mobile-theme-picker__option ${colorScheme === scheme.id ? "mobile-theme-picker__option--active" : ""}`}
                    onClick={() => onColorSchemeChange(scheme.id)}
                    type="button"
                  >
                    <span className={`mobile-theme-picker__swatch mobile-theme-picker__swatch--${scheme.id}`} />
                    {scheme.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="file-browser__actions">
        <button
          className="file-browser__new-btn"
          onClick={handleNewFileStart}
          type="button"
        >
          <PlusIcon />
          New File
        </button>
        <button
          className="file-browser__import-btn"
          onClick={handleImportFile}
          type="button"
        >
          <ImportIcon />
          Import
        </button>
      </div>

      {/* New file input */}
      {showNewInput && (
        <div className="file-browser__inline-input">
          <input
            ref={newInputRef}
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={handleNewFileKeyDown}
            onBlur={handleNewFileCancel}
            placeholder="File name"
            aria-label="New file name"
          />
          <button
            className="file-browser__inline-input-confirm"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleNewFileConfirm}
            aria-label="Create file"
            type="button"
          >
            <CheckIcon />
          </button>
          <button
            className="file-browser__inline-input-cancel"
            onPointerDown={(e) => e.preventDefault()}
            onClick={handleNewFileCancel}
            aria-label="Cancel"
            type="button"
          >
            <CloseIcon />
          </button>
        </div>
      )}

      {/* File list */}
      <div className="file-browser__list" ref={listRef} role="list" aria-label="Files">
        {/* Pull-to-refresh indicator */}
        <div className="file-browser__pull-indicator" aria-hidden="true">
          {refreshing ? (
            <span className="file-browser__pull-spinner" />
          ) : (
            <PullArrowIcon />
          )}
        </div>

        {loading && files.length === 0 && (
          <div className="file-browser__empty" role="status">
            <span className="file-browser__empty-text">Loading files...</span>
          </div>
        )}

        {!loading && files.length === 0 && (
          <div className="file-browser__empty">
            <FileEmptyIcon />
            <span className="file-browser__empty-text">
              No documents yet. Tap + to create one.
            </span>
          </div>
        )}

        {/* Recent files section */}
        {recentFiles.length > 0 && (
          <>
            <div className="file-browser__section-label" id="recent-files-label">Recent</div>
            <div role="group" aria-labelledby="recent-files-label">
              {recentFiles.map(renderFileRow)}
            </div>
          </>
        )}

        {/* All other files */}
        {otherFiles.length > 0 && (
          <>
            {recentFiles.length > 0 && (
              <div className="file-browser__section-label" id="all-files-label">All Files</div>
            )}
            <div role="group" aria-labelledby={recentFiles.length > 0 ? "all-files-label" : undefined}>
              {otherFiles.map(renderFileRow)}
            </div>
          </>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="file-browser__context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
          aria-label={`Actions for ${contextMenu.file.name}`}
        >
          <button
            className="file-browser__context-action"
            onClick={handleRenameStart}
            type="button"
            role="menuitem"
          >
            <RenameIcon />
            Rename
          </button>
          <button
            className="file-browser__context-action file-browser__context-action--danger"
            onClick={handleDelete}
            type="button"
            role="menuitem"
          >
            <DeleteIcon />
            Delete
          </button>
        </div>
      )}

      {/* Import status toast */}
      {importStatus && (
        <div className="file-browser__toast" role="status" aria-live="polite">
          {importStatus}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline SVG Icons                                                   */
/* ------------------------------------------------------------------ */

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="5" y1="5" x2="15" y2="15" />
      <line x1="15" y1="5" x2="5" y2="15" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="3" y1="8" x2="13" y2="8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,10 7,14 15,5" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      className="file-browser__item-icon"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 2h7l4 4v12a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <polyline points="12,2 12,6 16,6" />
      <line x1="7" y1="10" x2="13" y2="10" />
      <line x1="7" y1="13" x2="11" y2="13" />
    </svg>
  );
}

function FileEmptyIcon() {
  return (
    <svg
      className="file-browser__empty-icon"
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4h16l10 10v28a2 2 0 01-2 2H12a2 2 0 01-2-2V6a2 2 0 012-2z" />
      <polyline points="28,4 28,14 38,14" />
    </svg>
  );
}

function MoreVertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="8" cy="3.5" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="8" cy="12.5" r="1.3" />
    </svg>
  );
}

function RenameIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5l3 3-9 9H2.5v-3z" />
      <line x1="9" y1="4" x2="12" y2="7" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 4h12" />
      <path d="M5 4V2.5A.5.5 0 015.5 2h5a.5.5 0 01.5.5V4" />
      <path d="M3.5 4l.7 9.5a1 1 0 001 .5h5.6a1 1 0 001-.5L12.5 4" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 10v3a1 1 0 01-1 1H3a1 1 0 01-1-1v-3" />
      <polyline points="4,6 8,2 12,6" />
      <line x1="8" y1="2" x2="8" y2="11" />
    </svg>
  );
}

function PullArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="8" y1="2" x2="8" y2="14" />
      <polyline points="3,9 8,14 13,9" />
    </svg>
  );
}
