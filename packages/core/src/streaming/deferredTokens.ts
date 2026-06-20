// Pure deferred-token splitter for streaming markdown render (Phase 12d).
//
// When markdown arrives in chunks (streamed/external writes), the trailing
// fragment is frequently a half-written construct: an open code fence, an
// unbalanced emphasis run, a link whose closing paren has not landed yet, a
// table whose delimiter row is still mid-flight. Rendering that fragment now
// produces a "pop" — GFM first paints it as a stray paragraph and then reflows
// it into the real construct once the rest of the chunk arrives.
//
// splitStableDeferred separates the leading prefix that is safe to render now
// (`stable`) from the incomplete trailing fragment to hold back (`deferred`).
//
// DESIGN: this is a conservative heuristic lexer, NOT a Remark re-parse. It is
// always safe to defer too much (the held-back content simply appears one chunk
// later); it is unsafe to render too eagerly (that causes the pop/reflow we are
// trying to remove). When in doubt, defer.
//
// Pure TypeScript. No React, DOM, Milkdown, or node dependencies.

export interface StableDeferredSplit {
  /** Leading prefix safe to render now. */
  stable: string;
  /** Incomplete trailing fragment to hold back until its closing token arrives. */
  deferred: string;
}

/**
 * Split `markdown` into a stable prefix and a deferred trailing fragment.
 *
 * The split point is found by scanning from the last safe block boundary (a
 * blank line) forward and checking the trailing region for any in-progress
 * construct. If one is found, the cut moves to the start of that construct so
 * the incomplete part lands in `deferred`.
 */
export function splitStableDeferred(markdown: string): StableDeferredSplit {
  if (markdown.length === 0) {
    return { stable: "", deferred: "" };
  }

  // Index where the trailing region begins. Everything before this index is
  // already separated from the trailing region by a blank line, so it is a
  // settled block boundary and cannot be retroactively changed by later text.
  const trailingStart = lastBlockBoundary(markdown);
  const head = markdown.slice(0, trailingStart);
  const trailing = markdown.slice(trailingStart);

  // Compute, within the trailing region, the offset of the first character that
  // must be deferred. `trailing.length` means nothing needs deferring.
  const cut = trailingCutOffset(trailing, markdown);

  const stable = head + trailing.slice(0, cut);
  const deferred = trailing.slice(cut);
  return { stable, deferred };
}

/**
 * Return the index just after the last blank-line block boundary in `text`.
 *
 * A block boundary is a run of one or more newlines that contains a blank line
 * (i.e. "\n\n", possibly with whitespace-only lines between). The returned
 * index is the start of the trailing region: the last block plus anything in
 * progress after it. If there is no blank line, the whole string is the
 * trailing region and 0 is returned.
 */
function lastBlockBoundary(text: string): number {
  // Match the LAST occurrence of a newline followed by an optional
  // whitespace-only line and another newline. We want the index right after
  // that separator so the trailing block starts clean.
  let boundary = 0;
  const re = /\n[ \t]*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    boundary = m.index + m[0].length;
    // Allow overlapping runs of blank lines to advance the boundary fully.
    re.lastIndex = boundary;
  }
  return boundary;
}

/**
 * Given the trailing region (already isolated from settled blocks) and the full
 * markdown for context, return the offset within `trailing` at which deferral
 * must begin. Returns `trailing.length` when the whole trailing region is safe.
 */
function trailingCutOffset(trailing: string, _full: string): number {
  if (trailing.length === 0) return 0;

  // 1. Open fenced code block: an odd number of fence lines in the trailing
  //    region means a fence was opened but not yet closed. Defer from the
  //    opening fence onward.
  const fenceCut = openFenceOffset(trailing);
  if (fenceCut !== -1) return fenceCut;

  // 2. Table mid-construct: a trailing run of lines starting with `|` whose
  //    header + delimiter rows are not both complete. Defer the whole table.
  const tableCut = incompleteTableOffset(trailing);
  if (tableCut !== -1) return tableCut;

  // The remaining checks act on the last (in-progress) line.
  const lastNewline = trailing.lastIndexOf("\n");
  const lastLineStart = lastNewline + 1;
  const lastLine = trailing.slice(lastLineStart);
  const endsWithNewline = trailing.endsWith("\n");

  // A trailing line that is empty after the final newline is fine (it is just a
  // pending blank line); nothing on it to defer.
  if (lastLine.length === 0) return trailing.length;

  // 3. Incomplete link / image on the last line.
  if (hasIncompleteLink(lastLine)) return lastLineStart;

  // 4. Unbalanced inline emphasis / code on the last line.
  if (hasUnbalancedInline(lastLine)) return lastLineStart;

  // 5. Trailing line with no terminating newline is "in progress". Conservatively
  //    defer it unless it is plainly a complete paragraph line (balanced, no
  //    open construct, and not a partial block-construct marker). The checks
  //    above already cleared open links/emphasis, so the remaining risk is a
  //    partially typed block marker (heading, list, fence start, table pipe).
  if (!endsWithNewline) {
    if (isPlainCompleteLine(lastLine)) return trailing.length;
    return lastLineStart;
  }

  return trailing.length;
}

/**
 * Return the offset of the opening fence if the trailing region has an odd
 * number of code-fence lines (so a fence is currently open), otherwise -1.
 * Handles both ``` and ~~~ fences. The two fence kinds are tracked separately
 * because one can appear as literal text inside the other.
 */
function openFenceOffset(trailing: string): number {
  const lines = trailing.split("\n");
  let offset = 0;
  let openKind: "`" | "~" | null = null;
  let openOffset = -1;

  for (const line of lines) {
    const fence = fenceMarker(line);
    if (fence) {
      if (openKind === null) {
        openKind = fence;
        openOffset = offset;
      } else if (fence === openKind) {
        // Closing fence of the same kind.
        openKind = null;
        openOffset = -1;
      }
      // A fence of the other kind while one is open is literal content; ignore.
    }
    offset += line.length + 1; // +1 for the split-removed newline
  }

  return openKind === null ? -1 : openOffset;
}

/** Return the fence kind for a fence line, or null if the line is not a fence. */
function fenceMarker(line: string): "`" | "~" | null {
  const trimmed = line.replace(/^ {0,3}/, "");
  if (/^`{3,}/.test(trimmed)) return "`";
  if (/^~{3,}/.test(trimmed)) return "~";
  return null;
}

/**
 * Detect an in-progress GFM table at the end of the trailing region. A GFM
 * table needs a header row AND a delimiter row (e.g. `| --- | --- |`) to render
 * as a table. While only the header (or header plus a partial delimiter) has
 * arrived, GFM renders it as a plain paragraph that later pops into a table.
 *
 * Returns the offset of the first line of the trailing pipe-run if that run is
 * an incomplete table, otherwise -1.
 */
function incompleteTableOffset(trailing: string): number {
  const lines = trailing.split("\n");
  // Drop a trailing empty element produced by a final newline so we examine the
  // real last content line.
  const hasTrailingNewline = trailing.endsWith("\n");
  const content = hasTrailingNewline ? lines.slice(0, -1) : lines;
  if (content.length === 0) return -1;

  // Find the contiguous run of pipe-lines at the very end.
  let start = content.length;
  while (start > 0 && isPipeLine(content[start - 1])) {
    start--;
  }
  const pipeRun = content.slice(start);
  if (pipeRun.length === 0) return -1;

  // The line just above the pipe run could be a pipeless header (GFM allows a
  // header row without leading pipe). To stay conservative we only treat a run
  // that itself starts with `|` as a table candidate, matching the task spec
  // ("a trailing line starting with `|`").
  if (!pipeRun[0].trimStart().startsWith("|")) return -1;

  // A complete table needs at least a header row and a delimiter row.
  const headerComplete = pipeRun.length >= 1;
  const delimiterComplete =
    pipeRun.length >= 2 && isDelimiterRow(pipeRun[1]) && hasTrailingNewline;

  if (headerComplete && delimiterComplete) {
    // Header + valid delimiter present and terminated by a newline: the table
    // is established and renders correctly; nothing to defer here.
    return -1;
  }

  // Otherwise the table is mid-construct. Defer the whole pipe run.
  let offset = 0;
  for (let i = 0; i < start; i++) {
    offset += content[i].length + 1;
  }
  return offset;
}

/** True if the line, ignoring leading whitespace, begins with a pipe. */
function isPipeLine(line: string): boolean {
  return line.trimStart().startsWith("|");
}

/** True if the line is a GFM table delimiter row (only `|`, `-`, `:`, spaces). */
function isDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\|?[\s:|-]+\|?$/.test(trimmed) && /[-]/.test(trimmed);
}

/**
 * Detect an incomplete link or image on a single line:
 * - `[text](` or `![alt](` with no matching closing `)` after it.
 * - `[text]` or `![alt]` with no following `(`, `[`, or `:` resolution yet
 *   (could become an inline link, a reference link, or a reference definition).
 */
function hasIncompleteLink(line: string): boolean {
  // Find the last unmatched `[` that starts a link/image label.
  // Scan for `](` openings that are not yet closed.
  const openParen = lastUnclosedLinkParen(line);
  if (openParen) return true;

  // A `[label]` (optionally image) with nothing after it yet is ambiguous: it
  // may resolve to `(url)`, `[ref]`, or a reference definition `:`. Defer until
  // the resolution arrives.
  const danglingLabel = endsWithUnresolvedLabel(line);
  if (danglingLabel) return true;

  return false;
}

/**
 * True if the line contains a `](` (link/image destination opener) that has no
 * matching `)` after it, accounting for nested parentheses inside the URL.
 */
function lastUnclosedLinkParen(line: string): boolean {
  // Walk the line tracking the most recent `](` and whether its paren closed.
  for (let i = line.length - 1; i >= 1; i--) {
    if (line[i] === "(" && line[i - 1] === "]") {
      // Found a destination opener at i. Check for a balanced close after it.
      let depth = 0;
      for (let j = i; j < line.length; j++) {
        if (line[j] === "(") depth++;
        else if (line[j] === ")") {
          depth--;
          if (depth === 0) return false; // closed — this opener is complete
        }
      }
      return true; // never closed
    }
  }
  return false;
}

/**
 * True if the line ends with a `[label]` (optionally an image `![label]`) that
 * has no resolving character (`(`, `[`, or `:`) after it. Such a label is an
 * in-progress link/reference whose target has not arrived.
 */
function endsWithUnresolvedLabel(line: string): boolean {
  const trimmedEnd = line.replace(/\s+$/, "");
  if (!trimmedEnd.endsWith("]")) return false;

  // Find the matching `[` for the final `]`.
  let depth = 0;
  let openIdx = -1;
  for (let i = trimmedEnd.length - 1; i >= 0; i--) {
    const ch = trimmedEnd[i];
    if (ch === "]") depth++;
    else if (ch === "[") {
      depth--;
      if (depth === 0) {
        openIdx = i;
        break;
      }
    }
  }
  if (openIdx === -1) return false;

  // A label resolves only if a destination/reference follows it. Since `]` is
  // the last non-space char, nothing follows, so it is unresolved — UNLESS the
  // bracketed text is a task-list/footnote-ish marker we do not handle here.
  // Treat any trailing `[...]` as an in-progress link reference.
  return true;
}

/**
 * Detect unbalanced inline emphasis or inline code on a single line. We count
 * delimiter runs and treat an odd count as open. Backticks are checked first
 * and their spans are removed, because emphasis markers inside code are literal.
 */
function hasUnbalancedInline(line: string): boolean {
  // Inline code: an odd number of backtick runs means a code span is open.
  const backtickRuns = line.match(/`+/g) ?? [];
  if (backtickRuns.length % 2 === 1) return true;

  // Remove balanced inline-code spans so emphasis markers inside them do not
  // count. Use a simple paired-run removal.
  const withoutCode = stripInlineCode(line);

  // Strong/emphasis: count `**`, `__`, then single `*`, `_`. Odd => open.
  if (countOccurrences(withoutCode, "**") % 2 === 1) return true;
  if (countOccurrences(withoutCode, "__") % 2 === 1) return true;

  // For single-char markers, remove the double-char runs first so we do not
  // double count, then count remaining singles.
  const withoutStrong = withoutCode.replace(/\*\*/g, "").replace(/__/g, "");
  if (countChar(withoutStrong, "*") % 2 === 1) return true;
  // `_` only forms emphasis when not surrounded by word chars in CommonMark,
  // but to stay conservative we treat any odd `_` count as potentially open.
  if (countChar(withoutStrong, "_") % 2 === 1) return true;

  return false;
}

/** Remove balanced inline-code spans, keeping unbalanced text untouched. */
function stripInlineCode(line: string): string {
  // Replace `...` (matched single backtick pairs) and ``...`` greedily by
  // alternating. Simplest robust approach: split on backtick runs and drop
  // every other segment when counts are even.
  return line.replace(/`[^`]*`/g, "");
}

function countOccurrences(s: string, sub: string): number {
  let count = 0;
  let idx = s.indexOf(sub);
  while (idx !== -1) {
    count++;
    idx = s.indexOf(sub, idx + sub.length);
  }
  return count;
}

function countChar(s: string, ch: string): number {
  let count = 0;
  for (const c of s) if (c === ch) count++;
  return count;
}

/**
 * True if a line with no terminating newline is a plainly complete paragraph
 * line: balanced inline constructs (already verified by the caller) and not the
 * start of a block construct that needs more lines to be valid (fence opener,
 * table pipe). A finished sentence or heading is fine to render.
 */
function isPlainCompleteLine(line: string): boolean {
  // A lone fence opener with no closer is handled earlier; but a single fence
  // line in the trailing region with an even count (e.g. ``` ``` on one logical
  // line) will not reach here. A line that itself is a fence marker is never
  // "complete" on its own.
  if (fenceMarker(line) !== null) return false;

  // A pipe line on its own (no delimiter yet) is an in-progress table.
  if (isPipeLine(line)) return false;

  // Otherwise, with balanced inline constructs, the line is a complete
  // paragraph/heading/list line and safe to render.
  return true;
}
