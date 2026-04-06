import { useState, useCallback, useRef } from 'react';
import './Sidebar.css';

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
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + (me.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  if (!visible) return null;

  const folderName = folderPath
    ? folderPath.replace(/\\/g, '/').split('/').pop() || 'Folder'
    : null;

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width }}>
      <div className="sidebar-header">
        <span className="sidebar-title" title={folderPath || undefined}>
          {folderName || 'Files'}
        </span>
        <button
          className="sidebar-set-folder-btn"
          onClick={onChooseFolder}
          title="Set Folder"
        >
          <FolderOpenIcon />
        </button>
      </div>

      {folderPath && tree.length > 0 ? (
        <div className="sidebar-tree">
          <TreeNodes
            entries={tree}
            depth={0}
            currentFilePath={currentFilePath}
            onFileClick={onFileClick}
          />
        </div>
      ) : (
        <div className="sidebar-empty">
          <span className="sidebar-empty-text">
            {folderPath ? 'No markdown files found' : 'Open a folder to browse files'}
          </span>
          <button className="sidebar-open-folder-btn" onClick={onChooseFolder}>
            {folderPath ? 'Change Folder' : 'Open Folder'}
          </button>
        </div>
      )}

      <div
        className={`sidebar-resize-handle${resizing ? ' sidebar-resize-handle--active' : ''}`}
        onMouseDown={handleResizeStart}
      />
    </div>
  );
}

// --- Tree rendering ---

function TreeNodes({
  entries,
  depth,
  currentFilePath,
  onFileClick,
}: {
  entries: FileTreeEntry[];
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
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
}: {
  entry: FileTreeEntry;
  depth: number;
  currentFilePath: string | null;
  onFileClick: (filePath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isFolder = entry.type === 'folder';
  const isActive = !isFolder && currentFilePath
    ? normalizePath(entry.path) === normalizePath(currentFilePath)
    : false;
  const indent = 12 + depth * 16;

  if (isFolder) {
    return (
      <>
        <button
          className="tree-item"
          style={{ paddingLeft: indent }}
          onClick={() => setExpanded(!expanded)}
        >
          <span className={`tree-item-chevron${expanded ? ' tree-item-chevron--open' : ''}`}>
            <ChevronIcon />
          </span>
          <span className="tree-item-name">{entry.name}</span>
        </button>
        {expanded && entry.children && (
          <TreeNodes
            entries={entry.children}
            depth={depth + 1}
            currentFilePath={currentFilePath}
            onFileClick={onFileClick}
          />
        )}
      </>
    );
  }

  return (
    <button
      className={`tree-item${isActive ? ' tree-item--active' : ''}`}
      style={{ paddingLeft: indent }}
      onClick={() => onFileClick(entry.path)}
      title={entry.path}
    >
      <span className="tree-item-chevron--placeholder" />
      <span className="tree-item-name">{entry.name}</span>
    </button>
  );
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

// --- Icons ---

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}

function FolderOpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5A1 1 0 005.8 3H3a1 1 0 00-1 1z" />
    </svg>
  );
}
