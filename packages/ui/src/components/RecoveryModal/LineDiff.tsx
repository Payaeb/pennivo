import { useMemo } from "react";
import { computeDiff, type DiffMode } from "@pennivo/core";
import "./LineDiff.css";

interface LineDiffProps {
  oldText: string;
  newText: string;
  /**
   * `'word'` is wired but not implemented in v1 — `computeDiff` falls back
   * to `'line'`. The prop exists so callsites can pass through whatever the
   * future Settings → Recovery diff-style toggle picks once Direction C ships.
   */
  mode?: DiffMode;
  /** Optional aria-label for the diff container. */
  ariaLabel?: string;
}

/**
 * `LineDiff` — renders a unified line diff via `computeDiff` from
 * `@pennivo/core`. Visual treatment per design doc §2.2:
 *
 * - Removed lines:  `--danger-soft` background, `−` gutter glyph
 * - Added lines:    `--accent-soft` background, `+` gutter glyph
 * - Context lines:  plain background, line-numbers in `--text-faint`
 * - Font:           `--font-editor` (serif/prose) by default; `--font-mono`
 *                   only inside fenced code blocks (detected via the diff's
 *                   `inCodeBlock` per-line tag)
 * - Hunk separator: `── N lines unchanged ──` divider in `--text-faint`
 *
 * The diff itself is computed in `@pennivo/core` so the renderer has zero
 * algorithmic surface — when word-diff lands, the same `DiffHunk[]` shape
 * gets a different visual layer.
 */
export function LineDiff({
  oldText,
  newText,
  mode = "line",
  ariaLabel = "Diff",
}: LineDiffProps) {
  const diff = useMemo(
    () => computeDiff(oldText, newText, mode),
    [oldText, newText, mode],
  );

  if (diff.unchanged) {
    return (
      <div className="line-diff line-diff--empty" aria-label={ariaLabel}>
        <span className="line-diff-empty-text">
          No changes between this snapshot and the current file.
        </span>
      </div>
    );
  }

  return (
    <div className="line-diff" aria-label={ariaLabel} role="region">
      {diff.hunks.map((hunk, hi) => (
        <div className="line-diff-hunk" key={hi}>
          {hunk.collapsedBefore > 0 && (
            <div className="line-diff-hunk-separator">
              <span>── {hunk.collapsedBefore} lines unchanged ──</span>
            </div>
          )}
          {hunk.lines.map((line, li) => {
            const cls = `line-diff-row line-diff-row--${line.kind}${
              line.inCodeBlock ? " line-diff-row--code" : ""
            }`;
            const gutter =
              line.kind === "add" ? "+" : line.kind === "remove" ? "−" : "";
            return (
              <div className={cls} key={`${hi}-${li}`}>
                <span className="line-diff-linenum line-diff-linenum--old">
                  {line.oldLineNumber ?? ""}
                </span>
                <span className="line-diff-linenum line-diff-linenum--new">
                  {line.newLineNumber ?? ""}
                </span>
                <span className="line-diff-gutter" aria-hidden="true">
                  {gutter}
                </span>
                <span className="line-diff-text">{line.text || " "}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
