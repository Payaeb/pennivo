// Shared low-level scanner for inline task metadata — `#tag` labels and
// `[due:: YYYY-MM-DD]` fields. extractTasks.ts (the cross-file task index)
// and the WYSIWYG chip renderer both read these regexes/functions from here
// so the two can never drift apart on what counts as a label or a due
// field: one definition, two consumers.
//
// Pure string scanning only: no knowledge of markdown fences or ProseMirror
// marks. extractTasks.ts blanks out backtick code spans (markdown-specific)
// before calling scanMetaTokens; the WYSIWYG plugin blanks out ProseMirror
// inline-code-marked text (editor-specific) before calling it. Neither
// concern belongs here.

import type { MetaToken } from "./types";

// A `#tag` token, unicode-aware. Not a match when immediately preceded by a
// word character (letter/digit/underscore, any script) or `/` (so URL
// fragments like `https://x.com/#frag` are excluded).
export const TAG_RE = /(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_-]+)/gu;

// A tag made of digits only is not a tag (Obsidian rule: `#2026` is a year,
// not a label).
export const ALL_DIGITS_RE = /^[0-9]+$/;

// A `[due:: value]` field, tolerant of extra spaces around `due`, `::`, and
// the value. Captures the raw (untrimmed) value up to the closing `]`.
export const DUE_FIELD_RE = /\[\s*due\s*::\s*([^\]]*)\]/g;

// Strict ISO `YYYY-MM-DD` shape.
const ISO_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate `value` as a real calendar date in strict `YYYY-MM-DD` shape.
 * Returns the value unchanged (no timezone math — it is never reparsed into
 * a different representation) or null when the shape or the calendar date
 * itself (e.g. month 13, Feb 30) is invalid.
 */
export function parseIsoDateStrict(value: string): string | null {
  const m = ISO_DATE_SHAPE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

/**
 * Scan a single line/text string for inline task-metadata tokens: every
 * `#tag` label occurrence and every syntactically-and-calendar valid
 * `[due:: YYYY-MM-DD]` field, with char ranges relative to `lineText`.
 * Returned in left-to-right order. Never deduped — a `#tag` repeated three
 * times yields three tokens, one per occurrence (callers that want a
 * deduped label set, like extractTaskItems, dedupe on top of this).
 *
 * A due field whose value fails shape or calendar validation (e.g.
 * `[due:: soon]` or `[due:: 2026-13-45]`) yields no token at all — the same
 * "silently absent" rule extractTaskItems applies to TaskItem.due. Each
 * `due` token's `datePart` gives the tighter range of just the date digits
 * (excluding the `[due::`/`]` syntax and any inner whitespace), so callers
 * can style the two parts differently without re-deriving the split.
 */
export function scanMetaTokens(lineText: string): MetaToken[] {
  const tokens: MetaToken[] = [];

  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_RE.exec(lineText)) !== null) {
    const candidate = tagMatch[1] ?? "";
    if (ALL_DIGITS_RE.test(candidate)) continue;
    tokens.push({
      kind: "label",
      start: tagMatch.index,
      end: tagMatch.index + tagMatch[0].length,
      value: candidate,
    });
  }

  DUE_FIELD_RE.lastIndex = 0;
  let dueMatch: RegExpExecArray | null;
  while ((dueMatch = DUE_FIELD_RE.exec(lineText)) !== null) {
    const whole = dueMatch[0];
    const group = dueMatch[1] ?? "";
    // Group 1 directly precedes the closing "]" with nothing in between, so
    // its start offset is derivable from the lengths alone — no need for
    // the regex `d` (indices) flag.
    const groupStart = dueMatch.index + whole.length - group.length - 1;
    const leadingWs = group.length - group.trimStart().length;
    const trimmed = group.trim();
    const parsed = parseIsoDateStrict(trimmed);
    if (parsed === null) continue;

    const dateStart = groupStart + leadingWs;
    const dateEnd = dateStart + trimmed.length;
    tokens.push({
      kind: "due",
      start: dueMatch.index,
      end: dueMatch.index + whole.length,
      value: parsed,
      datePart: { start: dateStart, end: dateEnd },
    });
  }

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}
