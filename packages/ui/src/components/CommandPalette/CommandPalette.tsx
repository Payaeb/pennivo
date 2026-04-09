import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { fuzzyMatch } from '../../utils/fuzzyMatch';
import './CommandPalette.css';

export interface CommandItem {
  id: string;
  label: string;
  shortcut?: string;
  category?: string;
  keywords?: string;
}

interface CommandPaletteProps {
  visible: boolean;
  commands: CommandItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function CommandPalette({ visible, commands, onSelect, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after overlay renders
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [visible]);

  // Filter and sort commands
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;

    const results: { item: CommandItem; score: number }[] = [];
    for (const cmd of commands) {
      // Match against label, category, and keywords
      const searchText = [cmd.label, cmd.category, cmd.keywords].filter(Boolean).join(' ');
      const result = fuzzyMatch(query, searchText);
      if (result.match) {
        results.push({ item: cmd, score: result.score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.map(r => r.item);
  }, [commands, query]);

  // Clamp selection
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filtered[selectedIndex]) {
          onSelect(filtered[selectedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose();
        break;
      case 'Tab':
        // Focus trap: keep Tab/Shift+Tab within the palette
        e.preventDefault();
        break;
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  if (!visible) return null;

  return (
    <div className="command-palette-overlay" onMouseDown={onClose}>
      <div
        className="command-palette"
        onMouseDown={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="command-palette-input-row">
          <svg className="command-palette-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            placeholder="Type a command…"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search commands"
            aria-activedescendant={filtered[selectedIndex] ? `cp-option-${filtered[selectedIndex].id}` : undefined}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-listbox"
          />
        </div>
        <div className="command-palette-list" ref={listRef} role="listbox" id="command-palette-listbox">
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              id={`cp-option-${cmd.id}`}
              className={`command-palette-item${i === selectedIndex ? ' command-palette-item--selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => onSelect(cmd.id)}
              tabIndex={-1}
              role="option"
              aria-selected={i === selectedIndex}
            >
              <span className="command-palette-item-label">
                {cmd.category && <span className="command-palette-item-category">{cmd.category}</span>}
                {cmd.label}
              </span>
              {cmd.shortcut && <span className="command-palette-item-shortcut">{cmd.shortcut}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
