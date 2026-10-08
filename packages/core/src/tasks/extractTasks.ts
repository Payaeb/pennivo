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
import { DUE_FIELD_RE, parseIsoDateStrict, scanMetaTokens } from "./metaTokens";

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

  // scanMetaTokens is the single source of truth for what counts as a tag
  // (char classes, the foo#bar/URL-fragment exclusion, the all-digits
  // rejection) — shared verbatim with the WYSIWYG chip renderer. Dedupe by
  // first appearance is this extractor's own business rule (a TaskItem's
  // `labels` is a set), not part of the token semantics, so it stays here.
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
