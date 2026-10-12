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
// the value. Captures the raw (untrimmed) value up to the closing `]`. Also
// tolerant of a LEADING BACKSLASH (`\[due:: ...]`) — Milkdown's markdown
// serializer escapes a literal `[` in plain text (it could otherwise start
// link syntax), so a due field that round-trips through a save can come
// back from disk as `\[due:: 2026-10-15]`. The backslash is included in the
// match (and so gets stripped along with the rest of the token wherever a
// caller strips this field from display text), never left stranded.
export const DUE_FIELD_RE = /\\?\[\s*due\s*::\s*([^\]]*)\]/g;

// A `[done:: value]` field — same shape/escaping tolerance as DUE_FIELD_RE,
// for the completion-date field the editor appends on checkbox check-off
// (Phase 18c+, "Record completion dates" setting).
export const DONE_FIELD_RE = /\\?\[\s*done\s*::\s*([^\]]*)\]/g;

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
 * Shared scan loop for DUE_FIELD_RE and DONE_FIELD_RE — identical token-
 * building logic, parameterized only by the regex and the resulting
 * MetaToken's `kind`, so the due/done fields can never drift apart on how a
 * bracket-date field's ranges are computed.
 */
function scanBracketDateField(
  lineText: string,
  re: RegExp,
  kind: "due" | "done",
): MetaToken[] {
  const tokens: MetaToken[] = [];
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(lineText)) !== null) {
    const whole = match[0];
    const group = match[1] ?? "";
    // Group 1 directly precedes the closing "]" with nothing in between, so
    // its start offset is derivable from the lengths alone — no need for
    // the regex `d` (indices) flag. Holds regardless of whether `whole`
    // starts with the optional escaping backslash.
    const groupStart = match.index + whole.length - group.length - 1;
    const leadingWs = group.length - group.trimStart().length;
    const trimmed = group.trim();
    const parsed = parseIsoDateStrict(trimmed);
    if (parsed === null) continue;

    const dateStart = groupStart + leadingWs;
    const dateEnd = dateStart + trimmed.length;
    tokens.push({
      kind,
      start: match.index,
      end: match.index + whole.length,
      value: parsed,
      datePart: { start: dateStart, end: dateEnd },
    });
  }
  return tokens;
}

/**
 * Scan a single line/text string for inline task-metadata tokens: every
 * `#tag` label occurrence and every syntactically-and-calendar valid
 * `[due:: YYYY-MM-DD]` / `[done:: YYYY-MM-DD]` field, with char ranges
 * relative to `lineText`. Returned in left-to-right order. Never deduped —
 * a `#tag` repeated three times yields three tokens, one per occurrence
 * (callers that want a deduped label set, like extractTaskItems, dedupe on
 * top of this).
 *
 * A due/done field whose value fails shape or calendar validation (e.g.
 * `[due:: soon]` or `[due:: 2026-13-45]`) yields no token at all — the same
 * "silently absent" rule extractTaskItems applies to TaskItem.due/done. Each
 * due/done token's `datePart` gives the tighter range of just the date
 * digits (excluding the `[due::`/`]` syntax and any inner whitespace), so
 * callers can style the two parts differently without re-deriving the split.
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

  tokens.push(...scanBracketDateField(lineText, DUE_FIELD_RE, "due"));
  tokens.push(...scanBracketDateField(lineText, DONE_FIELD_RE, "done"));

  tokens.sort((a, b) => a.start - b.start);
  return tokens;
}

// An inline code span on a single line: a backtick, any run of non-backtick
// non-newline characters, then a closing backtick. Used only to blank out
// code-span text before label scanning; an unclosed backtick is left alone.
const CODE_SPAN_RE = /`[^`\n]*`/g;

export interface ParsedListItemText {
  /** Inline `#tag` labels, deduped, without the leading `#`, in order of first appearance. */
  labels: string[];
  /** ISO `YYYY-MM-DD` from the first `[due:: ...]` field, or null when absent/invalid. */
  due: string | null;
  /** ISO `YYYY-MM-DD` from the first `[done:: ...]` field, or null when absent/invalid. */
  done: string | null;
  /** `rawText` with every due/done field removed and whitespace collapsed/trimmed. */
  displayText: string;
}

/**
 * Derive labels, the due/done fields, and a display-ready text from one
 * list item's raw text (the text after the list marker, or after the
 * checkbox for a checklist item). Shared by extractTaskItems and
 * extractLabeledItems so the two extractors can never disagree on what
 * counts as a label or a valid due/done field — the same reason
 * scanMetaTokens itself exists as a single shared scanner (see this file's
 * top doc comment).
 */
export function parseListItemText(rawText: string): ParsedListItemText {
  // Blank out inline code spans (same length, so this stays a pure text op)
  // before scanning for tags, so `#tag`-looking text inside `...` is ignored.
  const scanText = rawText.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));

  // scanMetaTokens is the single source of truth for what counts as a tag
  // (char classes, the foo#bar/URL-fragment exclusion, the all-digits
  // rejection) — shared verbatim with the WYSIWYG chip renderer. Dedupe by
  // first appearance is this function's own business rule (labels form a
  // set), not part of the token semantics, so it stays here.
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const token of scanMetaTokens(scanText)) {
    if (token.kind !== "label") continue;
    if (!seen.has(token.value)) {
      seen.add(token.value);
      labels.push(token.value);
    }
  }

  let due: string | null = null;
  let firstDueSeen = false;
  let stripped = rawText.replace(DUE_FIELD_RE, (_match, value: string) => {
    if (!firstDueSeen) {
      firstDueSeen = true;
      due = parseIsoDateStrict(value.trim());
    }
    return "";
  });

  let done: string | null = null;
  let firstDoneSeen = false;
  stripped = stripped.replace(DONE_FIELD_RE, (_match, value: string) => {
    if (!firstDoneSeen) {
      firstDoneSeen = true;
      done = parseIsoDateStrict(value.trim());
    }
    return "";
  });

  const displayText = stripped.replace(/\s+/g, " ").trim();

  return { labels, due, done, displayText };
}
