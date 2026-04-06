import { useState, useRef, useEffect, useCallback } from 'react';
import type { EditorView } from '@milkdown/prose/view';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import './FindReplace.css';

export const findReplacePluginKey = new PluginKey<FindReplaceState>('findReplace');

interface FindReplaceState {
  query: string;
  useRegex: boolean;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

interface ProseMirrorNode {
  content: { size: number };
  descendants: (callback: (node: ProseMirrorNode, pos: number) => boolean | void) => void;
  isText: boolean;
  isBlock: boolean;
  text?: string;
}

function buildMatches(
  doc: ProseMirrorNode,
  query: string,
  useRegex: boolean,
): Array<{ from: number; to: number }> {
  if (!query) return [];

  // Walk the document to build text with a position map.
  // Each character in our flat text string maps to a document position.
  let fullText = '';
  const posMap: number[] = []; // posMap[textIndex] = docPos
  let prevBlockEnd = false;

  doc.descendants((node, pos) => {
    if (node.isBlock && fullText.length > 0 && !prevBlockEnd) {
      // Insert newline between blocks (no doc position)
      fullText += '\n';
      posMap.push(-1);
      prevBlockEnd = true;
    }
    if (node.isText && node.text) {
      prevBlockEnd = false;
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        fullText += node.text[i];
      }
    }
  });

  const matches: Array<{ from: number; to: number }> = [];

  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, 'gi');
    } catch {
      // Invalid regex — escape special chars and search literally
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, 'gi');
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const from = posMap[m.index];
      const to = posMap[m.index + m[0].length - 1] + 1;
      if (from >= 0 && to > 0) matches.push({ from, to });
    }
  } else {
    const lower = query.toLowerCase();
    const textLower = fullText.toLowerCase();
    let idx = 0;
    while ((idx = textLower.indexOf(lower, idx)) !== -1) {
      const from = posMap[idx];
      const to = posMap[idx + lower.length - 1] + 1;
      if (from >= 0 && to > 0) matches.push({ from, to });
      idx += lower.length;
    }
  }

  return matches;
}

export function createFindReplacePlugin() {
  return new Plugin<FindReplaceState>({
    key: findReplacePluginKey,
    state: {
      init() {
        return { query: '', useRegex: false, matches: [], currentIndex: -1 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(findReplacePluginKey) as Partial<FindReplaceState> | undefined;
        if (meta) {
          const next = { ...prev, ...meta };
          // Rebuild matches if query or regex toggled or doc changed
          if (meta.query !== undefined || meta.useRegex !== undefined || tr.docChanged) {
            next.matches = buildMatches(tr.doc, next.query, next.useRegex);
            if (next.currentIndex >= next.matches.length) next.currentIndex = next.matches.length > 0 ? 0 : -1;
            if (next.currentIndex === -1 && next.matches.length > 0) next.currentIndex = 0;
          }
          return next;
        }
        if (tr.docChanged && prev.query) {
          const matches = buildMatches(tr.doc, prev.query, prev.useRegex);
          const currentIndex = matches.length > 0
            ? Math.min(prev.currentIndex, matches.length - 1)
            : -1;
          return { ...prev, matches, currentIndex: currentIndex < 0 ? (matches.length > 0 ? 0 : -1) : currentIndex };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const pluginState = findReplacePluginKey.getState(state);
        if (!pluginState || !pluginState.query || pluginState.matches.length === 0) {
          return DecorationSet.empty;
        }

        const decos = pluginState.matches.map((m, i) => {
          const className = i === pluginState.currentIndex
            ? 'find-match find-match--current'
            : 'find-match';
          return Decoration.inline(m.from, m.to, { class: className });
        });

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

interface FindReplaceProps {
  visible: boolean;
  getView: () => EditorView | null;
  onClose: () => void;
}

export function FindReplace({ visible, getView, onClose }: FindReplaceProps) {
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  // Update plugin state when query or regex changes
  const updateSearch = useCallback((newQuery: string, newUseRegex: boolean) => {
    const view = getView();
    if (!view) return;
    const tr = view.state.tr.setMeta(findReplacePluginKey, {
      query: newQuery,
      useRegex: newUseRegex,
    });
    view.dispatch(tr);

    // Read back the computed state
    const state = findReplacePluginKey.getState(view.state);
    if (state) {
      setMatchCount(state.matches.length);
      setCurrentIndex(state.currentIndex);
      if (state.matches.length > 0 && state.currentIndex >= 0) {
        scrollToMatch(view, state.matches[state.currentIndex]);
      }
    }
  }, [getView]);

  // Focus search input when panel becomes visible
  useEffect(() => {
    if (visible) {
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    } else {
      // Clear search decorations when closing
      const view = getView();
      if (view) {
        const tr = view.state.tr.setMeta(findReplacePluginKey, {
          query: '',
          useRegex: false,
        });
        view.dispatch(tr);
      }
      setQuery('');
      setReplaceText('');
      setMatchCount(0);
      setCurrentIndex(-1);
    }
  }, [visible, getView]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    updateSearch(value, useRegex);
  };

  const handleRegexToggle = () => {
    const next = !useRegex;
    setUseRegex(next);
    updateSearch(query, next);
  };

  const goToMatch = useCallback((direction: 'next' | 'prev') => {
    const view = getView();
    if (!view) return;
    const state = findReplacePluginKey.getState(view.state);
    if (!state || state.matches.length === 0) return;

    let newIndex: number;
    if (direction === 'next') {
      newIndex = (state.currentIndex + 1) % state.matches.length;
    } else {
      newIndex = (state.currentIndex - 1 + state.matches.length) % state.matches.length;
    }

    const tr = view.state.tr.setMeta(findReplacePluginKey, { currentIndex: newIndex });
    view.dispatch(tr);
    setCurrentIndex(newIndex);
    scrollToMatch(view, state.matches[newIndex]);
  }, [getView]);

  const doReplace = useCallback(() => {
    const view = getView();
    if (!view) return;
    const state = findReplacePluginKey.getState(view.state);
    if (!state || state.currentIndex < 0 || state.matches.length === 0) return;

    const match = state.matches[state.currentIndex];
    let tr;
    if (replaceText) {
      tr = view.state.tr.replaceWith(match.from, match.to, view.state.schema.text(replaceText));
    } else {
      tr = view.state.tr.delete(match.from, match.to);
    }
    view.dispatch(tr);

    // Re-read state after replacement
    const newState = findReplacePluginKey.getState(view.state);
    if (newState) {
      setMatchCount(newState.matches.length);
      setCurrentIndex(newState.currentIndex);
      if (newState.matches.length > 0 && newState.currentIndex >= 0) {
        scrollToMatch(view, newState.matches[newState.currentIndex]);
      }
    }
  }, [getView, replaceText]);

  const doReplaceAll = useCallback(() => {
    const view = getView();
    if (!view) return;
    const state = findReplacePluginKey.getState(view.state);
    if (!state || state.matches.length === 0) return;

    // Replace all matches in reverse order to preserve positions
    let tr = view.state.tr;
    const reversedMatches = [...state.matches].reverse();
    for (const match of reversedMatches) {
      if (replaceText) {
        tr = tr.replaceWith(match.from, match.to, view.state.schema.text(replaceText));
      } else {
        tr = tr.delete(match.from, match.to);
      }
    }
    view.dispatch(tr);

    const newState = findReplacePluginKey.getState(view.state);
    if (newState) {
      setMatchCount(newState.matches.length);
      setCurrentIndex(newState.currentIndex);
    }
  }, [getView, replaceText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      // Re-focus the editor
      getView()?.focus();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      goToMatch('next');
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      goToMatch('prev');
    }
  };

  if (!visible) return null;

  const matchLabel = matchCount > 0
    ? `${currentIndex + 1} of ${matchCount}`
    : query ? 'No results' : '';

  return (
    <div className="find-replace-bar" onKeyDown={handleKeyDown}>
      <div className="find-replace-row">
        <div className="find-input-wrapper">
          <input
            ref={searchRef}
            className="find-input"
            type="text"
            placeholder="Find..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            spellCheck={false}
          />
          {matchLabel && <span className="find-match-count">{matchLabel}</span>}
        </div>
        <button
          className={`find-btn find-btn--regex${useRegex ? ' find-btn--active' : ''}`}
          onClick={handleRegexToggle}
          title="Use regular expression"
          tabIndex={-1}
        >
          .*
        </button>
        <button className="find-btn" onClick={() => goToMatch('prev')} title="Previous match (Shift+Enter)" tabIndex={-1}>
          <ChevronUpIcon />
        </button>
        <button className="find-btn" onClick={() => goToMatch('next')} title="Next match (Enter)" tabIndex={-1}>
          <ChevronDownIcon />
        </button>
        <button className="find-btn find-btn--close" onClick={onClose} title="Close (Escape)" tabIndex={-1}>
          <CloseIcon />
        </button>
      </div>
      <div className="find-replace-row">
        <div className="find-input-wrapper">
          <input
            className="find-input"
            type="text"
            placeholder="Replace..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            spellCheck={false}
          />
        </div>
        <button className="find-btn find-btn--action" onClick={doReplace} title="Replace" tabIndex={-1}>
          Replace
        </button>
        <button className="find-btn find-btn--action" onClick={doReplaceAll} title="Replace All" tabIndex={-1}>
          All
        </button>
      </div>
    </div>
  );
}

function scrollToMatch(view: EditorView, match: { from: number; to: number }) {
  const coords = view.coordsAtPos(match.from);
  const editorArea = view.dom.closest('.app-editor-area');
  if (!editorArea) return;

  const areaRect = editorArea.getBoundingClientRect();
  const relativeTop = coords.top - areaRect.top;
  const visibleHeight = areaRect.height;

  // Only scroll if the match is outside the visible area (with padding)
  if (relativeTop < 60 || relativeTop > visibleHeight - 60) {
    editorArea.scrollTop += relativeTop - visibleHeight / 3;
  }
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,10 8,6 12,10" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
