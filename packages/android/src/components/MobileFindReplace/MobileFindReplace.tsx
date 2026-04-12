import { useState, useRef, useEffect, useCallback } from "react";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorView as CmEditorView } from "@codemirror/view";
import { findReplacePluginKey } from "@pennivo/ui";
import { updateCmFind, cmFindField } from "@pennivo/ui";
import "./MobileFindReplace.css";

/* ─── Props ─── */

interface MobileFindReplaceProps {
  visible: boolean;
  getView: () => EditorView | null;
  getCmView?: () => CmEditorView | null;
  sourceMode?: boolean;
  onClose: () => void;
}

/* ─── Component ─── */

export function MobileFindReplace({
  visible,
  getView,
  getCmView,
  sourceMode = false,
  onClose,
}: MobileFindReplaceProps) {
  const [query, setQuery] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── ProseMirror backend ──

  const pmUpdateSearch = useCallback(
    (newQuery: string, newUseRegex: boolean) => {
      const view = getView();
      if (!view) return;
      const tr = view.state.tr.setMeta(findReplacePluginKey, {
        query: newQuery,
        useRegex: newUseRegex,
      });
      view.dispatch(tr);

      const state = findReplacePluginKey.getState(view.state);
      if (state) {
        setMatchCount(state.matches.length);
        setCurrentIndex(state.currentIndex);
        if (state.matches.length > 0 && state.currentIndex >= 0) {
          scrollToPmMatch(view, state.matches[state.currentIndex]!);
        }
      }
    },
    [getView],
  );

  const pmGoToMatch = useCallback(
    (direction: "next" | "prev") => {
      const view = getView();
      if (!view) return;
      const state = findReplacePluginKey.getState(view.state);
      if (!state || state.matches.length === 0) return;

      const newIndex =
        direction === "next"
          ? (state.currentIndex + 1) % state.matches.length
          : (state.currentIndex - 1 + state.matches.length) %
            state.matches.length;

      view.dispatch(
        view.state.tr.setMeta(findReplacePluginKey, { currentIndex: newIndex }),
      );
      setCurrentIndex(newIndex);
      scrollToPmMatch(view, state.matches[newIndex]!);
    },
    [getView],
  );

  const pmReplace = useCallback(() => {
    const view = getView();
    if (!view) return;
    const state = findReplacePluginKey.getState(view.state);
    if (!state || state.currentIndex < 0 || state.matches.length === 0) return;

    const match = state.matches[state.currentIndex]!;
    const tr = replaceText
      ? view.state.tr.replaceWith(
          match.from,
          match.to,
          view.state.schema.text(replaceText),
        )
      : view.state.tr.delete(match.from, match.to);
    view.dispatch(tr);

    const newState = findReplacePluginKey.getState(view.state);
    if (newState) {
      setMatchCount(newState.matches.length);
      setCurrentIndex(newState.currentIndex);
      if (newState.matches.length > 0 && newState.currentIndex >= 0) {
        scrollToPmMatch(view, newState.matches[newState.currentIndex]!);
      }
    }
  }, [getView, replaceText]);

  const pmReplaceAll = useCallback(() => {
    const view = getView();
    if (!view) return;
    const state = findReplacePluginKey.getState(view.state);
    if (!state || state.matches.length === 0) return;

    let tr = view.state.tr;
    const reversedMatches = [...state.matches].reverse();
    for (const match of reversedMatches) {
      tr = replaceText
        ? tr.replaceWith(
            match.from,
            match.to,
            view.state.schema.text(replaceText),
          )
        : tr.delete(match.from, match.to);
    }
    view.dispatch(tr);

    const newState = findReplacePluginKey.getState(view.state);
    if (newState) {
      setMatchCount(newState.matches.length);
      setCurrentIndex(newState.currentIndex);
    }
  }, [getView, replaceText]);

  const pmClear = useCallback(() => {
    const view = getView();
    if (view) {
      view.dispatch(
        view.state.tr.setMeta(findReplacePluginKey, {
          query: "",
          useRegex: false,
        }),
      );
    }
  }, [getView]);

  // ── CodeMirror backend ──

  const cmUpdateSearch = useCallback(
    (newQuery: string, newUseRegex: boolean) => {
      const view = getCmView?.();
      if (!view) return;
      view.dispatch({
        effects: updateCmFind.of({ query: newQuery, useRegex: newUseRegex }),
      });

      const state = view.state.field(cmFindField);
      setMatchCount(state.matches.length);
      setCurrentIndex(state.currentIndex);
      if (state.matches.length > 0 && state.currentIndex >= 0) {
        scrollToCmMatch(view, state.matches[state.currentIndex]!);
      }
    },
    [getCmView],
  );

  const cmGoToMatch = useCallback(
    (direction: "next" | "prev") => {
      const view = getCmView?.();
      if (!view) return;
      const state = view.state.field(cmFindField);
      if (state.matches.length === 0) return;

      const newIndex =
        direction === "next"
          ? (state.currentIndex + 1) % state.matches.length
          : (state.currentIndex - 1 + state.matches.length) %
            state.matches.length;

      view.dispatch({ effects: updateCmFind.of({ currentIndex: newIndex }) });
      setCurrentIndex(newIndex);
      scrollToCmMatch(view, state.matches[newIndex]!);
    },
    [getCmView],
  );

  const cmReplace = useCallback(() => {
    const view = getCmView?.();
    if (!view) return;
    const state = view.state.field(cmFindField);
    if (state.currentIndex < 0 || state.matches.length === 0) return;

    const match = state.matches[state.currentIndex]!;
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replaceText },
    });

    const newState = view.state.field(cmFindField);
    setMatchCount(newState.matches.length);
    setCurrentIndex(newState.currentIndex);
    if (newState.matches.length > 0 && newState.currentIndex >= 0) {
      scrollToCmMatch(view, newState.matches[newState.currentIndex]!);
    }
  }, [getCmView, replaceText]);

  const cmReplaceAll = useCallback(() => {
    const view = getCmView?.();
    if (!view) return;
    const state = view.state.field(cmFindField);
    if (state.matches.length === 0) return;

    const changes = [...state.matches].reverse().map((m) => ({
      from: m.from,
      to: m.to,
      insert: replaceText,
    }));
    view.dispatch({ changes });

    const newState = view.state.field(cmFindField);
    setMatchCount(newState.matches.length);
    setCurrentIndex(newState.currentIndex);
  }, [getCmView, replaceText]);

  const cmClear = useCallback(() => {
    const view = getCmView?.();
    if (view) {
      view.dispatch({
        effects: updateCmFind.of({ query: "", useRegex: false }),
      });
    }
  }, [getCmView]);

  // ── Unified dispatch based on mode ──

  const updateSearch = useCallback(
    (newQuery: string, newUseRegex: boolean) => {
      if (sourceMode) cmUpdateSearch(newQuery, newUseRegex);
      else pmUpdateSearch(newQuery, newUseRegex);
    },
    [sourceMode, cmUpdateSearch, pmUpdateSearch],
  );

  const goToMatch = useCallback(
    (direction: "next" | "prev") => {
      if (sourceMode) cmGoToMatch(direction);
      else pmGoToMatch(direction);
    },
    [sourceMode, cmGoToMatch, pmGoToMatch],
  );

  const doReplace = useCallback(() => {
    if (sourceMode) cmReplace();
    else pmReplace();
  }, [sourceMode, cmReplace, pmReplace]);

  const doReplaceAll = useCallback(() => {
    if (sourceMode) cmReplaceAll();
    else pmReplaceAll();
  }, [sourceMode, cmReplaceAll, pmReplaceAll]);

  // Re-run search when sourceMode changes while panel is open
  useEffect(() => {
    if (!visible || !query) return;
    const indexToRestore = currentIndex;

    if (sourceMode) {
      pmClear();
      const view = getCmView?.();
      if (view) {
        view.dispatch({
          effects: updateCmFind.of({
            query,
            useRegex,
            currentIndex: indexToRestore,
          }),
        });
        const state = view.state.field(cmFindField);
        setMatchCount(state.matches.length);
        setCurrentIndex(state.currentIndex);
        if (state.matches.length > 0 && state.currentIndex >= 0) {
          scrollToCmMatch(view, state.matches[state.currentIndex]!);
        }
      }
    } else {
      cmClear();
      const view = getView();
      if (view) {
        view.dispatch(
          view.state.tr.setMeta(findReplacePluginKey, {
            query,
            useRegex,
            currentIndex: indexToRestore,
          }),
        );
        const state = findReplacePluginKey.getState(view.state);
        if (state) {
          setMatchCount(state.matches.length);
          setCurrentIndex(state.currentIndex);
          if (state.matches.length > 0 && state.currentIndex >= 0) {
            scrollToPmMatch(view, state.matches[state.currentIndex]!);
          }
        }
      }
    }
  }, [sourceMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus search input when panel becomes visible
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        searchRef.current?.focus();
        searchRef.current?.select();
      });
    } else {
      pmClear();
      cmClear();
      setQuery("");
      setReplaceText("");
      setMatchCount(0);
      setCurrentIndex(-1);
    }
  }, [visible, pmClear, cmClear]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    updateSearch(value, useRegex);
  };

  const handleRegexToggle = () => {
    const next = !useRegex;
    setUseRegex(next);
    updateSearch(query, next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      if (sourceMode) {
        getCmView?.()?.focus();
      } else {
        getView()?.focus();
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      goToMatch("next");
    } else if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      goToMatch("prev");
    }
  };

  if (!visible) return null;

  const matchLabel =
    matchCount > 0
      ? `${currentIndex + 1} of ${matchCount}`
      : query
        ? "No results"
        : "";

  return (
    <div className="mobile-find-bar" onKeyDown={handleKeyDown} role="search">
      {/* Find row */}
      <div className="mobile-find-row">
        <div className="mobile-find-input-wrap">
          <input
            ref={searchRef}
            className="mobile-find-input"
            type="text"
            placeholder="Find..."
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="search"
            aria-label="Find"
          />
          {matchLabel && (
            <span className="mobile-find-match-count" aria-live="polite">
              {matchLabel}
            </span>
          )}
        </div>
        <button
          className={`mobile-find-btn mobile-find-btn--regex${useRegex ? " mobile-find-btn--active" : ""}`}
          onClick={handleRegexToggle}
          aria-label="Use regular expression"
          aria-pressed={useRegex}
          type="button"
        >
          .*
        </button>
        <button
          className="mobile-find-btn"
          onClick={() => goToMatch("prev")}
          aria-label="Previous match"
          type="button"
        >
          <ChevronUpIcon />
        </button>
        <button
          className="mobile-find-btn"
          onClick={() => goToMatch("next")}
          aria-label="Next match"
          type="button"
        >
          <ChevronDownIcon />
        </button>
        <button
          className="mobile-find-btn mobile-find-btn--close"
          onClick={onClose}
          aria-label="Close find and replace"
          type="button"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Replace row */}
      <div className="mobile-find-row">
        <div className="mobile-find-input-wrap">
          <input
            className="mobile-find-input"
            type="text"
            placeholder="Replace..."
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="done"
            aria-label="Replace"
          />
        </div>
        <button
          className="mobile-find-btn mobile-find-btn--action"
          onClick={doReplace}
          aria-label="Replace"
          type="button"
        >
          Replace
        </button>
        <button
          className="mobile-find-btn mobile-find-btn--action"
          onClick={doReplaceAll}
          aria-label="Replace all"
          type="button"
        >
          All
        </button>
      </div>
    </div>
  );
}

/* ─── Scroll helpers ─── */

function scrollToPmMatch(
  view: EditorView,
  match: { from: number; to: number },
) {
  const coords = view.coordsAtPos(match.from);
  const editorArea = view.dom.closest(".mobile-editor-area");
  if (!editorArea) return;

  const areaRect = editorArea.getBoundingClientRect();
  const relativeTop = coords.top - areaRect.top;
  const visibleHeight = areaRect.height;

  if (relativeTop < 60 || relativeTop > visibleHeight - 60) {
    editorArea.scrollTop += relativeTop - visibleHeight / 3;
  }
}

function scrollToCmMatch(
  view: CmEditorView,
  match: { from: number; to: number },
) {
  view.dispatch({
    selection: { anchor: match.from, head: match.to },
    scrollIntoView: true,
  });
}

/* ─── Icons ─── */

function ChevronUpIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4,10 8,6 12,10" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="4,6 8,10 12,6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
