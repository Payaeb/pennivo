import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
} from "react";
import type { SearchResults, SearchOptions } from "@pennivo/core";
import {
  joinWorkspacePath,
  flattenResults,
  type FlatResultItem,
} from "./searchPanelUtils";
import "./GlobalSearchPanel.css";

/**
 * Where in the opened file to land the cursor / highlight after a result is
 * clicked. Carries everything the host needs to jump in either editor mode:
 * - `line` (1-based) for context / source-mode line targeting,
 * - `fileOffset` (0-based absolute char offset into the raw file) which equals
 *   the CodeMirror doc offset in source mode,
 * - `query` so WYSIWYG mode can re-find the term (raw offsets do not map 1:1
 *   to ProseMirror positions).
 */
export interface GlobalSearchJumpTarget {
  line: number;
  fileOffset: number;
  query: string;
}

export interface GlobalSearchPanelProps {
  /**
   * Active workspace root (absolute). Used to display the scope and to convert
   * a workspace-relative result path into an absolute path before opening.
   */
  rootPath: string | null;
  /**
   * Run the search. The host wires this to `platform.searchWorkspace` so the
   * component stays presentational (no platform import).
   */
  onSearch: (query: string, options?: SearchOptions) => Promise<SearchResults>;
  /**
   * Open a result. Receives the already-joined ABSOLUTE path plus the jump
   * target ({ line, fileOffset, query }) so the host can scroll to and
   * highlight the exact match after the file loads.
   */
  onOpenResult: (absPath: string, target: GlobalSearchJumpTarget) => void;
  /** Close search and return the rail to tree mode (Escape from an empty input). */
  onClose: () => void;
}

const DEBOUNCE_MS = 200;
const MIN_QUERY_CHARS = 2;

export function GlobalSearchPanel({
  rootPath,
  onSearch,
  onOpenResult,
  onClose,
}: GlobalSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // True once a query has actually been searched, so the empty list can show
  // "No matches" (searched, zero hits) vs "Type to search" (nothing searched).
  const [hasSearched, setHasSearched] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Monotonic request id: each dispatched search increments it, and a response
  // only commits if it still matches. Guarantees last-write-wins on the async
  // results so a slow earlier query can never clobber a newer one.
  const requestIdRef = useRef(0);

  // Focus the input on mount (the rail just swapped to search mode).
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const trimmedLen = query.trim().length;

  // Debounced search. Re-runs whenever the query or an option toggle changes.
  // Queries shorter than MIN_QUERY_CHARS clear the results without searching.
  useEffect(() => {
    if (trimmedLen < MIN_QUERY_CHARS) {
      requestIdRef.current += 1; // invalidate any in-flight response
      setResults(null);
      setHasSearched(false);
      setSelectedIndex(0);
      return;
    }

    const handle = setTimeout(() => {
      const id = ++requestIdRef.current;
      void onSearch(query, { caseSensitive, wholeWord }).then((res) => {
        // Stale response: a newer search has since been dispatched. Drop it.
        if (id !== requestIdRef.current) return;
        setResults(res);
        setHasSearched(true);
        setSelectedIndex(0);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, trimmedLen, caseSensitive, wholeWord, onSearch]);

  const flatItems = useMemo(
    () => flattenResults(results?.files ?? []),
    [results],
  );

  // Clamp the selection when the result set shrinks.
  useEffect(() => {
    if (selectedIndex >= flatItems.length) {
      setSelectedIndex(Math.max(0, flatItems.length - 1));
    }
  }, [flatItems.length, selectedIndex]);

  // Scroll the selected row into view as it moves.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(
      `[data-result-index="${selectedIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openItem = useCallback(
    (item: FlatResultItem | undefined) => {
      if (!item || !rootPath) return;
      const absPath = joinWorkspacePath(rootPath, item.file.path);
      onOpenResult(absPath, {
        line: item.result.line,
        fileOffset: item.result.fileOffset,
        query,
      });
    },
    [rootPath, onOpenResult, query],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          openItem(flatItems[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          // First Escape clears a non-empty query; a second (empty) closes.
          if (query) {
            setQuery("");
          } else {
            onClose();
          }
          break;
      }
    },
    [flatItems, selectedIndex, openItem, query, onClose],
  );

  // Map each flat item to its global result index for selection + data attrs.
  const indexByCoord = useMemo(() => {
    const map = new Map<string, number>();
    flatItems.forEach((item, idx) => {
      map.set(`${item.fileIndex}:${item.lineIndex}`, idx);
    });
    return map;
  }, [flatItems]);

  const showEmpty = flatItems.length === 0;

  // Number of result LINES actually rendered. `totalMatches` is the true count
  // of term occurrences (including any beyond the cap), so it is wrong for both
  // the "showing N" footer and a capped summary; this reflects what is on screen.
  const shownResults = useMemo(
    () => (results?.files ?? []).reduce((n, f) => n + f.lines.length, 0),
    [results],
  );

  return (
    <div className="global-search" role="search" onKeyDown={handleKeyDown}>
      <div className="global-search-input-row">
        <svg
          className="global-search-icon"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <input
          ref={inputRef}
          className="global-search-input"
          type="text"
          placeholder="Search in workspace..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search in workspace"
        />
        <div className="global-search-toggles">
          <button
            type="button"
            className={`global-search-toggle${caseSensitive ? " global-search-toggle--active" : ""}`}
            onClick={() => setCaseSensitive((v) => !v)}
            title="Match case"
            aria-label="Match case"
            aria-pressed={caseSensitive}
            tabIndex={-1}
          >
            Aa
          </button>
          <button
            type="button"
            className={`global-search-toggle${wholeWord ? " global-search-toggle--active" : ""}`}
            onClick={() => setWholeWord((v) => !v)}
            title="Match whole word"
            aria-label="Match whole word"
            aria-pressed={wholeWord}
            tabIndex={-1}
          >
            <WholeWordIcon />
          </button>
        </div>
      </div>

      {!showEmpty && results && (
        <div className="global-search-summary" aria-live="polite">
          {results.capped ? (
            <>
              Showing {shownResults} of {results.totalMatches} match
              {results.totalMatches === 1 ? "" : "es"}
            </>
          ) : (
            <>
              {results.totalMatches} match
              {results.totalMatches === 1 ? "" : "es"} in {results.files.length}{" "}
              file{results.files.length === 1 ? "" : "s"}
            </>
          )}
        </div>
      )}

      <div className="global-search-results" ref={listRef} role="listbox">
        {showEmpty ? (
          <div className="global-search-empty">
            {hasSearched ? "No matches" : "Type to search"}
          </div>
        ) : (
          results?.files.map((file, fileIndex) => (
            <Fragment key={file.path}>
              <div className="global-search-file" title={file.path}>
                <span className="global-search-file-path">{file.path}</span>
                <span className="global-search-file-count">
                  {file.matchCount}
                </span>
              </div>
              {file.lines.map((result, lineIndex) => {
                const idx = indexByCoord.get(`${fileIndex}:${lineIndex}`) ?? -1;
                const selected = idx === selectedIndex;
                return (
                  <button
                    key={`${file.path}:${result.line}:${result.fileOffset}`}
                    type="button"
                    data-result-index={idx}
                    className={`global-search-line${selected ? " global-search-line--selected" : ""}`}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => openItem(flatItems[idx])}
                    tabIndex={-1}
                    role="option"
                    aria-selected={selected}
                  >
                    <span className="global-search-line-no">{result.line}</span>
                    <span className="global-search-snippet">
                      {result.truncatedStart && (
                        <span className="global-search-ellipsis">…</span>
                      )}
                      {renderSnippet(result.snippet, result.ranges)}
                      {result.truncatedEnd && (
                        <span className="global-search-ellipsis">…</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </Fragment>
          ))
        )}
      </div>

      {results?.capped && (
        <div className="global-search-footer">
          Showing the first {shownResults} result
          {shownResults === 1 ? "" : "s"}. Refine your search.
        </div>
      )}
    </div>
  );
}

// Split a snippet into plain + highlighted spans from the match ranges. Built
// from the ranges array (offsets within the snippet), never via innerHTML.
function renderSnippet(
  snippet: string,
  ranges: { start: number; end: number }[],
) {
  if (ranges.length === 0) return snippet;

  // Defensive: sort + skip out-of-bounds / zero-width ranges so a malformed
  // range can never throw or scramble the slices.
  const sorted = [...ranges]
    .filter((r) => r.end > r.start && r.start >= 0 && r.end <= snippet.length)
    .sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((range, i) => {
    if (range.start < cursor) return; // overlapping; already covered
    if (range.start > cursor) {
      parts.push(
        <span key={`p${i}`}>{snippet.slice(cursor, range.start)}</span>,
      );
    }
    parts.push(
      <span key={`m${i}`} className="global-search-highlight">
        {snippet.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < snippet.length) {
    parts.push(<span key="tail">{snippet.slice(cursor)}</span>);
  }
  return parts;
}

function WholeWordIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 5v6M13.5 5v6" />
      <path d="M2.5 11h11" strokeWidth="1.2" />
      <text
        x="8"
        y="9.5"
        textAnchor="middle"
        fontSize="6.5"
        stroke="none"
        fill="currentColor"
        fontFamily="var(--font-ui)"
      >
        ab
      </text>
    </svg>
  );
}
