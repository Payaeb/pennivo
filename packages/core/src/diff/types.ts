// Diff data shapes — pure, framework-free. Shared by the line-diff renderer
// today and the word-diff overlay (v1.1 Direction C). Word diff drops in by
// adding a new `DiffMode` and a new line-shape variant; renderer signature
// stays the same.

/**
 * Diff granularity. `'word'` is wired but not implemented in v1 — `computeDiff`
 * falls back to `'line'` when `'word'` is requested. The boundary stays
 * stable so the v1.1 word-diff overlay can drop in without renderer changes.
 */
export type DiffMode = "line" | "word";

/**
 * Whether a diff line is a removal (from old), addition (from new), or
 * unchanged context (present in both).
 */
export type DiffLineKind = "context" | "remove" | "add";

/**
 * A single line in the unified diff output. The renderer styles based on
 * `kind`; `inCodeBlock` lets it switch to monospace inside ``` fences.
 *
 * `oldLineNumber` / `newLineNumber` are 1-based and `null` when the line is
 * not present in that side (an `add` has no `oldLineNumber`; a `remove` has
 * no `newLineNumber`).
 */
export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  /** True when the line falls inside a ``` fenced code block in either side. */
  inCodeBlock: boolean;
}

/**
 * A contiguous run of changed lines plus the surrounding context the renderer
 * keeps visible. Hunks are separated by collapsible "── N lines unchanged ──"
 * spacers so very long unchanged regions don't dominate the diff.
 */
export interface DiffHunk {
  /** Lines belonging to this hunk, in unified-diff order. */
  lines: DiffLine[];
  /**
   * Count of context lines that were collapsed *before* this hunk (i.e.
   * between the previous hunk and this one). Zero for the first hunk when
   * there's no preceding collapse.
   */
  collapsedBefore: number;
}

/**
 * Top-level result of `computeDiff`. `addedLines` / `removedLines` are
 * convenience counters the timeline summary uses (`+12 −3`).
 */
export interface DiffResult {
  hunks: DiffHunk[];
  addedLines: number;
  removedLines: number;
  /** True when the two inputs are byte-identical. Hunks will be empty. */
  unchanged: boolean;
}
