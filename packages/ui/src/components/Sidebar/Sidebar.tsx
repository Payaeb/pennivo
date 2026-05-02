import { useState, useCallback, useRef, useEffect } from "react";
import {
  type SidebarSortKey,
  SORT_OPTIONS,
  DEFAULT_SORT,
} from "../../utils/sortTree";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu/ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import "./Sidebar.css";

interface SidebarProps {
  visible: boolean;
  folderPath: string | null;
  tree: FileTreeEntry[];
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  onChooseFolder: () => void;
  sortKey?: SidebarSortKey;
  onSortChange?: (key: SidebarSortKey) => void;
  /** "Show in Explorer / Finder / Files" — reveal in OS file manager. */
  onShowInExplorer?: (filePath: string) => void;
  /** Rename a file. Returns the new path on success, or null on failure (e.g. name collision). */
  onRenameFile?: (oldPath: string, newName: string) => Promise<string | null>;
  /** Delete a file. If includeAssets is true, also remove the file's
   *  owned `*-md-images/` folders. Returns true on success. */
  onDeleteFile?: (filePath: string, includeAssets: boolean) => Promise<boolean>;
  /** Look up how many asset files this .md owns — used to render
   *  "Also delete N asset(s)?" in the delete confirm dialog. Returns
   *  zeros if the platform doesn't support assets (web/mobile). */
  onGetAssetSummary?: (
    filePath: string,
  ) => Promise<{ folders: string[]; assetCount: number }>;
  /** Move a file into a different folder. Returns ok=false with reason="collision" if a file with the same name already exists in destDir; caller may retry with overwrite=true. */
  onMoveFile?: (
    srcPath: string,
    destDir: string,
    overwrite?: boolean,
  ) => Promise<{
    ok: boolean;
    newPath?: string;
    reason?: "collision" | "error";
  }>;
  /** Surface success / error feedback (e.g. "Path copied", "Rename failed"). */
  onShowToast?: (message: string, isError?: boolean) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;

function countFiles(entries: FileTreeEntry[]): number {
  let count = 0;
  for (const e of entries) {
    if (e.type === "file") count++;
    if (e.children) count += countFiles(e.children);
  }
  return count;
}

// Drop target for the workspace root (when dragging a file out of any folder).
const ROOT_DROP_TARGET = "__root__";

export function Sidebar({
  visible,
  folderPath,
  tree,
  currentFilePath,
  onFileClick,
  onChooseFolder,
  sortKey = DEFAULT_SORT,
  onSortChange,
  onShowInExplorer,
  onRenameFile,
  onDeleteFile,
  onGetAssetSummary,
  onMoveFile,
  onShowToast,
}: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // --- Context menu / rename / delete state (lifted to Sidebar root) ---
  const [contextMenu, setContextMenu] = useState<{
    entry: FileTreeEntry;
    x: number;
    y: number;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // pendingDelete carries both the entry and the asset-count summary fetched
  // on confirm-open, so the dialog can offer "Also delete N asset(s)?".
  const [pendingDelete, setPendingDelete] = useState<{
    entry: FileTreeEntry;
    assetCount: number;
  } | null>(null);
  const [includeAssetsOnDelete, setIncludeAssetsOnDelete] = useState(false);

  // --- Drag-and-drop state ---
  // draggingPath: which file is the source of the in-flight drag (for opacity).
  // dragOverPath: which folder/root is the current drop target (for highlight).
  // pendingMove: set when a move was attempted but hit a collision; used by
  // the "Replace existing?" dialog so user can retry with overwrite=true.
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    srcPath: string;
    destDir: string;
    destFilename: string;
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextMenuOpen = useCallback(
    (entry: FileTreeEntry, e: React.MouseEvent) => {
      // Only show menu when at least one action is available
      if (!onShowInExplorer && !onRenameFile && !onDeleteFile && !onShowToast) {
        return;
      }
      e.preventDefault();
      setContextMenu({ entry, x: e.clientX, y: e.clientY });
    },
    [onShowInExplorer, onRenameFile, onDeleteFile, onShowToast],
  );

  const handleCopyPath = useCallback(
    async (path: string) => {
      try {
        await navigator.clipboard.writeText(path);
        onShowToast?.("Path copied to clipboard");
      } catch {
        onShowToast?.("Could not copy to clipboard", true);
      }
    },
    [onShowToast],
  );

  const handleCopyFilename = useCallback(
    async (name: string) => {
      try {
        await navigator.clipboard.writeText(name);
        onShowToast?.("Filename copied to clipboard");
      } catch {
        onShowToast?.("Could not copy to clipboard", true);
      }
    },
    [onShowToast],
  );

  const handleRenameSubmit = useCallback(
    async (oldPath: string, newName: string) => {
      const trimmed = newName.trim();
      const oldName = oldPath.replace(/\\/g, "/").split("/").pop() ?? "";
      if (!trimmed || trimmed === oldName) {
        setRenamingPath(null);
        return;
      }
      if (!onRenameFile || trimmed.includes("/") || trimmed.includes("\\")) {
        onShowToast?.("Invalid filename", true);
        setRenamingPath(null);
        return;
      }
      const result = await onRenameFile(oldPath, trimmed);
      if (result === null) {
        onShowToast?.(
          "Rename failed — a file with that name may already exist",
          true,
        );
      }
      setRenamingPath(null);
    },
    [onRenameFile, onShowToast],
  );

  // Open the delete-confirm dialog for a file. Fetches the asset summary
  // first so the dialog can show "Also delete N asset(s)?".
  const openDeleteConfirm = useCallback(
    async (entry: FileTreeEntry) => {
      let assetCount = 0;
      if (onGetAssetSummary) {
        try {
          const summary = await onGetAssetSummary(entry.path);
          assetCount = summary.assetCount;
        } catch {
          // Fall through with assetCount=0; dialog just won't show the checkbox
        }
      }
      setIncludeAssetsOnDelete(false);
      setPendingDelete({ entry, assetCount });
    },
    [onGetAssetSummary],
  );

  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDelete || !onDeleteFile) {
      setPendingDelete(null);
      return;
    }
    const ok = await onDeleteFile(
      pendingDelete.entry.path,
      includeAssetsOnDelete,
    );
    if (!ok) {
      onShowToast?.("Delete failed", true);
    } else if (includeAssetsOnDelete && pendingDelete.assetCount > 0) {
      onShowToast?.(`Deleted file and ${pendingDelete.assetCount} asset(s)`);
    }
    setPendingDelete(null);
    setIncludeAssetsOnDelete(false);
  }, [pendingDelete, includeAssetsOnDelete, onDeleteFile, onShowToast]);

  // --- Drag-and-drop handlers ---

  const tryMove = useCallback(
    async (srcPath: string, destDir: string, overwrite: boolean) => {
      if (!onMoveFile) return;
      const result = await onMoveFile(srcPath, destDir, overwrite);
      if (result.ok) {
        const filename = srcPath.replace(/\\/g, "/").split("/").pop() ?? "";
        onShowToast?.(
          overwrite
            ? `Replaced "${filename}" in destination folder`
            : `Moved "${filename}"`,
        );
      } else if (result.reason === "collision") {
        const filename = srcPath.replace(/\\/g, "/").split("/").pop() ?? "";
        setPendingMove({ srcPath, destDir, destFilename: filename });
      } else {
        onShowToast?.("Move failed", true);
      }
    },
    [onMoveFile, onShowToast],
  );

  const handleDragStart = useCallback(
    (entry: FileTreeEntry, e: React.DragEvent) => {
      // Only files are draggable in v1
      if (entry.type !== "file" || !onMoveFile) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-pennivo-path", entry.path);
      // text/plain fallback for tools that read clipboard-like data
      e.dataTransfer.setData("text/plain", entry.path);
      setDraggingPath(entry.path);
    },
    [onMoveFile],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDragOverPath(null);
  }, []);

  const handleDragOverTarget = useCallback(
    (targetKey: string, e: React.DragEvent) => {
      if (!onMoveFile || !draggingPath) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverPath !== targetKey) setDragOverPath(targetKey);
    },
    [onMoveFile, draggingPath, dragOverPath],
  );

  const handleDragLeaveTarget = useCallback((targetKey: string) => {
    setDragOverPath((prev) => (prev === targetKey ? null : prev));
  }, []);

  const handleDropOnTarget = useCallback(
    async (destDir: string, e: React.DragEvent) => {
      if (!onMoveFile) return;
      e.preventDefault();
      const srcPath =
        e.dataTransfer.getData("application/x-pennivo-path") ||
        e.dataTransfer.getData("text/plain");
      setDraggingPath(null);
      setDragOverPath(null);
      if (!srcPath) return;

      // No-op: file already lives directly in this folder
      const srcDir = srcPath.replace(/\\/g, "/").replace(/\/[^/]+$/, "");
      const normalizedDest = destDir.replace(/\\/g, "/");
      if (srcDir.toLowerCase() === normalizedDest.toLowerCase()) return;

      await tryMove(srcPath, destDir, false);
    },
    [onMoveFile, tryMove],
  );

  const handleConfirmReplaceMove = useCallback(async () => {
    if (!pendingMove) return;
    const { srcPath, destDir } = pendingMove;
    setPendingMove(null);
    await tryMove(srcPath, destDir, true);
  }, [pendingMove, tryMove]);

  // Build the items list for the active context menu
  const contextMenuItems: ContextMenuEntry[] = (() => {
    if (!contextMenu) return [];
    const { entry } = contextMenu;
    const items: ContextMenuEntry[] = [];
    if (onShowInExplorer && entry.type === "file") {
      items.push({
        type: "item",
        label: showInOsLabel(),
        onClick: () => onShowInExplorer(entry.path),
      });
    }
    if (onRenameFile) {
      items.push({
        type: "item",
        label: "Rename",
        onClick: () => setRenamingPath(entry.path),
      });
    }
    if (items.length > 0 && (onShowToast || onDeleteFile)) {
      items.push({ type: "separator" });
    }
    if (onShowToast) {
      items.push({
        type: "item",
        label: "Copy Path",
        onClick: () => handleCopyPath(entry.path),
      });
      items.push({
        type: "item",
        label: "Copy Filename",
        onClick: () => handleCopyFilename(entry.name),
      });
    }
    if (onDeleteFile && entry.type === "file") {
      if (items.length > 0) items.push({ type: "separator" });
      items.push({
        type: "item",
        label: "Delete",
        danger: true,
        onClick: () => openDeleteConfirm(entry),
      });
    }
    return items;
  })();

  // --- Resize logic ---
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = sidebarRef.current?.offsetWidth ?? DEFAULT_WIDTH;

    const handleMouseMove = (me: MouseEvent) => {
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + (me.clientX - startX)),
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setResizing(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, []);

  if (!visible) return null;

  const folderName = folderPath
    ? folderPath.replace(/\\/g, "/").split("/").pop() || "Folder"
    : null;

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <div className="sidebar-header">
        <span className="sidebar-title" title={folderPath || undefined}>
          {folderName || "Files"}
        </span>
        {folderPath && tree.length > 0 && (
          <span className="sidebar-file-count">{countFiles(tree)}</span>
        )}
        {folderPath && onSortChange && (
          <SortMenu sortKey={sortKey} onSortChange={onSortChange} />
        )}
        <button
          className="sidebar-set-folder-btn"
          onClick={onChooseFolder}
          title="Set Folder"
        >
          <FolderOpenIcon />
        </button>
      </div>

      {folderPath && tree.length > 0 ? (
        <TreeContainer
          tree={tree}
          currentFilePath={currentFilePath}
          rootDir={folderPath}
          onFileClick={onFileClick}
          onContextMenuOpen={handleContextMenuOpen}
          renamingPath={renamingPath}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={() => setRenamingPath(null)}
          draggingPath={draggingPath}
          dragOverPath={dragOverPath}
          dragEnabled={!!onMoveFile}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOverTarget={handleDragOverTarget}
          onDragLeaveTarget={handleDragLeaveTarget}
          onDropOnTarget={handleDropOnTarget}
        />
      ) : (
        <div className="sidebar-empty">
          <FolderIllustrationIcon />
          <span className="sidebar-empty-text">
            {folderPath
              ? "No markdown files found"
              : "Open a folder to browse files"}
          </span>
          <button className="sidebar-open-folder-btn" onClick={onChooseFolder}>
            {folderPath ? "Change Folder" : "Open Folder"}
          </button>
          <span className="sidebar-empty-hint">
            {folderPath
              ? "Try a different folder"
              : "Drag a folder here or click to browse"}
          </span>
        </div>
      )}

      <div
        className={`sidebar-resize-handle${resizing ? " sidebar-resize-handle--active" : ""}`}
        onMouseDown={handleResizeStart}
      />

      {contextMenu && contextMenuItems.length > 0 && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={closeContextMenu}
          ariaLabel={`Actions for ${contextMenu.entry.name}`}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete file?"
        message={
          pendingDelete
            ? `"${pendingDelete.entry.name}" will be permanently deleted from disk. This cannot be undone.`
            : ""
        }
        confirmLabel={
          pendingDelete && includeAssetsOnDelete && pendingDelete.assetCount > 0
            ? `Delete file + ${pendingDelete.assetCount} asset${pendingDelete.assetCount === 1 ? "" : "s"}`
            : "Delete"
        }
        cancelLabel="Cancel"
        danger
        checkbox={
          pendingDelete && pendingDelete.assetCount > 0
            ? {
                label: `Also delete ${pendingDelete.assetCount} asset file${pendingDelete.assetCount === 1 ? "" : "s"} (the per-file image folder)`,
                checked: includeAssetsOnDelete,
                onChange: setIncludeAssetsOnDelete,
              }
            : undefined
        }
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setPendingDelete(null);
          setIncludeAssetsOnDelete(false);
        }}
      />

      <ConfirmDialog
        open={pendingMove !== null}
        title="Replace existing file?"
        message={
          pendingMove
            ? `A file named "${pendingMove.destFilename}" already exists in the destination folder. Replace it? This cannot be undone.`
            : ""
        }
        confirmLabel="Replace"
        cancelLabel="Cancel"
        danger
        onConfirm={handleConfirmReplaceMove}
        onCancel={() => setPendingMove(null)}
      />
    </div>
  );
}

function showInOsLabel(): string {
  if (typeof navigator === "undefined") return "Show in File Manager";
  const platform = navigator.platform?.toLowerCase() ?? "";
  if (platform.includes("mac")) return "Show in Finder";
  if (platform.includes("win")) return "Show in Explorer";
  return "Show in Files";
}

// --- Tree rendering with keyboard navigation ---

interface TreeContext {
  onContextMenuOpen?: (entry: FileTreeEntry, e: React.MouseEvent) => void;
  renamingPath: string | null;
  onRenameSubmit: (oldPath: string, newName: string) => void;
  onRenameCancel: () => void;
  // Drag-and-drop
  draggingPath: string | null;
  dragOverPath: string | null;
  dragEnabled: boolean;
  onDragStart: (entry: FileTreeEntry, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverTarget: (targetKey: string, e: React.DragEvent) => void;
  onDragLeaveTarget: (targetKey: string) => void;
  onDropOnTarget: (destDir: string, e: React.DragEvent) => void;
}

function TreeContainer({
  tree,
  currentFilePath,
  rootDir,
  onFileClick,
  onContextMenuOpen,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  draggingPath,
  dragOverPath,
  dragEnabled,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDragLeaveTarget,
  onDropOnTarget,
}: {
  tree: FileTreeEntry[];
  currentFilePath: string | null;
  rootDir: string;
  onFileClick: (filePath: string) => void;
} & TreeContext) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // Track expanded folders — default expand depth 0
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const e of tree) if (e.type === "folder") set.add(e.path);
    return set;
  });

  // Flatten visible items for keyboard navigation
  const flatItems = useCallback((): FileTreeEntry[] => {
    const items: FileTreeEntry[] = [];
    const walk = (entries: FileTreeEntry[]) => {
      for (const entry of entries) {
        items.push(entry);
        if (
          entry.type === "folder" &&
          expandedPaths.has(entry.path) &&
          entry.children
        ) {
          walk(entry.children);
        }
      }
    };
    walk(tree);
    return items;
  }, [tree, expandedPaths]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Find parent folder of an entry
  const findParent = useCallback(
    (
      targetPath: string,
      entries: FileTreeEntry[],
      parent: FileTreeEntry | null,
    ): FileTreeEntry | null => {
      for (const entry of entries) {
        if (entry.path === targetPath) return parent;
        if (entry.type === "folder" && entry.children) {
          const found = findParent(targetPath, entry.children, entry);
          if (found) return found;
        }
      }
      return null;
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = flatItems();
      if (items.length === 0) return;

      const currentIdx = focusedPath
        ? items.findIndex((i) => i.path === focusedPath)
        : -1;
      const current = currentIdx >= 0 ? items[currentIdx] : null;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const nextIdx = Math.min(currentIdx + 1, items.length - 1);
          setFocusedPath(items[nextIdx].path);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prevIdx = Math.max(currentIdx - 1, 0);
          setFocusedPath(items[prevIdx].path);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          if (current?.type === "folder") {
            if (!expandedPaths.has(current.path)) {
              toggleExpanded(current.path);
            } else if (current.children && current.children.length > 0) {
              setFocusedPath(current.children[0].path);
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (current?.type === "folder" && expandedPaths.has(current.path)) {
            toggleExpanded(current.path);
          } else if (current) {
            const parent = findParent(current.path, tree, null);
            if (parent) setFocusedPath(parent.path);
          }
          break;
        }
        case "Enter":
        case " ": {
          e.preventDefault();
          if (current?.type === "folder") {
            toggleExpanded(current.path);
          } else if (current) {
            onFileClick(current.path);
          }
          break;
        }
        case "Home": {
          e.preventDefault();
          if (items.length > 0) setFocusedPath(items[0].path);
          break;
        }
        case "End": {
          e.preventDefault();
          if (items.length > 0) setFocusedPath(items[items.length - 1].path);
          break;
        }
      }
    },
    [
      flatItems,
      focusedPath,
      expandedPaths,
      toggleExpanded,
      findParent,
      tree,
      onFileClick,
    ],
  );

  // Scroll focused item into view
  useEffect(() => {
    if (!focusedPath || !treeRef.current) return;
    const el = treeRef.current.querySelector(
      `[data-path="${CSS.escape(focusedPath)}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  }, [focusedPath]);

  const isRootDragOver = dragOverPath === ROOT_DROP_TARGET;

  return (
    <div
      className={`sidebar-tree${isRootDragOver ? " sidebar-tree--drag-over" : ""}`}
      ref={treeRef}
      role="tree"
      aria-label="File browser"
      onKeyDown={handleKeyDown}
      onDragOver={(e) => {
        if (!dragEnabled) return;
        // Only treat as a root-drop if the drag is over the bare tree
        // background, not a nested folder row (folder rows handle their own
        // dragOver via stopPropagation in handleDropOnTarget).
        if (e.currentTarget === e.target) {
          onDragOverTarget(ROOT_DROP_TARGET, e);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) {
          onDragLeaveTarget(ROOT_DROP_TARGET);
        }
      }}
      onDrop={(e) => {
        if (!dragEnabled) return;
        if (e.currentTarget === e.target) {
          onDropOnTarget(rootDir, e);
        }
      }}
    >
      <TreeNodes
        entries={tree}
        depth={0}
        currentFilePath={currentFilePath}
        onFileClick={onFileClick}
        expandedPaths={expandedPaths}
        toggleExpanded={toggleExpanded}
        focusedPath={focusedPath}
        setFocusedPath={setFocusedPath}
        onContextMenuOpen={onContextMenuOpen}
        renamingPath={renamingPath}
        onRenameSubmit={onRenameSubmit}
        onRenameCancel={onRenameCancel}
        draggingPath={draggingPath}
        dragOverPath={dragOverPath}
        dragEnabled={dragEnabled}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOverTarget={onDragOverTarget}
        onDragLeaveTarget={onDragLeaveTarget}
        onDropOnTarget={onDropOnTarget}
      />
    </div>
  );
}

function TreeNodes({
  entries,
  depth,
  currentFilePath,
  onFileClick,
  expandedPaths,
  toggleExpanded,
  focusedPath,
  setFocusedPath,
  onContextMenuOpen,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  draggingPath,
  dragOverPath,
  dragEnabled,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDragLeaveTarget,
  onDropOnTarget,
}: {
  entries: FileTreeEntry[];
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
} & TreeContext) {
  return (
    <>
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={depth}
          currentFilePath={currentFilePath}
          onFileClick={onFileClick}
          expandedPaths={expandedPaths}
          toggleExpanded={toggleExpanded}
          focusedPath={focusedPath}
          setFocusedPath={setFocusedPath}
          onContextMenuOpen={onContextMenuOpen}
          renamingPath={renamingPath}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
          draggingPath={draggingPath}
          dragOverPath={dragOverPath}
          dragEnabled={dragEnabled}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOverTarget={onDragOverTarget}
          onDragLeaveTarget={onDragLeaveTarget}
          onDropOnTarget={onDropOnTarget}
        />
      ))}
    </>
  );
}

function TreeNode({
  entry,
  depth,
  currentFilePath,
  onFileClick,
  expandedPaths,
  toggleExpanded,
  focusedPath,
  setFocusedPath,
  onContextMenuOpen,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  draggingPath,
  dragOverPath,
  dragEnabled,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDragLeaveTarget,
  onDropOnTarget,
}: {
  entry: FileTreeEntry;
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
} & TreeContext) {
  const isFolder = entry.type === "folder";
  const expanded = isFolder && expandedPaths.has(entry.path);
  const isActive =
    !isFolder && currentFilePath
      ? normalizePath(entry.path) === normalizePath(currentFilePath)
      : false;
  const isFocused = entry.path === focusedPath;
  const isRenaming = renamingPath === entry.path;
  const isDragSource = draggingPath === entry.path;
  const isDragTarget = isFolder && dragOverPath === entry.path;
  const indent = 10 + depth * 16;

  if (isFolder) {
    return (
      <>
        {isRenaming ? (
          <RenameInput
            initialName={entry.name}
            indent={indent}
            isFolder
            onSubmit={(name) => onRenameSubmit(entry.path, name)}
            onCancel={onRenameCancel}
          />
        ) : (
          <button
            className={`tree-item tree-item--folder${isDragTarget ? " tree-item--drag-over" : ""}`}
            style={
              { paddingLeft: indent, "--depth": depth } as React.CSSProperties
            }
            onClick={() => toggleExpanded(entry.path)}
            onFocus={() => setFocusedPath(entry.path)}
            onContextMenu={(e) => onContextMenuOpen?.(entry, e)}
            onDragOver={(e) => {
              if (!dragEnabled) return;
              e.stopPropagation();
              onDragOverTarget(entry.path, e);
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              onDragLeaveTarget(entry.path);
            }}
            onDrop={(e) => {
              if (!dragEnabled) return;
              e.stopPropagation();
              onDropOnTarget(entry.path, e);
            }}
            role="treeitem"
            aria-expanded={expanded}
            tabIndex={isFocused ? 0 : -1}
            data-path={entry.path}
          >
            <span
              className={`tree-item-chevron${expanded ? " tree-item-chevron--open" : ""}`}
            >
              <ChevronIcon />
            </span>
            <span className="tree-item-icon">
              {expanded ? <FolderExpandedIcon /> : <FolderClosedIcon />}
            </span>
            <span className="tree-item-name">{entry.name}</span>
          </button>
        )}
        {expanded && entry.children && (
          <div role="group">
            <TreeNodes
              entries={entry.children}
              depth={depth + 1}
              currentFilePath={currentFilePath}
              onFileClick={onFileClick}
              expandedPaths={expandedPaths}
              toggleExpanded={toggleExpanded}
              focusedPath={focusedPath}
              setFocusedPath={setFocusedPath}
              onContextMenuOpen={onContextMenuOpen}
              renamingPath={renamingPath}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              draggingPath={draggingPath}
              dragOverPath={dragOverPath}
              dragEnabled={dragEnabled}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverTarget={onDragOverTarget}
              onDragLeaveTarget={onDragLeaveTarget}
              onDropOnTarget={onDropOnTarget}
            />
          </div>
        )}
      </>
    );
  }

  if (isRenaming) {
    return (
      <RenameInput
        initialName={entry.name}
        indent={indent}
        isFolder={false}
        onSubmit={(name) => onRenameSubmit(entry.path, name)}
        onCancel={onRenameCancel}
      />
    );
  }

  return (
    <button
      className={`tree-item${isActive ? " tree-item--active" : ""}${isDragSource ? " tree-item--dragging" : ""}`}
      style={{ paddingLeft: indent, "--depth": depth } as React.CSSProperties}
      onClick={() => onFileClick(entry.path)}
      onFocus={() => setFocusedPath(entry.path)}
      onContextMenu={(e) => onContextMenuOpen?.(entry, e)}
      draggable={dragEnabled}
      onDragStart={(e) => onDragStart(entry, e)}
      onDragEnd={onDragEnd}
      title={entry.path}
      role="treeitem"
      aria-selected={isActive}
      tabIndex={isFocused ? 0 : -1}
      data-path={entry.path}
    >
      <span className="tree-item-chevron--placeholder" />
      <span
        className={`tree-item-icon${isActive ? " tree-item-icon--active" : ""}`}
      >
        <MarkdownFileIcon />
      </span>
      <span className="tree-item-name">{entry.name}</span>
    </button>
  );
}

function RenameInput({
  initialName,
  indent,
  isFolder,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  indent: number;
  isFolder: boolean;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-select the file's stem on mount (preserve the extension as a hint).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    if (isFolder) {
      el.select();
    } else {
      const dotIdx = initialName.lastIndexOf(".");
      if (dotIdx > 0) el.setSelectionRange(0, dotIdx);
      else el.select();
    }
  }, [initialName, isFolder]);

  return (
    <div
      className="tree-item tree-item--renaming"
      style={{ paddingLeft: indent } as React.CSSProperties}
    >
      <span className="tree-item-chevron--placeholder" />
      <span className="tree-item-icon">
        {isFolder ? <FolderClosedIcon /> : <MarkdownFileIcon />}
      </span>
      <input
        ref={inputRef}
        className="tree-item-rename-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Stop the keystroke from reaching window-level shortcut handlers.
          // Without this, e.g. Space and other plain keys can be eaten by
          // global keydown listeners (Milkdown editor keymap, focus-mode
          // chrome handlers, etc.) when this input has focus, which breaks
          // typing filenames with spaces.
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onSubmit(value)}
        aria-label="New name"
      />
    </div>
  );
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

// --- Icons ---

function ChevronIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5A1 1 0 005.8 3H3a1 1 0 00-1 1z" />
    </svg>
  );
}

function FolderClosedIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4.5A1.5 1.5 0 014 3h2.586a1 1 0 01.707.293L8.5 4.5H12a1.5 1.5 0 011.5 1.5v5.5A1.5 1.5 0 0112 13H4a1.5 1.5 0 01-1.5-1.5V4.5z" />
    </svg>
  );
}

function FolderExpandedIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 4.5A1.5 1.5 0 014 3h2.586a1 1 0 01.707.293L8.5 4.5H12a1.5 1.5 0 011.5 1.5v5.5A1.5 1.5 0 0112 13H4a1.5 1.5 0 01-1.5-1.5V4.5z" />
      <path d="M2.5 7.5h11" strokeWidth="0.8" opacity="0.35" />
    </svg>
  );
}

function MarkdownFileIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4.5 2h5l3 3v8.5a1 1 0 01-1 1h-7a1 1 0 01-1-1V3a1 1 0 011-1z" />
      <path d="M9.5 2v3h3" />
    </svg>
  );
}

function SortIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4h10M4.5 8h7M6 12h4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3,8 7,12 13,4" />
    </svg>
  );
}

function SortMenu({
  sortKey,
  onSortChange,
}: {
  sortKey: SidebarSortKey;
  onSortChange: (key: SidebarSortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(t) &&
        !buttonRef.current?.contains(t)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="sidebar-sort">
      <button
        ref={buttonRef}
        className="sidebar-sort-btn"
        onClick={() => setOpen((v) => !v)}
        title="Sort files"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <SortIcon />
      </button>
      {open && (
        <div
          ref={menuRef}
          className="sidebar-sort-menu"
          role="menu"
          aria-label="Sort files by"
        >
          {SORT_OPTIONS.map((opt) => {
            const selected = opt.key === sortKey;
            return (
              <button
                key={opt.key}
                className={`sidebar-sort-option${selected ? " sidebar-sort-option--selected" : ""}`}
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onSortChange(opt.key);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
              >
                <span className="sidebar-sort-option-check">
                  {selected && <CheckIcon />}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FolderIllustrationIcon() {
  return (
    <svg
      className="sidebar-empty-icon"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13a3 3 0 013-3h6.172a2 2 0 011.414.586L17.414 12.414A2 2 0 0018.828 13H32a3 3 0 013 3v12a3 3 0 01-3 3H8a3 3 0 01-3-3V13z" />
      <path d="M5 18h30" strokeWidth="1" opacity="0.25" />
    </svg>
  );
}
