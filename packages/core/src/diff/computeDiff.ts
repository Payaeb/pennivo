// Pure unified-line-diff computation. Lives in @pennivo/core so every host
// (desktop, mobile, future cloud) can render diffs without re-implementing
// the algorithm.
//
// Implementation: classic LCS dynamic-programming over lines, then a single
// pass to emit context/remove/add tuples. O(n*m) memory in the worst case
// but bounded by the file content the user is comparing — for prose files
// (a few thousand lines max) this is fine and lets us avoid pulling in a
// runtime dep. Core has zero deps and stays that way.
//
// Code-block detection: walks each side's lines and tags any line that sits
// between matching ``` fences (start fence inclusive, end fence inclusive).
// The renderer uses this to switch to `--font-mono` inside fences while
// keeping `--font-editor` for prose.

import type { DiffHunk, DiffLine, DiffMode, DiffResult } from "./types";

// Number of context lines kept on either side of a changed run before
// collapsing into a "N lines unchanged" spacer. Tuned to mirror GitHub's
// default and Pennivo's prose density (3 is enough to anchor without burying
// the change).
const CONTEXT_LINES = 3;

/**
 * Splits a string into an array of lines, preserving empty trailing lines.
 * `'a\nb\n'` -> `['a', 'b', '']`; `''` -> `['']`.
 */
function splitLines(s: string): string[] {
  // Normalize CRLF/CR to LF so a Windows-saved file diffs cleanly against a
  // Unix-saved one. Treat the empty string as zero lines (not `[""]`) so a
  // diff against an empty file shows pure additions / removals rather than
  // a spurious empty-line context match.
  if (s.length === 0) return [];
  return s.replace(/\r\n?/g, "\n").split("\n");
}

/**
 * Tags each line with whether it sits inside a ``` fenced code block.
 *
 * Detection rule: a line is a fence if it matches `/^\s*```/`. Fences toggle:
 * the first opens a block, the second closes it, and the fence lines
 * themselves are considered *inside* the block (so the renderer can keep
 * monospace continuous over the whole snippet, fence and all).
 *
 * Mismatched fences (odd count) leave the trailing portion tagged as
 * inside-block, which is the same behavior as Markdown renderers.
 */
function tagCodeBlocks(lines: string[]): boolean[] {
  const out: boolean[] = new Array(lines.length).fill(false);
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const isFence = /^\s*```/.test(lines[i]);
    if (isFence) {
      // The fence line itself is part of the block on both sides of the toggle.
      out[i] = true;
      inside = !inside;
    } else {
      out[i] = inside;
    }
  }
  return out;
}

/**
 * LCS table over two arrays of strings. Returns the table; the trace step
 * walks back through it to emit edits.
 *
 * Returns a flat Uint32Array of length (n+1)*(m+1), indexed as
 * `table[i * (m + 1) + j]`. Flat-array choice over `number[][]` is roughly
 * 3-4x faster on hot diffs.
 */
function lcsTable(a: string[], b: string[]): Uint32Array {
  const n = a.length;
  const m = b.length;
  const t = new Uint32Array((n + 1) * (m + 1));
  const stride = m + 1;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        t[i * stride + j] = t[(i - 1) * stride + (j - 1)] + 1;
      } else {
        const up = t[(i - 1) * stride + j];
        const left = t[i * stride + (j - 1)];
        t[i * stride + j] = up >= left ? up : left;
      }
    }
  }
  return t;
}

/**
 * Walks the LCS table back-to-front, emitting `DiffLine`s in forward order.
 * Pure: takes the (already computed) table + inputs + code-block tags.
 */
function emitLines(
  oldLines: string[],
  newLines: string[],
  oldInCode: boolean[],
  newInCode: boolean[],
): DiffLine[] {
  const t = lcsTable(oldLines, newLines);
  const stride = newLines.length + 1;
  const out: DiffLine[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      out.push({
        kind: "context",
        text: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: j,
        inCodeBlock: oldInCode[i - 1] || newInCode[j - 1],
      });
      i--;
      j--;
    } else if (
      j > 0 &&
      (i === 0 || t[i * stride + (j - 1)] >= t[(i - 1) * stride + j])
    ) {
      out.push({
        kind: "add",
        text: newLines[j - 1],
        oldLineNumber: null,
        newLineNumber: j,
        inCodeBlock: newInCode[j - 1],
      });
      j--;
    } else {
      out.push({
        kind: "remove",
        text: oldLines[i - 1],
        oldLineNumber: i,
        newLineNumber: null,
        inCodeBlock: oldInCode[i - 1],
      });
      i--;
    }
  }
  out.reverse();
  return out;
}

/**
 * Bundles the flat line-list into hunks (changed runs + surrounding context).
 * Long stretches of unchanged lines collapse to a single hunk separator
 * recording how many lines were skipped.
 */
function bundleHunks(lines: DiffLine[]): DiffHunk[] {
  if (lines.length === 0) return [];

  // Find indices of changed lines.
  const changedIdx: number[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].kind !== "context") changedIdx.push(k);
  }
  if (changedIdx.length === 0) return [];

  const hunks: DiffHunk[] = [];
  let cursor = 0; // index just past the last consumed line
  let h = 0;
  while (h < changedIdx.length) {
    // Find the run of changed indices that should belong to one hunk:
    // expand while the gap between consecutive changed indices is <=
    // 2 * CONTEXT_LINES (so the trailing context of one and the leading of
    // the next overlap rather than emitting a tiny separator).
    const runStart = h;
    let runEnd = h;
    while (
      runEnd + 1 < changedIdx.length &&
      changedIdx[runEnd + 1] - changedIdx[runEnd] <= CONTEXT_LINES * 2
    ) {
      runEnd++;
    }

    const firstChanged = changedIdx[runStart];
    const lastChanged = changedIdx[runEnd];

    const hunkStart = Math.max(0, firstChanged - CONTEXT_LINES);
    const hunkEnd = Math.min(lines.length - 1, lastChanged + CONTEXT_LINES);

    const collapsedBefore = hunkStart - cursor;
    hunks.push({
      lines: lines.slice(hunkStart, hunkEnd + 1),
      collapsedBefore: collapsedBefore > 0 ? collapsedBefore : 0,
    });

    cursor = hunkEnd + 1;
    h = runEnd + 1;
  }

  return hunks;
}

/**
 * Compute a unified line diff between two strings.
 *
 * - Returns `unchanged: true` and empty hunks when inputs are byte-identical.
 * - `mode === 'word'` falls back to `'line'` in v1; the parameter exists so
 *   callsites can be updated once and the renderer drops in word mode later.
 * - Handles CRLF/CR line endings transparently — both sides are normalized
 *   to LF before comparison.
 *
 * Pure. No I/O, no globals, no logging.
 */
export function computeDiff(
  oldText: string,
  newText: string,
  mode: DiffMode = "line",
): DiffResult {
  // Mode is reserved for v1.1 word-diff. Today every mode collapses to line.
  void mode;

  if (oldText === newText) {
    return { hunks: [], addedLines: 0, removedLines: 0, unchanged: true };
  }

  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const oldInCode = tagCodeBlocks(oldLines);
  const newInCode = tagCodeBlocks(newLines);

  const flat = emitLines(oldLines, newLines, oldInCode, newInCode);

  let addedLines = 0;
  let removedLines = 0;
  for (const line of flat) {
    if (line.kind === "add") addedLines++;
    else if (line.kind === "remove") removedLines++;
  }

  const hunks = bundleHunks(flat);

  return {
    hunks,
    addedLines,
    removedLines,
    unchanged: addedLines === 0 && removedLines === 0,
  };
}
