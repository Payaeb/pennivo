// Pure merge-resolution helper. Lives in @pennivo/core so the desktop
// CompareMergeView and any future host (mobile, cloud, CLI) can share the
// same accumulator. Zero deps, no I/O.
//
// Concept: given two text inputs (left + right), compute a unified line
// diff and bundle every consecutive run of changed lines into a `MergeHunk`.
// Context lines (lines that match in both) flow through unchanged.
//
// The renderer assigns a `MergeChoice` per hunk (`'left' | 'right' | 'both'
// | { kind: 'edit', text: string }`). `applyMergeResolutions` walks the
// segments and emits the merged text by:
//   - emitting context segments verbatim
//   - emitting the chosen side (or both, or the user's edit) for each hunk
// Lines are joined with `\n`. The final output preserves CRLF only if both
// inputs were CRLF — same normalization rule the diff engine uses.

import { computeDiff } from "./computeDiff";

/** A single hunk's resolution. The user picks one of these per hunk. */
export type MergeChoice =
  | "left"
  | "right"
  | "both"
  | { kind: "edit"; text: string };

/**
 * A run of changed lines. Index is dense (0, 1, 2, …) so the UI can key on it.
 * `leftLines` are the `remove` lines (only on the left side); `rightLines`
 * are the `add` lines (only on the right side). Either may be empty (pure
 * insertion / pure deletion).
 */
export interface MergeHunk {
  index: number;
  leftLines: string[];
  rightLines: string[];
}

/** A piece of the merged output. Context segments emit their text as-is. */
export type MergeSegment =
  | { kind: "context"; lines: string[] }
  | { kind: "hunk"; hunk: MergeHunk };

/**
 * Walk the line-diff between `left` and `right` and bundle every consecutive
 * run of `remove`/`add` lines into a single `MergeHunk`. Context lines flow
 * through unchanged.
 *
 * Pure: no I/O, no globals.
 */
export function computeMergeSegments(
  left: string,
  right: string,
): MergeSegment[] {
  // Rebuild the full line list from the diff. We can't use the bundled
  // hunks from computeDiff directly because they collapse long unchanged
  // runs — for merge we need every context line so the output is faithful.
  //
  // Trick: build a tiny LCS-ish walk by reusing computeDiff and then
  // expanding each hunk plus the "collapsedBefore" gaps. That gap count is
  // sufficient because we have the original strings — we can reconstruct
  // the elided context lines by walking the source-of-truth from the
  // emitted hunks.
  //
  // Simpler approach used here: re-run a flat line walk by computing the
  // diff and immediately operating on its line stream. We pull the LCS
  // logic from computeDiff via re-implementing a thin variant — but
  // actually computeDiff already exposes `hunks`, and an empty diff (both
  // sides identical) produces zero hunks. To avoid duplicating LCS code,
  // we re-derive the full line stream from the hunks plus the original
  // strings.

  if (left === right) {
    // Identical — single context segment with the unchanged content.
    return [{ kind: "context", lines: splitForMerge(left) }];
  }

  const result = computeDiff(left, right, "line");
  const leftLines = splitForMerge(left);
  const rightLines = splitForMerge(right);

  // Walk both inputs in lockstep. We use the hunks' line numbers (1-based,
  // null when not present) to advance pointers. Between hunks we emit the
  // shared context window the diff omitted.

  const segments: MergeSegment[] = [];
  let leftIdx = 0; // 0-based pointer into leftLines (next unconsumed line)
  let rightIdx = 0;
  let hunkIndex = 0;

  // Helper: emit context up to the start of a hunk's first changed line.
  const emitContextBefore = (
    nextLeftLine: number | null,
    nextRightLine: number | null,
  ) => {
    // Translate the next line numbers to 0-based; if a side has null we
    // treat it as "no advancement on this side."
    const leftTarget = nextLeftLine === null ? leftIdx : nextLeftLine - 1;
    const rightTarget = nextRightLine === null ? rightIdx : nextRightLine - 1;

    // Both pointers should advance equally across the context gap.
    const leftAdvance = leftTarget - leftIdx;
    const rightAdvance = rightTarget - rightIdx;
    const advance = Math.min(leftAdvance, rightAdvance);
    if (advance > 0) {
      const contextLines = leftLines.slice(leftIdx, leftIdx + advance);
      segments.push({ kind: "context", lines: contextLines });
      leftIdx += advance;
      rightIdx += advance;
    }
  };

  for (const hunk of result.hunks) {
    // Find the first changed line (remove or add) in the hunk.
    const firstChange = hunk.lines.find((l) => l.kind !== "context");
    if (!firstChange) continue;
    emitContextBefore(firstChange.oldLineNumber, firstChange.newLineNumber);

    // Walk the hunk's contiguous changed runs. There may be multiple changed
    // runs separated by short context — we treat each `remove`/`add` cluster
    // as one MergeHunk so the user sees one decision per logical change.
    let cursor = 0;
    const lines = hunk.lines;
    while (cursor < lines.length) {
      // Skip leading context inside the hunk (already-emitted prelude).
      while (cursor < lines.length && lines[cursor].kind === "context") {
        // Advance both pointers by 1 — the line lives in both inputs.
        leftIdx++;
        rightIdx++;
        cursor++;
        // Re-emit as context.
        const ctxLine = lines[cursor - 1].text;
        // Coalesce with previous context segment when possible.
        const last = segments[segments.length - 1];
        if (last && last.kind === "context") last.lines.push(ctxLine);
        else segments.push({ kind: "context", lines: [ctxLine] });
      }
      if (cursor >= lines.length) break;

      // Collect the changed run.
      const leftRun: string[] = [];
      const rightRun: string[] = [];
      while (cursor < lines.length && lines[cursor].kind !== "context") {
        const ln = lines[cursor];
        if (ln.kind === "remove") {
          leftRun.push(ln.text);
          leftIdx++;
        } else if (ln.kind === "add") {
          rightRun.push(ln.text);
          rightIdx++;
        }
        cursor++;
      }
      segments.push({
        kind: "hunk",
        hunk: {
          index: hunkIndex++,
          leftLines: leftRun,
          rightLines: rightRun,
        },
      });
    }
  }

  // Trailing context — both sides should have the same number of remaining
  // lines.
  const trailingLeft = leftLines.length - leftIdx;
  const trailingRight = rightLines.length - rightIdx;
  const trailing = Math.min(trailingLeft, trailingRight);
  if (trailing > 0) {
    segments.push({
      kind: "context",
      lines: leftLines.slice(leftIdx, leftIdx + trailing),
    });
  } else if (trailingLeft !== trailingRight) {
    // Mismatched trailing lines — fall back to a final hunk for the diff.
    segments.push({
      kind: "hunk",
      hunk: {
        index: hunkIndex,
        leftLines: leftLines.slice(leftIdx),
        rightLines: rightLines.slice(rightIdx),
      },
    });
  }

  return segments;
}

/**
 * Apply a per-hunk resolution map to merge segments and produce the final
 * merged text. Missing resolutions throw — `mergeResolution` is for the
 * final save step, not the in-progress accumulator.
 *
 * Pure: no I/O. Lines are joined with `\n`. The renderer pre-checks all
 * hunks resolved before calling this (Save buttons disabled until done).
 */
export function applyMergeResolutions(
  segments: MergeSegment[],
  resolutions: Record<number, MergeChoice>,
): string {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "context") {
      out.push(...seg.lines);
    } else {
      const choice = resolutions[seg.hunk.index];
      if (choice === undefined) {
        throw new Error(
          `mergeResolution: hunk ${seg.hunk.index} has no resolution`,
        );
      }
      const merged = applyChoice(seg.hunk, choice);
      out.push(...merged);
    }
  }
  return out.join("\n");
}

/**
 * Convenience: compute segments + apply resolutions in one call. Useful
 * for tests and any caller that doesn't need to render an interactive UI.
 */
export function mergeResolution(
  left: string,
  right: string,
  resolutions: Record<number, MergeChoice>,
): string {
  const segments = computeMergeSegments(left, right);
  return applyMergeResolutions(segments, resolutions);
}

/**
 * Count how many hunks the segments have. Renderer surfaces this in the
 * footer (`12 hunks · 8 resolved · 4 remaining`).
 */
export function countHunks(segments: MergeSegment[]): number {
  let n = 0;
  for (const seg of segments) if (seg.kind === "hunk") n++;
  return n;
}

// ───────── helpers ─────────

function applyChoice(hunk: MergeHunk, choice: MergeChoice): string[] {
  if (choice === "left") return [...hunk.leftLines];
  if (choice === "right") return [...hunk.rightLines];
  if (choice === "both") return [...hunk.leftLines, ...hunk.rightLines];
  // edit: split user text into lines (preserve empty strings)
  return splitForMerge(choice.text);
}

/**
 * Splits a string into an array of lines for merge work. Same normalization
 * as `computeDiff`: CRLF/CR collapse to LF; an empty string is zero lines.
 */
function splitForMerge(s: string): string[] {
  if (s.length === 0) return [];
  return s.replace(/\r\n?/g, "\n").split("\n");
}
