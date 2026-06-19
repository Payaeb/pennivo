// Pure global-search matcher. Lives in core so it can be unit-tested without
// fs/IPC/DOM. No React, DOM, Electron, or node:path. Nothing consumes it yet
// (IPC/UI come in later phases).
//
// Matching model (v1):
//  - Query is split on whitespace into TERMS. Default matching is
//    case-insensitive substring with MULTI-TERM AND: a file is included only
//    when EVERY term appears somewhere in it. A line is emitted when it
//    contains ANY term, and every occurrence of every term on that line is
//    highlighted.
//  - `wholeWord` wraps each term in \b...\b. `regex` treats each term as a
//    RegExp pattern (still AND across terms).
//  - Even in plain mode every term is compiled to a RegExp (the term is escaped
//    so metacharacters are literal) so `wholeWord` is a trivial \bterm\b wrap
//    and offsets stay consistent across all modes.
//
// totalMatches is defined as the SUM of every included file's true matchCount
// (term occurrences), counted even for occurrences beyond the global cap.
//
// Regex safety: each pattern is compiled inside try/catch. If ANY term is an
// invalid regex, the whole search returns no matches with invalidPattern=true
// and never throws. This matcher cannot fully prevent catastrophic
// backtracking from a pathological-but-valid pattern; it only guarantees that
// invalid patterns are handled gracefully and that nothing here throws.

import type {
  SearchFileResult,
  SearchInputFile,
  SearchMatchRange,
  SearchOptions,
  SearchResultLine,
  SearchResults,
} from "./types";

export type {
  SearchInputFile,
  SearchOptions,
  SearchMatchRange,
  SearchResultLine,
  SearchFileResult,
  SearchResults,
} from "./types";

const DEFAULTS = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  maxResultsPerFile: 20,
  maxTotalResults: 500,
  snippetContextChars: 40,
} as const;

// Minimum query length, counted as non-space characters. A query shorter than
// this (after collapsing whitespace) yields no matches. This keeps a single
// stray character from scanning the whole workspace.
const MIN_QUERY_CHARS = 2;

const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeForRegex(s: string): string {
  return s.replace(REGEX_ESCAPE_RE, "\\$&");
}

/**
 * Compile one term into a global RegExp, or return null when a regex term is
 * invalid. Plain terms are escaped so metacharacters are literal; regex terms
 * are used verbatim. `wholeWord` wraps the pattern in word boundaries.
 */
function compileTerm(
  term: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  regex: boolean,
): RegExp | null {
  const body = regex ? term : escapeForRegex(term);
  const source = wholeWord ? `\\b(?:${body})\\b` : body;
  const flags = caseSensitive ? "g" : "gi";
  try {
    return new RegExp(source, flags);
  } catch {
    return null;
  }
}

/** True when the term's RegExp matches anywhere in the content. */
function termAppears(re: RegExp, content: string): boolean {
  re.lastIndex = 0;
  return re.test(content);
}

interface RawMatch {
  start: number;
  end: number;
}

/**
 * Collect every match of every term across the whole content, deduped and
 * sorted by start offset. A zero-width match (possible with regex terms like
 * `a*`) advances by one to avoid an infinite loop and is skipped from output.
 */
function collectMatches(content: string, terms: RegExp[]): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const re of terms) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (m[0].length === 0) {
        re.lastIndex = m.index + 1; // guard against zero-width loops
        continue;
      }
      matches.push({ start, end });
    }
  }
  matches.sort((a, b) => (a.start - b.start) || (a.end - b.end));
  return matches;
}

/**
 * Precompute the start offset of every line plus whether each line ends with a
 * `\r\n` so a trailing `\r` never leaks into a snippet. Returns line start
 * offsets and, per line, the offset at which its visible content ends
 * (excluding the `\n` and any preceding `\r`).
 */
interface LineIndex {
  /** Absolute offset where each line's text begins (0-based). */
  starts: number[];
  /** Absolute offset where each line's visible text ends (exclusive). */
  ends: number[];
}

function buildLineIndex(content: string): LineIndex {
  const starts: number[] = [0];
  const ends: number[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") {
      // A preceding \r is part of the line break, not the line text.
      const contentEnd = i > 0 && content[i - 1] === "\r" ? i - 1 : i;
      ends.push(contentEnd);
      starts.push(i + 1);
    }
  }
  // Final line (no trailing newline, or text after the last \n).
  const lastStart = starts[starts.length - 1];
  let lastEnd = content.length;
  if (lastEnd > lastStart && content[lastEnd - 1] === "\r") {
    // A bare trailing \r with no following \n: trim it from the line text.
    lastEnd -= 1;
  }
  ends.push(Math.max(lastEnd, lastStart));
  return { starts, ends };
}

/** Binary search for the line index (0-based) containing absolute offset. */
function lineIndexForOffset(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface BuiltLine {
  line: SearchResultLine;
}

/**
 * Build a result line from the line's matches. `lineStart`/`lineEnd` are
 * absolute offsets bounding the line's visible text. `matches` are the file's
 * matches that fall on this line, in ascending start order.
 */
function buildResultLine(
  content: string,
  lineNumber: number,
  lineStart: number,
  lineEnd: number,
  matches: RawMatch[],
  contextChars: number,
): BuiltLine {
  const lineText = content.slice(lineStart, lineEnd);
  const first = matches[0];

  // Window around the FIRST match on the line, in line-relative coordinates.
  const firstRelStart = first.start - lineStart;
  const firstRelEnd = first.end - lineStart;
  let winStart = firstRelStart - contextChars;
  let winEnd = firstRelEnd + contextChars;
  if (winStart < 0) winStart = 0;
  if (winEnd > lineText.length) winEnd = lineText.length;

  const truncatedStart = winStart > 0;
  const truncatedEnd = winEnd < lineText.length;

  const snippet = lineText.slice(winStart, winEnd);

  // Recompute each occurrence's range relative to the snippet, keeping only
  // matches that fall (at least partially) within the window.
  const ranges: SearchMatchRange[] = [];
  for (const mt of matches) {
    const relStart = mt.start - lineStart - winStart;
    const relEnd = mt.end - lineStart - winStart;
    if (relEnd <= 0 || relStart >= snippet.length) continue;
    ranges.push({
      start: Math.max(relStart, 0),
      end: Math.min(relEnd, snippet.length),
    });
  }

  return {
    line: {
      line: lineNumber,
      fileOffset: first.start,
      snippet,
      truncatedStart,
      truncatedEnd,
      ranges,
    },
  };
}

interface FileScan {
  result: SearchFileResult;
}

/** Scan one file: collect matches, group by line, build capped result lines. */
function scanFile(
  file: SearchInputFile,
  terms: RegExp[],
  maxResultsPerFile: number,
  contextChars: number,
): FileScan | null {
  const matches = collectMatches(file.content, terms);
  if (matches.length === 0) return null;

  const { starts, ends } = buildLineIndex(file.content);

  // Group matches by their line index.
  const byLine = new Map<number, RawMatch[]>();
  for (const mt of matches) {
    const li = lineIndexForOffset(starts, mt.start);
    const bucket = byLine.get(li);
    if (bucket) bucket.push(mt);
    else byLine.set(li, [mt]);
  }

  const lineIndices = [...byLine.keys()].sort((a, b) => a - b);
  const lines: SearchResultLine[] = [];
  for (const li of lineIndices) {
    if (lines.length >= maxResultsPerFile) break;
    const lineMatches = byLine.get(li)!;
    const built = buildResultLine(
      file.content,
      li + 1,
      starts[li],
      ends[li],
      lineMatches,
      contextChars,
    );
    lines.push(built.line);
  }

  return {
    result: {
      path: file.path,
      matchCount: matches.length, // true total, may exceed lines.length
      lines,
    },
  };
}

/**
 * Search a set of files for `query`. See the file header for the full matching
 * model, the totalMatches definition, and the regex-safety contract. Never
 * throws.
 */
export function searchFiles(
  query: string,
  files: SearchInputFile[],
  options?: SearchOptions,
): SearchResults {
  const caseSensitive = options?.caseSensitive ?? DEFAULTS.caseSensitive;
  const wholeWord = options?.wholeWord ?? DEFAULTS.wholeWord;
  const regex = options?.regex ?? DEFAULTS.regex;
  const maxResultsPerFile =
    options?.maxResultsPerFile ?? DEFAULTS.maxResultsPerFile;
  const maxTotalResults = options?.maxTotalResults ?? DEFAULTS.maxTotalResults;
  const snippetContextChars =
    options?.snippetContextChars ?? DEFAULTS.snippetContextChars;

  const empty: SearchResults = {
    query,
    files: [],
    totalMatches: 0,
    capped: false,
  };

  // Min-length rule: a query with fewer than MIN_QUERY_CHARS non-space
  // characters (covers empty and whitespace-only) matches nothing.
  const nonSpaceCount = query.replace(/\s+/g, "").length;
  if (nonSpaceCount < MIN_QUERY_CHARS) return empty;

  const rawTerms = query.split(/\s+/).filter((t) => t.length > 0);
  if (rawTerms.length === 0) return empty;

  const terms: RegExp[] = [];
  for (const term of rawTerms) {
    const re = compileTerm(term, caseSensitive, wholeWord, regex);
    if (re === null) {
      // Any invalid regex term aborts the whole search gracefully.
      return { ...empty, invalidPattern: true };
    }
    terms.push(re);
  }

  // AND across terms at the FILE level: a file qualifies only when every term
  // appears somewhere in it. Use independent RegExp instances per call site by
  // resetting lastIndex (compiled with `g`).
  const fileResults: SearchFileResult[] = [];
  for (const file of files) {
    const allTermsPresent = terms.every((re) => termAppears(re, file.content));
    if (!allTermsPresent) continue;
    const scan = scanFile(file, terms, maxResultsPerFile, snippetContextChars);
    if (scan) fileResults.push(scan.result);
  }

  // Rank: matchCount DESC, then path ASC (stable for equal keys).
  fileResults.sort(
    (a, b) => b.matchCount - a.matchCount || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );

  const totalMatches = fileResults.reduce((sum, f) => sum + f.matchCount, 0);

  // Apply the global result-line cap in ranked order. Files keep document-order
  // lines; a file may be partially included or dropped when the budget runs out.
  let budget = maxTotalResults;
  let capped = false;
  const cappedFiles: SearchFileResult[] = [];
  for (const f of fileResults) {
    if (budget <= 0) {
      // Any remaining lines that would have been emitted are dropped.
      if (f.lines.length > 0) capped = true;
      continue;
    }
    if (f.lines.length <= budget) {
      cappedFiles.push(f);
      budget -= f.lines.length;
    } else {
      cappedFiles.push({ ...f, lines: f.lines.slice(0, budget) });
      budget = 0;
      capped = true;
    }
  }

  const result: SearchResults = {
    query,
    files: cappedFiles,
    totalMatches,
    capped,
  };
  return result;
}
