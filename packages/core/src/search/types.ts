// Type definitions for the pure global-search matcher. Lives in core so it can
// be unit-tested without fs/IPC/DOM. No React, DOM, Electron, or node:path.
//
// Phase 1 ships the matcher only; nothing consumes it yet. IPC plumbing and UI
// land in later phases.

/** A single file fed to the matcher. */
export interface SearchInputFile {
  /** Workspace-relative POSIX path, e.g. "notes/todo.md". */
  path: string;
  content: string;
}

export interface SearchOptions {
  /** Case-sensitive matching. Default false (case-insensitive). */
  caseSensitive?: boolean;
  /** Each term must be bounded by word boundaries (\b). Default false. */
  wholeWord?: boolean;
  /**
   * Treat each whitespace-split term as a RegExp pattern. Default false.
   * Compilation is wrapped in try/catch; an invalid pattern never throws.
   */
  regex?: boolean;
  /** Max result lines emitted per file. Default 20. matchCount is unaffected. */
  maxResultsPerFile?: number;
  /** Global cap on result lines across all files (ranked order). Default 500. */
  maxTotalResults?: number;
  /** Characters of context on each side of the first match. Default 40. */
  snippetContextChars?: number;
}

/** A highlight range, expressed as offsets WITHIN the snippet string. */
export interface SearchMatchRange {
  start: number;
  end: number;
}

export interface SearchResultLine {
  /** 1-based line number in the file. */
  line: number;
  /** 0-based char offset of the (first) match start within the whole file. */
  fileOffset: number;
  /** Windowed text around the first match on the line. */
  snippet: string;
  /** True when the window cut text off the start of the line. */
  truncatedStart: boolean;
  /** True when the window cut text off the end of the line. */
  truncatedEnd: boolean;
  /** One range per term occurrence on the line, relative to `snippet`. */
  ranges: SearchMatchRange[];
}

export interface SearchFileResult {
  path: string;
  /**
   * True total number of term occurrences in the file. This can exceed
   * `lines.length` when per-file capping or per-line collapsing applies.
   */
  matchCount: number;
  lines: SearchResultLine[];
}

export interface SearchResults {
  query: string;
  files: SearchFileResult[];
  /**
   * Sum of every included file's true `matchCount` (term occurrences), even
   * for occurrences beyond the global result-line cap.
   */
  totalMatches: number;
  /** True when `maxTotalResults` truncated the emitted result lines. */
  capped: boolean;
  /** True when `regex` was on and at least one term failed to compile. */
  invalidPattern?: boolean;
}
