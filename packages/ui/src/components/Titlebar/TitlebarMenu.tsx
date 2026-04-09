import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import './TitlebarMenu.css';

export type MenuAction =
  | 'newFile' | 'open' | 'save' | 'saveAs' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'focusMode' | 'sourceMode' | 'toggleTheme' | 'toggleSidebar' | 'toggleOutline' | 'setFolder'
  | 'zoomIn' | 'zoomOut' | 'resetZoom'
  | 'findReplace' | 'clearRecentFiles'
  | 'exportHtml' | 'exportPdf'
  | 'spellcheckSettings'
  | 'cycleTheme' | 'themeDefault' | 'themeSepia' | 'themeNord' | 'themeRosepine'
  | 'customizeToolbar'
  | 'openSettings' | 'showShortcuts' | 'showAbout';

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
      { label: 'Export as PDF',  action: 'exportPdf' },
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
      { label: 'Customize Toolbar\u2026', action: 'customizeToolbar' },
      { label: 'Settings\u2026', action: 'openSettings', shortcut: 'Ctrl+,' },
      { separator: true, label: '' },
      { label: 'Zoom In',      action: 'zoomIn',      shortcut: 'Ctrl+=' },
      { label: 'Zoom Out',     action: 'zoomOut',     shortcut: 'Ctrl+\u2013' },
      { label: 'Reset Zoom',   action: 'resetZoom',   shortcut: 'Ctrl+0' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Keyboard Shortcuts', action: 'showShortcuts', shortcut: 'Ctrl+/' },
      { separator: true, label: '' },
      { label: 'About Pennivo', action: 'showAbout' },
    ],
  },
];

export function TitlebarMenu({ onAction, recentFiles, onOpenRecentFile }: TitlebarMenuProps) {
  const [open, setOpen] = useState(false);
  const [expandedSection, setExpandedSection] = useState('File');
  const [recentSubmenuOpen, setRecentSubmenuOpen] = useState(false);
  const [submenuPos, setSubmenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const recentTriggerRef = useRef<HTMLDivElement>(null);
  const recentTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const submenuRef = useRef<HTMLDivElement>(null);

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

  // Adjust submenu position if it overflows the viewport
  useLayoutEffect(() => {
    if (!recentSubmenuOpen || !submenuRef.current || !recentTriggerRef.current) return;
    const el = submenuRef.current;
    const rect = el.getBoundingClientRect();
    const triggerRect = recentTriggerRef.current.getBoundingClientRect();

    if (rect.right > window.innerWidth) {
      el.style.left = `${Math.max(8, triggerRect.left - rect.width - 2)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      const shifted = Math.max(8, window.innerHeight - rect.height - 8);
      el.style.top = `${shifted}px`;
      // If it still doesn't fit after shifting, cap height and scroll
      if (rect.height > window.innerHeight - 16) {
        el.style.top = '8px';
        el.style.maxHeight = `${window.innerHeight - 16}px`;
        el.style.overflowY = 'auto';
      }
    }
  }, [recentSubmenuOpen]);

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

  // Keyboard navigation for menu items
  const handleMenuKeyDown = useCallback((e: React.KeyboardEvent) => {
    const dropdown = menuRef.current?.querySelector('.titlebar-menu-dropdown');
    if (!dropdown) return;

    const items = Array.from(dropdown.querySelectorAll<HTMLElement>('.menu-item:not(.menu-item--disabled), .menu-section-header'));
    if (items.length === 0) return;

    const currentIdx = items.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0;
        items[nextIdx]?.focus();
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1;
        items[prevIdx]?.focus();
        break;
      }
      case 'Tab': {
        // Focus trap within open menu
        e.preventDefault();
        break;
      }
    }
  }, []);

  return (
    <div className="titlebar-menu" ref={menuRef}>
      <button
        className={`titlebar-menu-btn${open ? ' titlebar-menu-btn--open' : ''}`}
        onClick={() => { setOpen(!open); setRecentSubmenuOpen(false); setExpandedSection('File'); }}
        title="Menu"
        tabIndex={-1}
        aria-label="Application menu"
        aria-expanded={open}
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div className="titlebar-menu-dropdown" role="menu" onKeyDown={handleMenuKeyDown}>
          {MENU_SECTIONS.map((section, sectionIdx) => {
            const isExpanded = expandedSection === section.label;
            return (
              <div key={section.label} className="menu-section">
                <button
                  className={`menu-section-header${isExpanded ? ' menu-section-header--expanded' : ''}`}
                  onClick={() => setExpandedSection(isExpanded ? '' : section.label)}
                  aria-expanded={isExpanded}
                  role="menuitem"
                >
                  <span className="menu-section-chevron">
                    <ChevronRightIcon />
                  </span>
                  <span className="menu-section-header-label">{section.label}</span>
                </button>
                <div className={`menu-section-body${isExpanded ? ' menu-section-body--open' : ''}`}>
                  <div className="menu-section-inner">
                    {section.items.map((item, i) => {
                      const showRecentAfter = sectionIdx === 0 && item.action === 'saveAs';

                      return (
                        <div key={item.separator ? `sep-${i}` : item.action}>
                          {item.separator ? (
                            <div className="menu-separator" />
                          ) : (
                            <button
                              className="menu-item"
                              onClick={() => handleItemClick(item.action)}
                              role="menuitem"
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
                                  role="menuitem"
                                  aria-expanded={recentSubmenuOpen}
                                  aria-disabled={!hasRecentFiles}
                                >
                                  <span className="menu-item-label">Recent Files</span>
                                  <span className="menu-item-arrow">
                                    <ChevronRightIcon />
                                  </span>
                                </button>
                                {recentSubmenuOpen && hasRecentFiles && (
                                  <div
                                    ref={submenuRef}
                                    className="menu-submenu"
                                    role="menu"
                                    aria-label="Recent files"
                                    style={submenuPos ? { top: submenuPos.top, left: submenuPos.left } : undefined}
                                    onMouseEnter={handleSubmenuEnter}
                                    onMouseLeave={handleSubmenuLeave}
                                  >
                                    {recentFiles.map((entry) => (
                                      <button
                                        key={entry.filePath}
                                        className="menu-item"
                                        role="menuitem"
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
                                      role="menuitem"
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
                </div>
              </div>
            );
          })}
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
