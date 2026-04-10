import { useState, useCallback, useRef, useEffect } from "react";
import "./Sidebar.css";

interface SidebarProps {
  visible: boolean;
  folderPath: string | null;
  tree: FileTreeEntry[];
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  onChooseFolder: () => void;
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

export function Sidebar({
  visible,
  folderPath,
  tree,
  currentFilePath,
  onFileClick,
  onChooseFolder,
}: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

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
          onFileClick={onFileClick}
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
    </div>
  );
}

// --- Tree rendering with keyboard navigation ---

function TreeContainer({
  tree,
  currentFilePath,
  onFileClick,
}: {
  tree: FileTreeEntry[];
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
}) {
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

  return (
    <div
      className="sidebar-tree"
      ref={treeRef}
      role="tree"
      aria-label="File browser"
      onKeyDown={handleKeyDown}
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
}: {
  entries: FileTreeEntry[];
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
}) {
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
}: {
  entry: FileTreeEntry;
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
  expandedPaths: Set<string>;
  toggleExpanded: (path: string) => void;
  focusedPath: string | null;
  setFocusedPath: (path: string) => void;
}) {
  const isFolder = entry.type === "folder";
  const expanded = isFolder && expandedPaths.has(entry.path);
  const isActive =
    !isFolder && currentFilePath
      ? normalizePath(entry.path) === normalizePath(currentFilePath)
      : false;
  const isFocused = entry.path === focusedPath;
  const indent = 10 + depth * 16;

  if (isFolder) {
    return (
      <>
        <button
          className="tree-item tree-item--folder"
          style={
            { paddingLeft: indent, "--depth": depth } as React.CSSProperties
          }
          onClick={() => toggleExpanded(entry.path)}
          onFocus={() => setFocusedPath(entry.path)}
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
            />
          </div>
        )}
      </>
    );
  }

  return (
    <button
      className={`tree-item${isActive ? " tree-item--active" : ""}`}
      style={{ paddingLeft: indent, "--depth": depth } as React.CSSProperties}
      onClick={() => onFileClick(entry.path)}
      onFocus={() => setFocusedPath(entry.path)}
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
