// Pure GFM-checklist extractor. A light line-scan (no markdown AST), matching
// the house pattern set by outline.ts: fenced code blocks are tracked with a
// FENCE_RE toggle so nothing inside a ``` or ~~~ fence (including an unclosed
// fence that runs to EOF) is ever mistaken for a task. Lives in core so it can
// be unit-tested without fs/DOM. Never throws.
//
// Syntax locked 2026-10-08:
//  - A task line is: optional indentation, a list marker (-, *, +, or an
//    ordered marker like `1.` / `1)`), then `[ ]` or `[x]`/`[X]` followed by a
//    space. Nested at any depth (indent is just the leading-whitespace count).
//  - Labels are inline `#tag` tokens on the item's text. The tag charset is
//    unicode letters, digits, `-`, `_`, and must contain at least one
//    non-digit character (the Obsidian rule: `#2026` is not a tag). A `#` is
//    not a tag start when immediately preceded by a word character or `/`
//    (so `foo#bar` and a URL fragment like `.../#frag` never match). Tags
//    inside an inline code span (`...`) are ignored.
//  - Dates are an ASCII inline field `[due:: 2026-10-15]`, tolerant of extra
//    spaces around `due`, `::`, and the date. An invalid/garbage value (bad
//    calendar date, or non-date text) makes `due` null, silently — the field
//    token is still stripped from displayText either way. The FIRST
//    `[due:: ...]` field on a line decides `due`; later ones on the same line
//    are ignored (but still stripped for display).

import type { TaskItem } from "./types";

// A fence opener/closer, same convention as outline.ts: any ``` or ~~~ line
// toggles fence state, regardless of whether open/close markers match.
const FENCE_RE = /^\s*(```|~~~)/;

// Leading indentation, a list marker, then a checkbox and its mandatory
// separating space. Group 1: indentation. Group 2: checkbox char. Group 3:
// item text after the checkbox (absent when the line ends right at `]`).
const TASK_LINE_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?: (.*))?$/;

// An inline code span on a single line: a backtick, any run of non-backtick
// non-newline characters, then a closing backtick. Used only to blank out
// code-span text before label scanning; an unclosed backtick is left alone.
const CODE_SPAN_RE = /`[^`\n]*`/g;

// A `#tag` token, unicode-aware. Not a match when immediately preceded by a
// word character (letter/digit/underscore, any script) or `/` (so URL
// fragments like `https://x.com/#frag` are excluded).
const TAG_RE = /(?<![\p{L}\p{N}_/])#([\p{L}\p{N}_-]+)/gu;

// A tag made of digits only is not a tag (Obsidian rule: `#2026` is a year,
// not a label).
const ALL_DIGITS_RE = /^[0-9]+$/;

// A `[due:: value]` field, tolerant of extra spaces around `due`, `::`, and
// the value. Captures the raw (untrimmed) value up to the closing `]`.
const DUE_FIELD_RE = /\[\s*due\s*::\s*([^\]]*)\]/g;

// Strict ISO `YYYY-MM-DD` shape.
const ISO_DATE_SHAPE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate `value` as a real calendar date in strict `YYYY-MM-DD` shape.
 * Returns the value unchanged (no timezone math — it is never reparsed into
 * a different representation) or null when the shape or the calendar date
 * itself (e.g. month 13, Feb 30) is invalid.
 */
function parseIsoDateStrict(value: string): string | null {
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

interface ParsedItemText {
  labels: string[];
  due: string | null;
  displayText: string;
}

/** Extract labels and the due field from one task item's raw text. */
function parseItemText(rawText: string): ParsedItemText {
  // Blank out inline code spans (same length, so this stays a pure text op)
  // before scanning for tags, so `#tag`-looking text inside `...` is ignored.
  const scanText = rawText.replace(CODE_SPAN_RE, (m) => " ".repeat(m.length));

  const labels: string[] = [];
  const seen = new Set<string>();
  TAG_RE.lastIndex = 0;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_RE.exec(scanText)) !== null) {
    const candidate = tagMatch[1];
    if (ALL_DIGITS_RE.test(candidate)) continue;
    if (!seen.has(candidate)) {
      seen.add(candidate);
      labels.push(candidate);
    }
  }

  let due: string | null = null;
  let firstDueSeen = false;
  const stripped = rawText.replace(DUE_FIELD_RE, (_match, value: string) => {
    if (!firstDueSeen) {
      firstDueSeen = true;
      due = parseIsoDateStrict(value.trim());
    }
    return "";
  });

  const displayText = stripped.replace(/\s+/g, " ").trim();

  return { labels, due, displayText };
}

/**
 * Extract every GFM checklist item from `content`. Plain (non-checklist)
 * list items are not indexed in v1. `path` is stamped onto every item
 * verbatim (the caller decides the workspace-relative convention). Never
 * throws.
 */
export function extractTaskItems(content: string, path: string): TaskItem[] {
  const items: TaskItem[] = [];
  const rawLines = content.split("\n");
  let offset = 0;
  let inFence = false;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    // Strip a trailing \r (CRLF files) so it never leaks into captured text.
    // The absolute offset arithmetic below still uses rawLine's true length.
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      offset += rawLine.length + 1;
      continue;
    }

    if (inFence) {
      offset += rawLine.length + 1;
      continue;
    }

    const m = TASK_LINE_RE.exec(line);
    if (m) {
      const indent = m[1].length;
      const checked = m[2] === "x" || m[2] === "X";
      const rawText = m[3] ?? "";
      const { labels, due, displayText } = parseItemText(rawText);
      items.push({
        path,
        line: i,
        charOffset: offset,
        checked,
        rawText,
        displayText,
        labels,
        due,
        indent,
      });
    }

    offset += rawLine.length + 1;
  }

  return items;
}
