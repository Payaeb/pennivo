import { useState, useCallback, useRef, useEffect } from "react";
import {
  type SidebarSortKey,
  SORT_OPTIONS,
  DEFAULT_SORT,
} from "../../utils/sortTree";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu/ContextMenu";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import {
  WorkspaceSwitcher,
  type WorkspaceSwitcherItem,
} from "./WorkspaceSwitcher";
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
  /**
   * Global "Show empty folders" display pref. When true (default), folders with
   * no markdown descendants render in the tree. The toggle lives in the sort
   * menu popover. When `onToggleShowEmptyFolders` is omitted, the toggle row is
   * hidden (so hosts that have not wired it see no visual change).
   */
  showEmptyFolders?: boolean;
  onToggleShowEmptyFolders?: (next: boolean) => void;
  /**
   * Starting sidebar width in CSS pixels. When provided (e.g. restored from the
   * active workspace's prefs) it seeds the internal width state. Omitted falls
   * back to the built-in default. Changes after mount are tracked so a
   * workspace switch can restore a different stored width.
   */
  initialWidth?: number;
  /**
   * Called with the new width (clamped) when the user finishes a drag-resize.
   * Lets the host persist the width per workspace. Not called during the drag,
   * only on release, so persistence stays debounced to one write per resize.
   */
  onWidthChange?: (width: number) => void;
  /** "Show in Explorer / Finder / Files" — reveal in OS file manager. */
  onShowInExplorer?: (filePath: string) => void;
  /** "Show history" — open the recovery modal in History mode for this file. */
  onShowHistory?: (filePath: string) => void;
  /**
   * Open the recovery modal in Trash mode. When set + `trashCount > 0`, the
   * sidebar header surfaces a small "Trash · N" entry.
   */
  onShowTrash?: () => void;
  /**
   * Live trash count from the desktop platform. The Trash entry is hidden
   * when this is 0 (per the locked design, §4.1).
   */
  trashCount?: number;
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
  /**
   * Create a new empty `.md` file inside `parentDir`. `name` is the bare name
   * typed by the user; the host auto-appends `.md` and auto-suffixes on
   * collision. Returns the created absolute path on success, or null on
   * failure. When omitted, the "New File" menu entries are hidden.
   */
  onCreateFile?: (parentDir: string, name: string) => Promise<string | null>;
  /**
   * Create a new folder inside `parentDir`. Returns the created absolute path
   * on success, or null on failure. When omitted, the "New Folder" menu
   * entries are hidden.
   */
  onCreateFolder?: (parentDir: string, name: string) => Promise<string | null>;
  /** Surface success / error feedback (e.g. "Path copied", "Rename failed"). */
  onShowToast?: (message: string, isError?: boolean) => void;
  /**
   * Workspaces for the header title dropdown (Phase 4). When omitted, the
   * header renders the plain folder-name title exactly as before, so a host
   * that hasn't wired workspaces (or has none) sees no visual change.
   */
  workspaces?: WorkspaceSwitcherItem[];
  /** Id of the active workspace, or null when none is selected. */
  activeWorkspaceId?: string | null;
  /** Switch to a different workspace by id (save-then-load on the host). */
  onSwitchWorkspace?: (id: string) => void;
  /** Open the folder picker and add the chosen folder as a new workspace. */
  onAddWorkspace?: () => void;
  /** Forget a workspace by id. Never touches files on disk. */
  onRemoveWorkspace?: (id: string) => void;
  /**
   * Global search (Phase 3). When `onToggleSearch` is wired, the header shows a
   * magnifier toggle. When `searchActive` is true, `searchPanel` replaces the
   * file tree in the rail (the header + workspace switcher stay visible). The
   * panel node is supplied by the host so packages/ui stays platform-free.
   */
  searchActive?: boolean;
  onToggleSearch?: () => void;
  searchPanel?: React.ReactNode;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 240;

/** Clamp a candidate width into the resizable range. */
function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value));
}

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

/** Normalize a path to forward slashes + lowercase for case-insensitive compare. */
function normForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The directory `path` lives in (its parent), normalized. */
function parentDirOf(path: string): string {
  return normForCompare(path).replace(/\/[^/]+$/, "");
}

/**
 * Whether moving `srcPath` INTO `destDir` is illegal or a no-op, so the drop
 * must be suppressed. Covers:
 *  - dropping any entry onto its own current parent directory (no-op),
 *  - dropping a folder onto itself,
 *  - dropping a folder into one of its own descendants.
 * Files can never be a descendant container, so the folder-specific cases only
 * trigger for `isFolder`.
 */
function isIllegalMoveTarget(
  srcPath: string,
  destDir: string,
  isFolder: boolean,
): boolean {
  const src = normForCompare(srcPath);
  const dest = normForCompare(destDir);
  // No-op: the entry already lives directly in this destination folder.
  if (parentDirOf(srcPath) === dest) return true;
  if (isFolder) {
    // Into itself, or into any descendant of the dragged folder.
    if (dest === src || dest.startsWith(src + "/")) return true;
  }
  return false;
}

/**
 * Look up whether `path` names a folder in the tree. Used as a fallback to
 * recover the source's folder-ness when the in-flight `draggingIsFolder` state
 * is unavailable (e.g. a synthetic drop dispatched without a dragstart).
 */
function isPathAFolder(path: string, entries: FileTreeEntry[]): boolean {
  const target = normForCompare(path);
  const find = (list: FileTreeEntry[]): FileTreeEntry | null => {
    for (const e of list) {
      if (normForCompare(e.path) === target) return e;
      if (e.children) {
        const found = find(e.children);
        if (found) return found;
      }
    }
    return null;
  };
  return find(entries)?.type === "folder";
}

export function Sidebar({
  visible,
  folderPath,
  tree,
  currentFilePath,
  onFileClick,
  onChooseFolder,
  sortKey = DEFAULT_SORT,
  onSortChange,
  showEmptyFolders = true,
  onToggleShowEmptyFolders,
  initialWidth,
  onWidthChange,
  onShowInExplorer,
  onShowHistory,
  onShowTrash,
  trashCount = 0,
  onRenameFile,
  onDeleteFile,
  onGetAssetSummary,
  onMoveFile,
  onCreateFile,
  onCreateFolder,
  onShowToast,
  workspaces,
  activeWorkspaceId = null,
  onSwitchWorkspace,
  onAddWorkspace,
  onRemoveWorkspace,
  searchActive = false,
  onToggleSearch,
  searchPanel,
}: SidebarProps) {
  const [width, setWidth] = useState(
    typeof initialWidth === "number" ? clampWidth(initialWidth) : DEFAULT_WIDTH,
  );
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Re-seed the internal width when the host hands us a different stored width
  // (e.g. a workspace switch restored a new value). We only follow non-null
  // numbers so omitting the prop keeps the current width untouched.
  const lastInitialWidthRef = useRef<number | undefined>(initialWidth);
  useEffect(() => {
    if (typeof initialWidth === "number" && initialWidth !== lastInitialWidthRef.current) {
      lastInitialWidthRef.current = initialWidth;
      setWidth(clampWidth(initialWidth));
    }
  }, [initialWidth]);

  // --- Context menu / rename / delete state (lifted to Sidebar root) ---
  const [contextMenu, setContextMenu] = useState<{
    entry: FileTreeEntry;
    x: number;
    y: number;
  } | null>(null);
  // Root (tree-background) context menu with only New File / New Folder.
  const [rootContextMenu, setRootContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // When set, an inline "create new entry" input is shown inside `parentDir`
  // (the workspace root or a folder row) for a file or folder. Mirrors the
  // `renamingPath` pattern. Cleared on submit/cancel.
  const [creatingIn, setCreatingIn] = useState<{
    parentDir: string;
    kind: "file" | "folder";
  } | null>(null);
  // Reset any in-flight inline create when the workspace root changes, so a
  // pending create never carries over (mis-targeted) into a different folder.
  useEffect(() => {
    setCreatingIn(null);
  }, [folderPath]);
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
  // Whether the in-flight drag source is a folder. Drives the client-side
  // self/descendant guard for folder moves (a file can never be a container).
  const [draggingIsFolder, setDraggingIsFolder] = useState(false);
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  // pendingMove carries `isFolder` so the collision dialog can show the
  // folder-appropriate "Replace existing folder?" copy on a directory move.
  const [pendingMove, setPendingMove] = useState<{
    srcPath: string;
    destDir: string;
    destFilename: string;
    isFolder: boolean;
  } | null>(null);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const closeRootContextMenu = useCallback(() => setRootContextMenu(null), []);

  const handleContextMenuOpen = useCallback(
    (entry: FileTreeEntry, e: React.MouseEvent) => {
      // Only show menu when at least one action is available
      if (
        !onShowInExplorer &&
        !onShowHistory &&
        !onRenameFile &&
        !onDeleteFile &&
        !onShowToast &&
        !onCreateFile &&
        !onCreateFolder
      ) {
        return;
      }
      e.preventDefault();
      setRootContextMenu(null);
      setContextMenu({ entry, x: e.clientX, y: e.clientY });
    },
    [
      onShowInExplorer,
      onShowHistory,
      onRenameFile,
      onDeleteFile,
      onShowToast,
      onCreateFile,
      onCreateFolder,
    ],
  );

  // Right-click on the bare tree background → a minimal root context menu with
  // just New File / New Folder (targeting the workspace root). The tree did not
  // have a root context menu before Phase 11f; this adds one.
  const handleRootContextMenuOpen = useCallback(
    (e: React.MouseEvent) => {
      if (!onCreateFile && !onCreateFolder) return;
      e.preventDefault();
      setContextMenu(null);
      setRootContextMenu({ x: e.clientX, y: e.clientY });
    },
    [onCreateFile, onCreateFolder],
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

  const handleCreateSubmit = useCallback(
    async (name: string) => {
      const target = creatingIn;
      setCreatingIn(null);
      if (!target) return;
      const trimmed = name.trim();
      // Empty name cancels silently (matches rename + the spec).
      if (!trimmed) return;
      const handler =
        target.kind === "file" ? onCreateFile : onCreateFolder;
      if (!handler) return;
      const created = await handler(target.parentDir, trimmed);
      if (created === null) {
        onShowToast?.(
          target.kind === "file"
            ? "Could not create file"
            : "Could not create folder",
          true,
        );
      }
    },
    [creatingIn, onCreateFile, onCreateFolder, onShowToast],
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
    async (
      srcPath: string,
      destDir: string,
      overwrite: boolean,
      isFolder: boolean,
    ) => {
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
        setPendingMove({ srcPath, destDir, destFilename: filename, isFolder });
      } else {
        onShowToast?.("Move failed", true);
      }
    },
    [onMoveFile, onShowToast],
  );

  const handleDragStart = useCallback(
    (entry: FileTreeEntry, e: React.DragEvent) => {
      // Files AND folders are draggable when a move handler is wired. Folders
      // use the same `application/x-pennivo-path` payload as files; the move
      // handler stats the source and generalizes a folder move to a recursive
      // move (with the same collision flow).
      if (!onMoveFile || (entry.type !== "file" && entry.type !== "folder")) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("application/x-pennivo-path", entry.path);
      // text/plain fallback for tools that read clipboard-like data
      e.dataTransfer.setData("text/plain", entry.path);
      setDraggingPath(entry.path);
      setDraggingIsFolder(entry.type === "folder");
    },
    [onMoveFile],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDraggingIsFolder(false);
    setDragOverPath(null);
  }, []);

  const handleDragOverTarget = useCallback(
    (targetKey: string, destDir: string, e: React.DragEvent) => {
      if (!onMoveFile || !draggingPath) return;
      // Suppress the drop-allowed indicator for illegal targets: a folder
      // dropped onto itself / a descendant, or any entry onto its own current
      // parent (a no-op). Not calling preventDefault leaves the cursor in the
      // browser's default "no-drop" state and no row highlight is shown.
      if (isIllegalMoveTarget(draggingPath, destDir, draggingIsFolder)) {
        if (dragOverPath === targetKey) setDragOverPath(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverPath !== targetKey) setDragOverPath(targetKey);
    },
    [onMoveFile, draggingPath, draggingIsFolder, dragOverPath],
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
      // Capture the source's folder-ness before clearing the drag state. We
      // fall back to the tree when `draggingIsFolder` is stale (e.g. a drop
      // dispatched without a matching dragstart in tests).
      const isFolder = draggingPath
        ? draggingIsFolder
        : isPathAFolder(srcPath, tree);
      setDraggingPath(null);
      setDraggingIsFolder(false);
      setDragOverPath(null);
      if (!srcPath) return;

      // Guard (mirrors handleDragOverTarget): ignore illegal/no-op drops —
      // onto the source's own parent, onto the dragged folder itself, or into
      // any of its descendants. The move handler also guards server-side.
      if (isIllegalMoveTarget(srcPath, destDir, isFolder)) return;

      await tryMove(srcPath, destDir, false, isFolder);
    },
    [onMoveFile, tryMove, draggingPath, draggingIsFolder, tree],
  );

  const handleConfirmReplaceMove = useCallback(async () => {
    if (!pendingMove) return;
    const { srcPath, destDir, isFolder } = pendingMove;
    setPendingMove(null);
    await tryMove(srcPath, destDir, true, isFolder);
  }, [pendingMove, tryMove]);

  // Build the items list for the active context menu
  const contextMenuItems: ContextMenuEntry[] = (() => {
    if (!contextMenu) return [];
    const { entry } = contextMenu;
    const items: ContextMenuEntry[] = [];
    // New File / New Folder live on folder rows (the folder is the parent dir).
    if (entry.type === "folder" && (onCreateFile || onCreateFolder)) {
      if (onCreateFile) {
        items.push({
          type: "item",
          label: "New File",
          onClick: () =>
            setCreatingIn({ parentDir: entry.path, kind: "file" }),
        });
      }
      if (onCreateFolder) {
        items.push({
          type: "item",
          label: "New Folder",
          onClick: () =>
            setCreatingIn({ parentDir: entry.path, kind: "folder" }),
        });
      }
      items.push({ type: "separator" });
    }
    if (onShowInExplorer && entry.type === "file") {
      items.push({
        type: "item",
        label: showInOsLabel(),
        onClick: () => onShowInExplorer(entry.path),
      });
    }
    if (onShowHistory && entry.type === "file") {
      items.push({
        type: "item",
        label: "Show history",
        onClick: () => onShowHistory(entry.path),
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

  // Build the root (tree-background) context menu with only the create
  // entries, targeting the workspace root (folderPath).
  const rootContextMenuItems: ContextMenuEntry[] = (() => {
    if (!rootContextMenu || !folderPath) return [];
    const items: ContextMenuEntry[] = [];
    if (onCreateFile) {
      items.push({
        type: "item",
        label: "New File",
        onClick: () =>
          setCreatingIn({ parentDir: folderPath, kind: "file" }),
      });
    }
    if (onCreateFolder) {
      items.push({
        type: "item",
        label: "New Folder",
        onClick: () =>
          setCreatingIn({ parentDir: folderPath, kind: "folder" }),
      });
    }
    return items;
  })();

  // --- Resize logic ---
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(true);
      const startX = e.clientX;
      const startWidth = sidebarRef.current?.offsetWidth ?? DEFAULT_WIDTH;
      // Track the latest width across the drag so we can report it once on
      // release (one persistence write per resize, not per mousemove).
      let latestWidth = startWidth;

      const handleMouseMove = (me: MouseEvent) => {
        const newWidth = clampWidth(startWidth + (me.clientX - startX));
        latestWidth = newWidth;
        setWidth(newWidth);
      };

      const handleMouseUp = () => {
        setResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        // Remember the released width so a re-seed from an unchanged prop does
        // not snap us back, then notify the host to persist it.
        lastInitialWidthRef.current = latestWidth;
        onWidthChange?.(latestWidth);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [onWidthChange],
  );

  if (!visible) return null;

  const folderName = folderPath
    ? folderPath.replace(/\\/g, "/").split("/").pop() || "Folder"
    : null;

  // The header switcher is enabled once the host wires the workspace handlers.
  // Prefer the active workspace's name for the displayed title; fall back to
  // the folder-derived name so a no-workspace install reads exactly like today.
  const switcherEnabled =
    !!onSwitchWorkspace && !!onAddWorkspace && !!onRemoveWorkspace;
  const activeWorkspace = workspaces?.find((w) => w.id === activeWorkspaceId);
  const displayTitle = activeWorkspace?.name || folderName || "Files";

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <div className="sidebar-header">
        {switcherEnabled ? (
          <WorkspaceSwitcher
            workspaces={workspaces ?? []}
            activeWorkspaceId={activeWorkspaceId}
            displayName={displayTitle}
            titleTooltip={activeWorkspace?.rootPath || folderPath || undefined}
            onSwitchWorkspace={onSwitchWorkspace}
            onAddWorkspace={onAddWorkspace}
            onRemoveWorkspace={onRemoveWorkspace}
          />
        ) : (
          <span className="sidebar-title" title={folderPath || undefined}>
            {folderName || "Files"}
          </span>
        )}
        {folderPath && tree.length > 0 && (
          <span className="sidebar-file-count">{countFiles(tree)}</span>
        )}
        {folderPath && onSortChange && !searchActive && (
          <SortMenu
            sortKey={sortKey}
            onSortChange={onSortChange}
            showEmptyFolders={showEmptyFolders}
            onToggleShowEmptyFolders={onToggleShowEmptyFolders}
          />
        )}
        {onToggleSearch && (
          <button
            className={`sidebar-set-folder-btn${searchActive ? " sidebar-set-folder-btn--active" : ""}`}
            onClick={onToggleSearch}
            title={searchActive ? "Close search" : "Search in workspace"}
            aria-label="Search in workspace"
            aria-pressed={searchActive}
          >
            <SearchIcon />
          </button>
        )}
        <button
          className="sidebar-set-folder-btn"
          onClick={onChooseFolder}
          title="Set Folder"
        >
          <FolderOpenIcon />
        </button>
      </div>

      {searchActive ? (
        searchPanel
      ) : (
        <>
      {trashCount > 0 && onShowTrash && (
        <button
          type="button"
          className="sidebar-trash-entry"
          onClick={onShowTrash}
          title={`${trashCount} file${trashCount === 1 ? "" : "s"} in trash`}
        >
          <span className="sidebar-trash-icon" aria-hidden="true">
            <TrashIcon />
          </span>
          <span className="sidebar-trash-label">Trash</span>
          <span className="sidebar-trash-sep" aria-hidden="true">
            ·
          </span>
          <span className="sidebar-trash-count">{trashCount}</span>
        </button>
      )}

      {folderPath && tree.length > 0 ? (
        <TreeContainer
          tree={tree}
          currentFilePath={currentFilePath}
          rootDir={folderPath}
          onFileClick={onFileClick}
          onContextMenuOpen={handleContextMenuOpen}
          onRootContextMenuOpen={handleRootContextMenuOpen}
          renamingPath={renamingPath}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={() => setRenamingPath(null)}
          creatingIn={creatingIn}
          onCreateSubmit={handleCreateSubmit}
          onCreateCancel={() => setCreatingIn(null)}
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
        (() => {
          // When a workspace IS selected but its tree is empty, surface inline
          // "New File" / "New Folder" affordances so the user can start a
          // structure from scratch. Without these, an empty workspace is a dead
          // end: the create entries otherwise live only on the tree/folder
          // context menu, which isn't rendered when there is no tree. The
          // create flow reuses the same `creatingIn` state + `CreateInput`
          // component as the context menu, targeting the workspace root
          // (`folderPath`), so naming / validation / collision behavior is
          // identical.
          const canCreate = !!folderPath && (!!onCreateFile || !!onCreateFolder);
          const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
          const isCreatingAtRoot =
            canCreate &&
            !!creatingIn &&
            !!folderPath &&
            norm(creatingIn.parentDir) === norm(folderPath);
          return (
            <div
              className="sidebar-empty"
              onContextMenu={canCreate ? handleRootContextMenuOpen : undefined}
            >
              <FolderIllustrationIcon />
              <span className="sidebar-empty-text">
                {folderPath
                  ? "No markdown files yet"
                  : "Open a folder to browse files"}
              </span>
              {isCreatingAtRoot && creatingIn ? (
                <div className="sidebar-empty-create">
                  <CreateInput
                    kind={creatingIn.kind}
                    indent={10}
                    onSubmit={handleCreateSubmit}
                    onCancel={() => setCreatingIn(null)}
                  />
                </div>
              ) : canCreate && folderPath ? (
                <div className="sidebar-empty-actions">
                  {onCreateFile && (
                    <button
                      type="button"
                      className="sidebar-empty-create-btn"
                      onClick={() =>
                        setCreatingIn({ parentDir: folderPath, kind: "file" })
                      }
                    >
                      <MarkdownFileIcon />
                      <span>New File</span>
                    </button>
                  )}
                  {onCreateFolder && (
                    <button
                      type="button"
                      className="sidebar-empty-create-btn"
                      onClick={() =>
                        setCreatingIn({ parentDir: folderPath, kind: "folder" })
                      }
                    >
                      <FolderClosedIcon />
                      <span>New Folder</span>
                    </button>
                  )}
                </div>
              ) : (
                <button
                  className="sidebar-open-folder-btn"
                  onClick={onChooseFolder}
                >
                  {folderPath ? "Change Folder" : "Open Folder"}
                </button>
              )}
              <span className="sidebar-empty-hint">
                {folderPath
                  ? canCreate
                    ? "Create your first file or folder, or right-click here"
                    : "Try a different folder"
                  : "Drag a folder here or click to browse"}
              </span>
            </div>
          );
        })()
      )}
        </>
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

      {rootContextMenu && rootContextMenuItems.length > 0 && (
        <ContextMenu
          x={rootContextMenu.x}
          y={rootContextMenu.y}
          items={rootContextMenuItems}
          onClose={closeRootContextMenu}
          ariaLabel="Create in this folder"
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete file?"
        message={
          pendingDelete
            ? `"${pendingDelete.entry.name}" will be moved to Trash. Deleted files can be restored from Trash for 30 days.`
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
        title={
          pendingMove?.isFolder
            ? "Replace existing folder?"
            : "Replace existing file?"
        }
        message={
          pendingMove
            ? pendingMove.isFolder
              ? `A folder named "${pendingMove.destFilename}" already exists in the destination folder. Replacing it removes the existing folder and everything inside it. This cannot be undone.`
              : `A file named "${pendingMove.destFilename}" already exists in the destination folder. Replace it? This cannot be undone.`
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
  // Inline "create new entry" state. When `creatingIn.parentDir` matches a
  // folder's path (or the root), that container renders a CreateInput row.
  creatingIn: { parentDir: string; kind: "file" | "folder" } | null;
  onCreateSubmit: (name: string) => void;
  onCreateCancel: () => void;
  // Drag-and-drop
  draggingPath: string | null;
  dragOverPath: string | null;
  dragEnabled: boolean;
  onDragStart: (entry: FileTreeEntry, e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOverTarget: (
    targetKey: string,
    destDir: string,
    e: React.DragEvent,
  ) => void;
  onDragLeaveTarget: (targetKey: string) => void;
  onDropOnTarget: (destDir: string, e: React.DragEvent) => void;
}

function TreeContainer({
  tree,
  currentFilePath,
  rootDir,
  onFileClick,
  onContextMenuOpen,
  onRootContextMenuOpen,
  renamingPath,
  onRenameSubmit,
  onRenameCancel,
  creatingIn,
  onCreateSubmit,
  onCreateCancel,
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
  onRootContextMenuOpen: (e: React.MouseEvent) => void;
} & TreeContext) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  // Track expanded folders — default expand depth 0
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const e of tree) if (e.type === "folder") set.add(e.path);
    return set;
  });

  // When a "New File/Folder" is started inside a folder (not the root), make
  // sure that folder is expanded so its inline CreateInput is visible. After a
  // successful new-folder create the tree refreshes with the new folder already
  // in the host's expanded set via this same auto-expand on its parent.
  useEffect(() => {
    if (!creatingIn) return;
    const parent = creatingIn.parentDir;
    const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
    if (norm(parent) === norm(rootDir)) return;
    setExpandedPaths((prev) => {
      if (prev.has(parent)) return prev;
      const next = new Set(prev);
      next.add(parent);
      return next;
    });
  }, [creatingIn, rootDir]);

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
  const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();
  const isCreatingAtRoot =
    !!creatingIn && norm(creatingIn.parentDir) === norm(rootDir);

  return (
    <div
      className={`sidebar-tree${isRootDragOver ? " sidebar-tree--drag-over" : ""}`}
      ref={treeRef}
      role="tree"
      aria-label="File browser"
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => {
        // Only the bare tree background opens the root menu; folder/file rows
        // call onContextMenuOpen and stop here via their own handlers.
        if (e.currentTarget === e.target) onRootContextMenuOpen(e);
      }}
      onDragOver={(e) => {
        if (!dragEnabled) return;
        // Only treat as a root-drop if the drag is over the bare tree
        // background, not a nested folder row (folder rows handle their own
        // dragOver via stopPropagation in handleDropOnTarget).
        if (e.currentTarget === e.target) {
          onDragOverTarget(ROOT_DROP_TARGET, rootDir, e);
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
      {isCreatingAtRoot && creatingIn && (
        <CreateInput
          kind={creatingIn.kind}
          indent={10}
          onSubmit={onCreateSubmit}
          onCancel={onCreateCancel}
        />
      )}
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
        creatingIn={creatingIn}
        onCreateSubmit={onCreateSubmit}
        onCreateCancel={onCreateCancel}
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
  creatingIn,
  onCreateSubmit,
  onCreateCancel,
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
          creatingIn={creatingIn}
          onCreateSubmit={onCreateSubmit}
          onCreateCancel={onCreateCancel}
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
  creatingIn,
  onCreateSubmit,
  onCreateCancel,
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
  const isCreatingHere =
    isFolder &&
    !!creatingIn &&
    creatingIn.parentDir.replace(/\\/g, "/").toLowerCase() ===
      entry.path.replace(/\\/g, "/").toLowerCase();
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
            className={`tree-item tree-item--folder${isDragTarget ? " tree-item--drag-over" : ""}${isDragSource ? " tree-item--dragging" : ""}`}
            style={
              { paddingLeft: indent, "--depth": depth } as React.CSSProperties
            }
            onClick={() => toggleExpanded(entry.path)}
            onFocus={() => setFocusedPath(entry.path)}
            onContextMenu={(e) => onContextMenuOpen?.(entry, e)}
            draggable={dragEnabled}
            onDragStart={(e) => onDragStart(entry, e)}
            onDragOver={(e) => {
              if (!dragEnabled) return;
              e.stopPropagation();
              onDragOverTarget(entry.path, entry.path, e);
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
            onDragEnd={onDragEnd}
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
        {expanded && (isCreatingHere || entry.children) && (
          <div role="group">
            {isCreatingHere && creatingIn && (
              <CreateInput
                kind={creatingIn.kind}
                indent={10 + (depth + 1) * 16}
                onSubmit={onCreateSubmit}
                onCancel={onCreateCancel}
              />
            )}
            {entry.children && (
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
                creatingIn={creatingIn}
                onCreateSubmit={onCreateSubmit}
                onCreateCancel={onCreateCancel}
                draggingPath={draggingPath}
                dragOverPath={dragOverPath}
                dragEnabled={dragEnabled}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragOverTarget={onDragOverTarget}
                onDragLeaveTarget={onDragLeaveTarget}
                onDropOnTarget={onDropOnTarget}
              />
            )}
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

// Characters that are never valid in a file/folder name (OS-reserved plus path
// separators). The host re-validates authoritatively; this drives inline UI
// feedback so the user sees the problem before submitting.
const INVALID_NAME_CHARS = ["/", "\\", "<", ">", ":", '"', "|", "?", "*"];

function hasInvalidNameChar(name: string): boolean {
  return INVALID_NAME_CHARS.some((ch) => name.includes(ch));
}

/**
 * Inline input for the "New File" / "New Folder" flows. Mirrors `RenameInput`
 * but starts empty, shows live validation for invalid path characters, and
 * blocks submit while the name is invalid. Empty name (or Escape) cancels.
 */
function CreateInput({
  kind,
  indent,
  onSubmit,
  onCancel,
}: {
  kind: "file" | "folder";
  indent: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const invalid = value.length > 0 && hasInvalidNameChar(value);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trySubmit = () => {
    const trimmed = value.trim();
    if (trimmed === "") {
      onCancel();
      return;
    }
    if (hasInvalidNameChar(trimmed)) return; // keep the input open; show error
    onSubmit(trimmed);
  };

  return (
    <div
      className="tree-item tree-item--renaming tree-item--creating"
      style={{ paddingLeft: indent } as React.CSSProperties}
    >
      <span className="tree-item-chevron--placeholder" />
      <span className="tree-item-icon">
        {kind === "folder" ? <FolderClosedIcon /> : <MarkdownFileIcon />}
      </span>
      {/* Input + below-input error stack so a long name never pushes the error
          off the narrow sidebar's visible edge (the error lives under the
          field instead of to its right). */}
      <span className="tree-item-create-field">
        <input
          ref={inputRef}
          className={`tree-item-rename-input${invalid ? " tree-item-rename-input--invalid" : ""}`}
          value={value}
          placeholder={kind === "folder" ? "New folder name" : "New file name"}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // Same rationale as RenameInput: keep keystrokes off global handlers.
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              trySubmit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={trySubmit}
          aria-label={kind === "folder" ? "New folder name" : "New file name"}
          aria-invalid={invalid}
        />
        {invalid && (
          <span className="tree-item-create-error" role="alert">
            Invalid character
          </span>
        )}
      </span>
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

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
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

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5V3.5a1 1 0 011-1h1a1 1 0 011 1v1" />
      <path d="M4.5 4.5l.5 8a1 1 0 001 1h4a1 1 0 001-1l.5-8" />
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
      width="14"
      height="14"
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

/**
 * Checkbox-style affordance for the "Show empty folders" toggle. Renders a
 * rounded box that is empty when off and filled with a check when on, so the
 * toggle reads as a distinct control type from the single-select sort options
 * (which use the bare {@link CheckIcon}).
 */
function ToggleBoxIcon({ checked }: { checked: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="3"
        fill={checked ? "currentColor" : "none"}
      />
      {checked && (
        <polyline
          points="5,8 7,10 11,5.5"
          stroke="var(--bg-surface)"
          strokeWidth="1.6"
        />
      )}
    </svg>
  );
}

function SortMenu({
  sortKey,
  onSortChange,
  showEmptyFolders,
  onToggleShowEmptyFolders,
}: {
  sortKey: SidebarSortKey;
  onSortChange: (key: SidebarSortKey) => void;
  showEmptyFolders: boolean;
  onToggleShowEmptyFolders?: (next: boolean) => void;
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
          {onToggleShowEmptyFolders && (
            <>
              <div className="sidebar-sort-separator" role="separator" />
              <button
                className={`sidebar-sort-option sidebar-sort-toggle${showEmptyFolders ? " sidebar-sort-toggle--on" : ""}`}
                role="menuitemcheckbox"
                aria-checked={showEmptyFolders}
                onClick={() => onToggleShowEmptyFolders(!showEmptyFolders)}
              >
                <span className="sidebar-sort-option-check sidebar-sort-toggle-box">
                  <ToggleBoxIcon checked={showEmptyFolders} />
                </span>
                <span>Show empty folders</span>
              </button>
            </>
          )}
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
