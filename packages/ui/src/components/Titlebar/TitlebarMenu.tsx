import { useState, useEffect, useRef } from 'react';
import './TitlebarMenu.css';

export type MenuAction =
  | 'open' | 'save' | 'saveAs' | 'quit'
  | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  | 'focusMode' | 'toggleTheme'
  | 'zoomIn' | 'zoomOut' | 'resetZoom';

interface TitlebarMenuProps {
  onAction: (action: MenuAction) => void;
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
      { label: 'Open\u2026',   action: 'open',   shortcut: 'Ctrl+O' },
      { label: 'Save',         action: 'save',   shortcut: 'Ctrl+S' },
      { label: 'Save As\u2026', action: 'saveAs', shortcut: 'Ctrl+Shift+S' },
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
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Focus Mode',   action: 'focusMode',   shortcut: 'Ctrl+Shift+F' },
      { label: 'Toggle Theme', action: 'toggleTheme' },
      { separator: true, label: '' },
      { label: 'Zoom In',      action: 'zoomIn',      shortcut: 'Ctrl+=' },
      { label: 'Zoom Out',     action: 'zoomOut',     shortcut: 'Ctrl+\u2013' },
      { label: 'Reset Zoom',   action: 'resetZoom',   shortcut: 'Ctrl+0' },
    ],
  },
];

export function TitlebarMenu({ onAction }: TitlebarMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleItemClick = (action?: MenuAction) => {
    if (!action) return;
    setOpen(false);
    onAction(action);
  };

  return (
    <div className="titlebar-menu" ref={menuRef}>
      <button
        className={`titlebar-menu-btn${open ? ' titlebar-menu-btn--open' : ''}`}
        onClick={() => setOpen(!open)}
        title="Menu"
        tabIndex={-1}
        aria-label="Application menu"
        aria-expanded={open}
      >
        <HamburgerIcon />
      </button>

      {open && (
        <div className="titlebar-menu-dropdown">
          {MENU_SECTIONS.map((section) => (
            <div key={section.label} className="menu-section">
              <div className="menu-section-label">{section.label}</div>
              {section.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="menu-separator" />
                ) : (
                  <button
                    key={item.action}
                    className="menu-item"
                    onClick={() => handleItemClick(item.action)}
                  >
                    <span className="menu-item-label">{item.label}</span>
                    {item.shortcut && (
                      <span className="menu-item-shortcut">{item.shortcut}</span>
                    )}
                  </button>
                ),
              )}
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
