// Incremental ProseMirror update engine for streaming render (Phase 12d).
//
// Today a streamed/external write reloads the WYSIWYG editor through a full
// Milkdown replaceAll: the whole document is rebuilt every frame, which drops
// selection and decorations and visibly reflows. applyStreamingUpdate replaces
// that with an APPEND-ONLY incremental apply: it finds the unchanged leading
// run of top-level blocks, reparses ONLY the trailing changed region, and
// dispatches a single transaction that swaps the tail of the document.
//
// The markdown->ProseMirror parse function is injected so this module stays
// unit-testable and does not hard-depend on a live Milkdown editor instance.
// The production wiring task will pass a parser bound to the editor's
// parserCtx. This file imports only prosemirror/milkdown types — no Electron or
// node dependencies.

import type { EditorView } from "@milkdown/prose/view";
import type { Node as ProseMirrorNode, Fragment } from "@milkdown/prose/model";
import type { Transaction } from "@milkdown/prose/state";
import { Selection, TextSelection } from "@milkdown/prose/state";

export interface StreamingUpdateResult {
  /** True if the incremental apply succeeded; false means the caller should
   *  fall back to a full replaceAll. */
  applied: boolean;
}

/** A markdown string -> ProseMirror nodes parser, bound by the caller. */
export type ParseMarkdown = (md: string) => ProseMirrorNode | Fragment;

/** A ProseMirror doc -> markdown serializer, bound by the caller. When
 *  provided it is the correctness gate: the post-apply document is
 *  re-serialized and compared against the target markdown. */
export type SerializeDoc = (doc: ProseMirrorNode) => string;

/**
 * Apply `nextStableMarkdown` to `view` incrementally, given the previous
 * markdown the document was last built from.
 *
 * v1 is APPEND-ONLY: it only handles the case where the change is confined to
 * the end of the document (the last block grew and/or new blocks were
 * appended). If any NON-trailing block differs, it bails with
 * `{ applied: false }` so the caller falls back to a full replaceAll. Any throw
 * inside is caught and also yields `{ applied: false }`; this function must
 * never corrupt the document — worst case it degrades to today's behavior.
 *
 * The block-count -> ProseMirror-node mapping assumes one markdown block maps
 * to one top-level node. That is false for constructs spanning multiple blocks
 * but a single node (a fenced code block with an internal blank line, a multi
 * paragraph list item or blockquote, an HTML block). When the common prefix
 * runs through such a construct the mapping over-counts and the trailing slice
 * starts INSIDE the node, mangling its tail. To stay correct regardless of the
 * mapping, when `serializeDoc` is provided the resulting document is
 * re-serialized and compared to `nextStableMarkdown` BEFORE dispatch: on any
 * mismatch the transaction is discarded and `{ applied: false }` is returned,
 * so the caller falls back to a full reload with the correct content.
 */
export function applyStreamingUpdate(
  view: EditorView,
  prevMarkdown: string,
  nextStableMarkdown: string,
  parseMarkdown: ParseMarkdown,
  serializeDoc?: SerializeDoc,
): StreamingUpdateResult {
  try {
    // No-op: nothing to apply. Treat as applied (the document already matches).
    if (prevMarkdown === nextStableMarkdown) {
      return { applied: true };
    }

    const prevBlocks = splitBlocks(prevMarkdown);
    const nextBlocks = splitBlocks(nextStableMarkdown);

    // Longest identical leading run of whole blocks.
    const commonPrefix = commonPrefixCount(prevBlocks, nextBlocks);

    // BAIL OUT: the change must be confined to the trailing region. That means
    // every prev block before the last one must be unchanged. If the common
    // prefix stops short of (prevBlocks.length - 1), some non-trailing block
    // differs and an append-only apply would corrupt the document.
    //
    // The allowed shapes are:
    //  - prev is a strict block-prefix of next (new blocks appended), OR
    //  - all but the last prev block match and the last prev block grew.
    if (commonPrefix < prevBlocks.length - 1) {
      // Exception: prev fully matches as a prefix (commonPrefix ===
      // prevBlocks.length) is the pure-append case and is fine.
      if (commonPrefix !== prevBlocks.length) {
        return { applied: false };
      }
    }

    // Number of leading blocks that are byte-identical and therefore kept in the
    // document untouched.
    const keptBlocks = commonPrefix;

    // The trailing markdown to (re)parse is everything in `next` from the first
    // changed block onward.
    const trailingMarkdown = nextBlocks.slice(keptBlocks).join("\n\n");

    // Map the kept-block count to a ProseMirror document position by walking the
    // top-level children of the doc.
    const prefixEndPos = topLevelBlockBoundary(view.state.doc, keptBlocks);
    if (prefixEndPos === null) {
      // Document shape does not line up with the block count (e.g. the editor's
      // node structure does not map 1:1 to markdown blocks). Bail safely.
      return { applied: false };
    }

    // Parse only the trailing region into nodes/fragment.
    const parsed =
      trailingMarkdown.length === 0 ? null : parseMarkdown(trailingMarkdown);

    const { state } = view;
    const docEnd = state.doc.content.size;

    // Capture the current selection so we can restore it after the replace.
    const selAnchor = state.selection.anchor;
    const selHead = state.selection.head;

    const tr = state.tr;

    if (parsed === null) {
      // Trailing region is empty: delete everything after the prefix.
      tr.delete(prefixEndPos, docEnd);
    } else {
      const slice = toReplacementContent(parsed);
      tr.replaceWith(prefixEndPos, docEnd, slice);
    }

    // Streamed content must not pollute undo history, and downstream plugins can
    // key off the streaming flag to skip expensive work.
    tr.setMeta("addToHistory", false);
    tr.setMeta("pennivoStreaming", true);

    // CORRECTNESS GATE: tr.doc already reflects the replace (pre-dispatch). When
    // a serializer is provided, re-serialize the resulting document and compare
    // it to the target markdown. This catches any block-mapping skew (a slice
    // that started inside a multi-block construct) BEFORE it reaches the screen:
    // on mismatch we discard the transaction and let the caller full-reload the
    // correct content. Normalize only trailing whitespace/newlines on both sides
    // (the serializer may add or trim a final newline); never touch interior
    // content.
    if (serializeDoc) {
      const produced = trimTrailing(serializeDoc(tr.doc));
      const expected = trimTrailing(nextStableMarkdown);
      if (produced !== expected) {
        return { applied: false };
      }
    }

    // Restore selection. If both endpoints were before the replaced region, the
    // user's earlier selection is preserved (mapped through the change). If the
    // selection fell inside the replaced trailing region, drop the cursor at the
    // new end of the document.
    const selectionInPrefix =
      selAnchor < prefixEndPos && selHead < prefixEndPos;
    if (selectionInPrefix) {
      const mappedAnchor = tr.mapping.map(selAnchor);
      const mappedHead = tr.mapping.map(selHead);
      trySetTextSelection(tr, mappedAnchor, mappedHead);
    } else {
      const end = tr.doc.content.size;
      trySetTextSelection(tr, end, end);
    }

    view.dispatch(tr);
    return { applied: true };
  } catch {
    // Parse failure, position mapping error, or any other throw: never corrupt
    // the document — fall back to the caller's full replaceAll.
    return { applied: false };
  }
}

/**
 * Split markdown into top-level blocks on blank-line separators. Leading and
 * trailing blank lines are trimmed so block counts align across versions. The
 * separator used to rejoin is a single blank line ("\n\n").
 */
function splitBlocks(markdown: string): string[] {
  const trimmed = markdown.replace(/^\s*\n/, "").replace(/\s+$/, "");
  if (trimmed.length === 0) return [];
  return trimmed.split(/\n[ \t]*\n+/);
}

/** Length of the longest identical leading run of two block arrays. */
function commonPrefixCount(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}

/**
 * Walk `count` top-level children of the document and return the position just
 * after the last of them. Returns 0 when count is 0, and null when the document
 * has fewer top-level children than `count` (shape mismatch).
 */
function topLevelBlockBoundary(
  doc: ProseMirrorNode,
  count: number,
): number | null {
  if (count === 0) return 0;
  if (count > doc.childCount) return null;
  let pos = 0;
  for (let i = 0; i < count; i++) {
    pos += doc.child(i).nodeSize;
  }
  return pos;
}

/**
 * Normalize the parser output into content suitable for replaceWith. A Fragment
 * is passed through; a single Node is wrapped so replaceWith receives node
 * content. We accept either shape because parserCtx-bound parsers can return a
 * top-level doc Node or a Fragment depending on configuration.
 */
function toReplacementContent(
  parsed: ProseMirrorNode | Fragment,
): ProseMirrorNode | Fragment {
  // A doc-like Node exposes `.content` (a Fragment of its block children). If we
  // got such a Node, splice in its children rather than the doc node itself,
  // since a doc node cannot be nested inside another doc.
  const maybeNode = parsed as ProseMirrorNode;
  if (
    typeof (maybeNode as { type?: unknown }).type !== "undefined" &&
    maybeNode.type &&
    maybeNode.type.name === "doc"
  ) {
    return maybeNode.content;
  }
  return parsed;
}

/**
 * Set a text selection on the transaction, guarding against out-of-range
 * positions. Falls back to a near selection if the requested positions are not
 * valid text-selection points (e.g. they resolve inside an atom node).
 */
function trySetTextSelection(
  tr: Transaction,
  anchor: number,
  head: number,
): void {
  const size = tr.doc.content.size;
  const a = clamp(anchor, 0, size);
  const h = clamp(head, 0, size);
  try {
    tr.setSelection(TextSelection.create(tr.doc, a, h));
  } catch {
    tr.setSelection(Selection.near(tr.doc.resolve(clamp(a, 0, size))));
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Trim trailing whitespace and newlines only. Used to normalize both sides of
 * the re-serialize comparison so a serializer that adds or drops a final
 * newline does not trigger a false mismatch. Interior content is untouched.
 */
function trimTrailing(s: string): string {
  return s.replace(/\s+$/, "");
}
