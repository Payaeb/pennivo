// Pure plain-list-item labeler. Extracts every NON-checklist bullet/ordered
// list item that carries at least one inline `#label` token and/or a valid
// `[due:: ...]` date — the data source for the Tasks panel's Labels view
// (Phase 18c+) and for dated plain bullets in its Tasks view. An item with
// neither is not indexed.
//
// Deliberately excludes checklist lines (`- [ ]` / `- [x]`), even when they
// carry a label: a labeled TASK still reaches the Labels view, but via
// extractTaskItems' own `labels` field — the UI layer composes the output of
// both extractors rather than this file re-extracting checklist lines
// itself, so a labeled task is never indexed twice.
//
// Mirrors extractTasks.ts's line-scan structure (fence handling, indent
// convention, char-offset bookkeeping) by small, deliberate duplication
// rather than a shared line-scan helper — consistent with this package's
// existing convention for these tiny per-file scanners (see metaTokens.ts's
// own doc comment on why extractTasks.ts and the WYSIWYG chip plugin
// independently blank code spans rather than sharing that one line of code).

import type { LabeledItem } from "./types";
import { parseListItemText } from "./metaTokens";
import { TASK_LINE_RE } from "./extractTasks";

// Same fence-toggle convention as extractTasks.ts / outline.ts.
const FENCE_RE = /^\s*(```|~~~)/;

// Leading indentation, a list marker (bullet or ordered), then a mandatory
// space, then the rest of the line verbatim. Matches EVERY list item,
// checklist or not — callers must check TASK_LINE_RE first and skip a line
// that already qualifies as a checklist item.
const PLAIN_LIST_ITEM_RE = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;

/**
 * Extract every non-checklist list item that carries at least one `#label`
 * token and/or a valid `[due:: YYYY-MM-DD]` date (a dated plain bullet has
 * `labels: []`). Checklist items (`- [ ]` / `- [x]`) are always skipped here, even
 * when they carry a label — extractTaskItems is the source of truth for
 * those; the Labels view composes both extractors' output in the UI layer.
 * `path` is stamped onto every item verbatim, same convention as
 * extractTaskItems. Never throws.
 */
export function extractLabeledItems(
  content: string,
  path: string,
): LabeledItem[] {
  const items: LabeledItem[] = [];
  const rawLines = content.split("\n");
  let offset = 0;
  let inFence = false;

  for (let i = 0; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    // Strip a trailing \r (CRLF files) so it never leaks into captured text.
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

    if (!TASK_LINE_RE.test(line)) {
      const m = PLAIN_LIST_ITEM_RE.exec(line);
      if (m) {
        const indent = m[1]!.length;
        const rawText = m[2] ?? "";
        const { labels, due, displayText } = parseListItemText(rawText);
        if (labels.length > 0 || due !== null) {
          items.push({
            path,
            line: i,
            charOffset: offset,
            rawText,
            displayText,
            labels,
            due,
            indent,
          });
        }
      }
    }

    offset += rawLine.length + 1;
  }

  return items;
}
