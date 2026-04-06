import { useState, useEffect, useRef } from 'react';
import './TitlebarMenu.css';

export type MenuAction =
  | 'newFile' | 'open' | 'save' | 'saveAs' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'focusMode' | 'sourceMode' | 'toggleTheme' | 'toggleSidebar' | 'toggleOutline' | 'setFolder'
  | 'zoomIn' | 'zoomOut' | 'resetZoom'
  | 'findReplace' | 'clearRecentFiles'
  | 'exportHtml' | 'exportPdf'
  | 'spellcheckSettings';

export interface RecentFileEntry {
  filePath: string;
  filename: string;
  truncatedPath: string;
}

interface TitlebarMenuProps {
  onAction: (action: MenuAction) => void;
  recentFiles?: RecentFileEntry[];
  onOpenRecentFile?: (filePath: string) => void;
}

interface MenuItem {
  label: string;
  action?: MenuAction;
  shortcut?: string;
  separator?: boolean;
}

interface MenuSection {
  label: string;
  items: MenuItem[];
}

const MENU_SECTIONS: MenuSection[] = [
  {
    label: 'File',
    items: [
      { label: 'New File',      action: 'newFile', shortcut: 'Ctrl+N' },
      { label: 'Open\u2026',   action: 'open',   shortcut: 'Ctrl+O' },
      { label: 'Save',         action: 'save',   shortcut: 'Ctrl+S' },
      { label: 'Save As\u2026', action: 'saveAs', shortcut: 'Ctrl+Shift+S' },
      { separator: true, label: '' },
      { label: 'Export as HTML', action: 'exportHtml', shortcut: 'Ctrl+Shift+E' },
      { label: 'Export as PDF',  action: 'exportPdf',  shortcut: 'Ctrl+Shift+P' },
      { separator: true, label: '' },
      { label: 'Quit',         action: 'quit',   shortcut: 'Alt+F4' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo',       action: 'undo',      shortcut: 'Ctrl+Z' },
      { label: 'Redo',       action: 'redo',       shortcut: 'Ctrl+Y' },
      { separator: true, label: '' },
      { label: 'Cut',        action: 'cut',        shortcut: 'Ctrl+X' },
      { label: 'Copy',       action: 'copy',       shortcut: 'Ctrl+C' },
      { label: 'Paste',      action: 'paste',      shortcut: 'Ctrl+V' },
      { separator: true, label: '' },
      { label: 'Select All', action: 'selectAll',  shortcut: 'Ctrl+A' },
      { separator: true, label: '' },
      { label: 'Find & Replace', action: 'findReplace', shortcut: 'Ctrl+F' },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Toggle Sidebar', action: 'toggleSidebar', shortcut: 'Ctrl+B' },
      { label: 'Toggle Outline', action: 'toggleOutline', shortcut: 'Ctrl+Shift+O' },
      { label: 'Set Folder\u2026', action: 'setFolder' },
      { separator: true, label: '' },
      { label: 'Focus Mode',   action: 'focusMode',   shortcut: 'Ctrl+Shift+F' },
      { label: 'Toggle Theme', action: 'toggleTheme' },
      { separator: true, label: '' },
      { label: 'Zoom In',      action: 'zoomIn',      shortcut: 'Ctrl+=' },
      { label: 'Zoom Out',     action: 'zoomOut',     shortcut: 'Ctrl+\u2013' },
      { label: 'Reset Zoom',   action: 'resetZoom',   shortcut: 'Ctrl+0' },
    ],
  },
];

export function TitlebarMenu({ onAction, recentFiles, onOpenRecentFile }: TitlebarMenuProps) {
  const [open, setOpen] = useState(false);
  const [recentSubmenuOpen, setRecentSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRef = useRef<HTMLDivElement>(null);
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setRecentSubmenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (recentSubmenuOpen) {
          setRecentSubmenuOpen(false);
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open, recentSubmenuOpen]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTimeout(recentTimerRef.current);
  }, []);

  const handleItemClick = (action?: MenuAction) => {
    if (!action) return;
    setOpen(false);
    setRecentSubmenuOpen(false);
    onAction(action);
  };

  const handleRecentEnter = () => {
    clearTimeout(recentTimerRef.current);
    if (recentTriggerRef.current) {
      const rect = recentTriggerRef.current.getBoundingClientRect();
      setSubmenuPos({ top: rect.top, left: rect.right + 2 });
    }
    setRecentSubmenuOpen(true);
  };

  const handleRecentLeave = () => {
    recentTimerRef.current = setTimeout(() => setRecentSubmenuOpen(false), 200);
  };

  const handleSubmenuEnter = () => {
    clearTimeout(recentTimerRef.current);
  };

  const handleSubmenuLeave = () => {
    recentTimerRef.current = setTimeout(() => setRecentSubmenuOpen(false), 200);
  };

  const hasRecentFiles = recentFiles && recentFiles.length > 0;

  return (
    <div className="titlebar-menu" ref={menuRef}>
      <button
        className={`titlebar-menu-btn${open ? ' titlebar-menu-btn--open' : ''}`}
        onClick={() => { setOpen(!open); setRecentSubmenuOpen(false); }}
        title="Menu"
        tabIndex={-1}
        aria-label="Application menu"
        aria-expanded={open}
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div className="titlebar-menu-dropdown">
          {MENU_SECTIONS.map((section, sectionIdx) => (
            <div key={section.label} className="menu-section">
              <div className="menu-section-label">{section.label}</div>
              {section.items.map((item, i) => {
                // Insert "Recent Files >" submenu trigger after "Save As" in File section
                const showRecentAfter = sectionIdx === 0 && item.action === 'saveAs';

                return (
                  <div key={item.separator ? `sep-${i}` : item.action}>
                    {item.separator ? (
                      <div className="menu-separator" />
                    ) : (
                      <button
                        className="menu-item"
                        onClick={() => handleItemClick(item.action)}
                      >
                        <span className="menu-item-label">{item.label}</span>
                        {item.shortcut && (
                          <span className="menu-item-shortcut">{item.shortcut}</span>
                        )}
                      </button>
                    )}
                    {showRecentAfter && (
                      <>
                        <div className="menu-separator" />
                        <div
                          className="menu-submenu-trigger"
                          ref={recentTriggerRef}
                          onMouseEnter={handleRecentEnter}
                          onMouseLeave={handleRecentLeave}
                        >
                          <button
                            className={`menu-item${recentSubmenuOpen ? ' menu-item--active' : ''}${!hasRecentFiles ? ' menu-item--disabled' : ''}`}
                            onClick={() => hasRecentFiles && setRecentSubmenuOpen(!recentSubmenuOpen)}
                          >
                            <span className="menu-item-label">Recent Files</span>
                            <span className="menu-item-arrow">
                              <ChevronRightIcon />
                            </span>
                          </button>
                          {recentSubmenuOpen && hasRecentFiles && (
                            <div
                              className="menu-submenu"
                              style={submenuPos ? { top: submenuPos.top, left: submenuPos.left } : undefined}
                              onMouseEnter={handleSubmenuEnter}
                              onMouseLeave={handleSubmenuLeave}
                            >
                              {recentFiles.map((entry) => (
                                <button
                                  key={entry.filePath}
                                  className="menu-item"
                                  onClick={() => {
                                    setOpen(false);
                                    setRecentSubmenuOpen(false);
                                    onOpenRecentFile?.(entry.filePath);
                                  }}
                                >
                                  <span className="menu-item-label">
                                    <span className="menu-recent-filename">{entry.filename}</span>
                                    <span className="menu-recent-path">{entry.truncatedPath}</span>
                                  </span>
                                </button>
                              ))}
                              <div className="menu-separator" />
                              <button
                                className="menu-item"
                                onClick={() => handleItemClick('clearRecentFiles')}
                              >
                                <span className="menu-item-label menu-item-label--muted">Clear Recent</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <line x1="3" y1="4.5" x2="13" y2="4.5" />
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="3" y1="11.5" x2="13" y2="11.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6,4 10,8 6,12" />
    </svg>
  );
}
