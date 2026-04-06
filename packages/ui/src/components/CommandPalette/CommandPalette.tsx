import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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

function fuzzyMatch(query: string, text: string): { match: boolean; score: number } {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();

  // Exact substring match scores highest
  if (lower.includes(q)) {
    const idx = lower.indexOf(q);
    // Bonus for matching at word start
    const atStart = idx === 0 || text[idx - 1] === ' ';
    return { match: true, score: atStart ? 100 - idx : 50 - idx };
  }

  // Fuzzy: every query char must appear in order
  let qi = 0;
  let score = 0;
  let prevIdx = -1;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      // Consecutive chars score higher
      score += (i === prevIdx + 1) ? 3 : 1;
      prevIdx = i;
      qi++;
    }
  }

  if (qi === q.length) {
    return { match: true, score };
  }
  return { match: false, score: 0 };
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
    }
  }, [filtered, selectedIndex, onSelect, onClose]);

  if (!visible) return null;

  return (
    <div className="command-palette-overlay" onMouseDown={onClose}>
      <div className="command-palette" onMouseDown={e => e.stopPropagation()} onKeyDown={handleKeyDown}>
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
          />
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="command-palette-empty">No matching commands</div>
          )}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`command-palette-item${i === selectedIndex ? ' command-palette-item--selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => onSelect(cmd.id)}
              tabIndex={-1}
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
