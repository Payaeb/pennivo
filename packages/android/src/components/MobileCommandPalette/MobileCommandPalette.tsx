import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { fuzzyMatch } from "../../../../ui/src/utils/fuzzyMatch";
import "./MobileCommandPalette.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MobileCommand {
  id: string;
  label: string;
  category: string;
  keywords?: string;
  icon: React.ReactNode;
}

interface MobileCommandPaletteProps {
  visible: boolean;
  commands: MobileCommand[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function MobileCommandPalette({
  visible,
  commands,
  onSelect,
  onClose,
}: MobileCommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [animateIn, setAnimateIn] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Animate in after mount; reset state when opened
  useEffect(() => {
    if (visible) {
      setQuery("");
      setSelectedIndex(0);
      // Trigger slide-up on next frame so the initial translateY(100%) is painted first
      requestAnimationFrame(() => {
        setAnimateIn(true);
        // Focus the search input after the sheet starts animating
        setTimeout(() => inputRef.current?.focus(), 80);
      });
    } else {
      setAnimateIn(false);
    }
  }, [visible]);

  // Filter and sort commands via fuzzy match
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;

    const results: { item: MobileCommand; score: number }[] = [];
    for (const cmd of commands) {
      const searchText = [cmd.label, cmd.category, cmd.keywords]
        .filter(Boolean)
        .join(" ");
      const result = fuzzyMatch(query, searchText);
      if (result.match) {
        results.push({ item: cmd, score: result.score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.map((r) => r.item);
  }, [commands, query]);

  // Clamp selection when results change
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Handle keyboard (for hardware keyboards attached to Android)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex].id);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  // Close with slide-down animation
  const handleClose = useCallback(() => {
    setAnimateIn(false);
    // Wait for the slide-down transition to finish before unmounting
    setTimeout(() => onClose(), 300);
  }, [onClose]);

  const handleSelect = useCallback(
    (id: string) => {
      setAnimateIn(false);
      setTimeout(() => onSelect(id), 200);
    },
    [onSelect],
  );

  if (!visible) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={`mcp-backdrop${animateIn ? " mcp-backdrop--visible" : ""}`}
        onClick={handleClose}
        aria-hidden="true"
      />
      {/* Bottom sheet */}
      <div
        className={`mcp-sheet${animateIn ? " mcp-sheet--visible" : ""}`}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        {/* Drag handle */}
        <div className="mcp-handle" />

        {/* Search input */}
        <div className="mcp-search-row">
          <svg
            className="mcp-search-icon"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <line x1="13" y1="13" x2="18" y2="18" />
          </svg>
          <input
            ref={inputRef}
            className="mcp-search-input"
            type="text"
            placeholder="Search commands..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="mcp-listbox"
          />
        </div>

        {/* Command list */}
        <div
          className="mcp-list"
          ref={listRef}
          role="listbox"
          id="mcp-listbox"
        >
          {filtered.length === 0 && (
            <div className="mcp-empty">No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`mcp-item${i === selectedIndex ? " mcp-item--selected" : ""}`}
              onClick={() => handleSelect(cmd.id)}
              onMouseDown={(e) => e.preventDefault()}
              tabIndex={-1}
              role="option"
              aria-selected={i === selectedIndex}
              type="button"
            >
              <span className="mcp-item-icon">{cmd.icon}</span>
              <span className="mcp-item-content">
                <span className="mcp-item-label">{cmd.label}</span>
                {cmd.category && (
                  <span className="mcp-item-category">{cmd.category}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared SVG icons for commands                                      */
/* ------------------------------------------------------------------ */

function FormatIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2h8l-4 12" />
      <line x1="2" y1="8" x2="10" y2="8" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <path d="M1 8c1.5-3.5 4-5 7-5s5.5 1.5 7 5c-1.5 3.5-4 5-7 5s-5.5-1.5-7-5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5L9 1z" />
      <polyline points="9,1 9,5 13,5" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="4" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3" />
      <polyline points="8,2 8,10" />
      <polyline points="5,5 8,2 11,5" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M6.6 1.6h2.8l.4 1.8.8.4 1.6-.8 2 2-.8 1.6.4.8 1.8.4v2.8l-1.8.4-.4.8.8 1.6-2 2-1.6-.8-.8.4-.4 1.8H6.6l-.4-1.8-.8-.4-1.6.8-2-2 .8-1.6-.4-.8-1.8-.4V6.6l1.8-.4.4-.8-.8-1.6 2-2 1.6.8.8-.4z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Default mobile commands list                                       */
/* ------------------------------------------------------------------ */

export const MOBILE_COMMANDS: MobileCommand[] = [
  // Format
  { id: "bold", label: "Bold", category: "Format", keywords: "strong", icon: <FormatIcon /> },
  { id: "italic", label: "Italic", category: "Format", keywords: "emphasis", icon: <FormatIcon /> },
  { id: "strikethrough", label: "Strikethrough", category: "Format", icon: <FormatIcon /> },
  { id: "h1", label: "Heading 1", category: "Format", keywords: "title header", icon: <FormatIcon /> },
  { id: "h2", label: "Heading 2", category: "Format", keywords: "subtitle header", icon: <FormatIcon /> },
  { id: "bulletList", label: "Bullet List", category: "Format", keywords: "unordered", icon: <FormatIcon /> },
  { id: "orderedList", label: "Ordered List", category: "Format", keywords: "numbered", icon: <FormatIcon /> },
  { id: "taskList", label: "Task List", category: "Format", keywords: "checkbox todo", icon: <FormatIcon /> },
  { id: "blockquote", label: "Blockquote", category: "Format", keywords: "quote", icon: <FormatIcon /> },
  { id: "code", label: "Code", category: "Format", keywords: "inline block", icon: <FormatIcon /> },
  { id: "table", label: "Table", category: "Format", icon: <FormatIcon /> },
  // View
  { id: "sourceMode", label: "Toggle Source Mode", category: "View", keywords: "markdown code raw", icon: <ViewIcon /> },
  { id: "toggleTheme", label: "Toggle Theme", category: "View", keywords: "dark light mode", icon: <ThemeIcon /> },
  { id: "findReplace", label: "Find & Replace", category: "View", keywords: "search", icon: <SearchIcon /> },
  { id: "toggleStats", label: "Toggle Word Count", category: "View", keywords: "word count character stats reading time hide show", icon: <ViewIcon /> },
  // Export
  { id: "exportHtml", label: "Export as HTML", category: "Export", keywords: "share html web", icon: <ExportIcon /> },
  { id: "exportPdf", label: "Export as PDF", category: "Export", keywords: "print pdf save", icon: <ExportIcon /> },
  // File
  { id: "newFile", label: "New File", category: "File", keywords: "create", icon: <FileIcon /> },
  { id: "save", label: "Save Now", category: "File", icon: <FileIcon /> },
  { id: "browseFiles", label: "Browse Files", category: "File", keywords: "open", icon: <FileIcon /> },
  // Settings
  { id: "settings", label: "Settings", category: "App", keywords: "preferences options config font theme", icon: <SettingsIcon /> },
];
