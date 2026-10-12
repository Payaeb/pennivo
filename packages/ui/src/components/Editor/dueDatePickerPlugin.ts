// Milkdown $prose plugin backing the "type `[due::` to get a date picker"
// feature. Purely a TRIGGER TRACKER — like taskMetaChipsPlugin.ts, it never
// touches the document: it only derives, on every transaction, whether the
// cursor currently sits right after an unclosed `[due::` field inside a list
// item, and if so, the document-position range that a picked date should
// replace. Editor.tsx mirrors this plugin state into local React state (same
// `view().update()` pattern toolbarSync already uses to reach React) and
// renders the actual popover; this file has no React/DOM-popover concerns.
//
// Scope matches taskMetaChipsPlugin.ts exactly: only a paragraph that is a
// DIRECT child of a list_item is considered, and text carrying the `code`
// mark is blanked out before scanning (so a `[due::`-looking run inside
// inline code never triggers). The two plugins intentionally stay
// independent files — this one is never allowed to import from or modify
// taskMetaChipsPlugin.ts.

import { scanMetaTokens } from "@pennivo/core";
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, Selection } from "@milkdown/prose/state";
import type { EditorState } from "@milkdown/prose/state";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

// --- Pure trigger detection (unit-tested directly, no ProseMirror needed) --

export interface DueTriggerContext {
  /** Full text content of the paragraph under the cursor. Any inline-code
   *  marked run must already be blanked to same-length spaces by the caller
   *  (see buildParagraphScanText below) so code spans never trigger. */
  text: string;
  /** Cursor offset relative to the start of `text`. */
  cursorOffset: number;
  /** Whether the paragraph is a direct child of a list_item. The feature is
   *  scoped to list items only (per spec); callers outside a list item
   *  should still call this with `inListItem: false` rather than skip the
   *  call, so this single function stays the one source of truth for "does
   *  it trigger." */
  inListItem: boolean;
}

export interface DueTriggerMatch {
  /** Offset of the trigger's `[`, relative to the scanned text. */
  from: number;
  /** Offset directly after the last typed character (== cursorOffset). */
  to: number;
}

// Matches an OPEN (not yet closed by `]`) `[due::` field ending exactly at
// the cursor, tolerant of inner whitespace the same way DUE_FIELD_RE is, with
// zero or more already-typed date characters (digits/dashes) after it. Only
// digits and dashes are accepted post-`::` — anything else typed there is a
// divergence from a date and the match simply stops applying (the regex
// stops matching), which is exactly the "popover closes silently" behavior
// the spec asks for.
const OPEN_TRIGGER_RE = /\[\s*due\s*::\s*[0-9-]*$/;

/**
 * Does the cursor sit at the end of a live, uncommitted `[due::` field? If
 * so, returns the [from, to) range (relative to `text`) that a picked date
 * should replace — `from` is the trigger's `[`, `to` is the cursor itself.
 * Returns null when there's nothing to trigger on, including when the
 * cursor is merely sitting inside an ALREADY-COMPLETE, valid `[due:: date]`
 * field (e.g. the user clicked back into one to hand-edit it) — scanMetaTokens
 * is the shared source of truth for what counts as "already complete," so
 * this can never disagree with the chip renderer or the task index about it.
 */
export function detectDueTrigger(
  ctx: DueTriggerContext,
): DueTriggerMatch | null {
  const { text, cursorOffset, inListItem } = ctx;
  if (!inListItem) return null;
  if (cursorOffset < 0 || cursorOffset > text.length) return null;

  for (const token of scanMetaTokens(text)) {
    if (
      token.kind === "due" &&
      cursorOffset >= token.start &&
      cursorOffset <= token.end
    ) {
      return null;
    }
  }

  const before = text.slice(0, cursorOffset);
  const match = OPEN_TRIGGER_RE.exec(before);
  if (!match) return null;

  return { from: cursorOffset - match[0].length, to: cursorOffset };
}

// --- ProseMirror integration -------------------------------------------

/** Build the scan string for one paragraph's inline content, blanking any
 *  `code`-marked text to same-length spaces. Deliberately duplicated from
 *  taskMetaChipsPlugin.ts's buildParagraphScanText (same ~10 lines) rather
 *  than imported/exported from there — this file owns no dependency on
 *  that plugin, by design (a concurrent change is in flight elsewhere in
 *  this package; keeping the two fully independent avoids any coupling). */
function buildParagraphScanText(paragraph: ProseMirrorNode): string {
  let text = "";
  paragraph.forEach((child) => {
    if (!child.isText) {
      text += " ".repeat(child.nodeSize);
      return;
    }
    const hasCodeMark = child.marks.some(
      (mark) => mark.type.name === "code" || mark.type.name === "inlineCode",
    );
    text += hasCodeMark ? " ".repeat(child.text!.length) : child.text;
  });
  return text;
}

/** Document-position form of DueTriggerMatch — what the plugin actually
 *  exposes via its key, since every consumer (Editor.tsx, the insert helper
 *  below) needs real doc positions, not paragraph-relative offsets. */
export interface DueDatePickerMatch {
  from: number;
  to: number;
}

export const dueDatePickerKey = new PluginKey<DueDatePickerMatch | null>(
  "due-date-picker",
);

function computeMatch(state: EditorState): DueDatePickerMatch | null {
  const { selection } = state;
  if (!selection.empty) return null;

  const $from = selection.$from;
  const parent = $from.parent;
  if (parent.type.name !== "paragraph") return null;
  if ($from.depth < 1) return null;

  const grandParent = $from.node($from.depth - 1);
  if (grandParent.type.name !== "list_item") return null;

  const text = buildParagraphScanText(parent);
  const cursorOffset = $from.parentOffset;
  const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
  if (!match) return null;

  const contentStart = $from.start();
  return { from: contentStart + match.from, to: contentStart + match.to };
}

/**
 * Tracks the live `[due::` trigger (if any) at the cursor. State is always
 * recomputed fresh from the new state on every transaction (selection
 * change OR doc change both matter here, unlike a decoration set that only
 * needs to react to docChanged) — the scan is one paragraph, cheap enough
 * that there's no need for incremental mapping.
 */
export const dueDatePickerPlugin = $prose(
  () =>
    new Plugin<DueDatePickerMatch | null>({
      key: dueDatePickerKey,
      state: {
        init(_, state) {
          return computeMatch(state);
        },
        apply(_tr, _prev, _oldState, newState) {
          return computeMatch(newState);
        },
      },
    }),
);

/**
 * Commit a picked date: replace [from, to) with the canonical
 * `[due:: YYYY-MM-DD]` token, add a trailing space if the next character
 * isn't already whitespace (so the token doesn't fuse with following text),
 * place the cursor right after the inserted text, and return focus to the
 * editor (picking happens via a popover button, which otherwise would leave
 * focus stranded on that button).
 */
export function insertDueToken(
  view: EditorView,
  from: number,
  to: number,
  iso: string,
): void {
  const { state } = view;
  const token = `[due:: ${iso}]`;
  const docSize = state.doc.content.size;
  const nextChar = to < docSize ? state.doc.textBetween(to, to + 1) : "";
  const needsTrailingSpace = nextChar.length > 0 && !/\s/.test(nextChar);
  const insertText = needsTrailingSpace ? `${token} ` : token;

  const tr = state.tr.insertText(insertText, from, to);
  const newPos = from + insertText.length;
  tr.setSelection(Selection.near(tr.doc.resolve(newPos)));
  view.dispatch(tr);
  view.focus();
}
