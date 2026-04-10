import { useEffect, useRef } from "react";
import "./ShortcutsSheet.css";

interface ShortcutsSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface ShortcutEntry {
  action: string;
  keys: string; // e.g. "Ctrl+B"
}

interface ShortcutGroup {
  title: string;
  items: ShortcutEntry[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Formatting",
    items: [
      { action: "Bold", keys: "Ctrl+B" },
      { action: "Italic", keys: "Ctrl+I" },
      { action: "Insert Link", keys: "Ctrl+K" },
    ],
  },
  {
    title: "File",
    items: [
      { action: "New File", keys: "Ctrl+N" },
      { action: "Open File", keys: "Ctrl+O" },
      { action: "Save", keys: "Ctrl+S" },
      { action: "Save As", keys: "Ctrl+Shift+S" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { action: "Command Palette", keys: "Ctrl+Shift+P" },
      { action: "Outline Panel", keys: "Ctrl+Shift+O" },
      { action: "Find & Replace", keys: "Ctrl+F" },
      { action: "Toggle Sidebar", keys: "Ctrl+B" },
    ],
  },
  {
    title: "View",
    items: [
      { action: "Focus Mode", keys: "Ctrl+Shift+F" },
      { action: "Shortcuts", keys: "Ctrl+/" },
    ],
  },
  {
    title: "Export",
    items: [{ action: "Export HTML", keys: "Ctrl+Shift+E" }],
  },
];

function renderKeys(keys: string) {
  const parts = keys.split("+");
  return (
    <span className="shortcuts-keys">
      {parts.map((part, i) => (
        <kbd key={i} className="shortcuts-kbd">
          {part}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsSheet({ visible, onClose }: ShortcutsSheetProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, onClose]);

  if (!visible) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      className="shortcuts-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div
        className="shortcuts-card"
        role="dialog"
        aria-label="Keyboard Shortcuts"
      >
        <div className="shortcuts-header">
          <span className="shortcuts-title">Keyboard Shortcuts</span>
          <button
            className="shortcuts-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
        <div className="shortcuts-body">
          {SHORTCUT_GROUPS.map((group) => (
            <div className="shortcuts-group" key={group.title}>
              <div className="shortcuts-group-title">{group.title}</div>
              <div className="shortcuts-columns">
                {group.items.map((item) => (
                  <div className="shortcuts-row" key={item.action}>
                    <span className="shortcuts-action">{item.action}</span>
                    {renderKeys(item.keys)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
