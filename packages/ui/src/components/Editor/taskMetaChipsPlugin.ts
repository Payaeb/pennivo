// Milkdown $prose plugin that renders inline `#tag` and `[due:: ...]`
// tokens as styled chips — purely a view-layer decoration. The markdown
// text on disk, and the ProseMirror doc itself, are never touched: this
// only adds Decorations so the chip styling sits on top of the existing
// text (cursor placement, typing, and selection all see the raw text,
// unchanged).
//
// Scope: only paragraphs that are a DIRECT child of a list_item are
// scanned — this is the same surface extractTaskItems indexes (list items),
// so a tag/due token looks the same whether you're reading it in a task
// line or in the cross-file task index. Token matching itself is shared
// with extractTaskItems via scanMetaTokens (packages/core/src/tasks) so the
// two can never disagree on what counts as a tag or a valid due field.
//
// Structure follows collapsibleListPlugin.ts: a $prose plugin whose state
// is a DecorationSet, rebuilt on tr.docChanged and otherwise mapped through
// the transaction (so decorations survive unrelated edits elsewhere in the
// doc without a full doc walk).

import { scanMetaTokens } from "@pennivo/core";
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { Node } from "@milkdown/prose/model";

const taskMetaChipsKey = new PluginKey("task-meta-chips");

/**
 * Build the scan string for one paragraph's inline content: text node
 * content concatenated in order, with any text carrying the `code` mark
 * blanked out to same-length spaces (so `#tag`-looking text inside an
 * inline code span is never decorated — same rule extractTaskItems applies
 * to backtick code spans in raw markdown). Non-text leaf nodes (e.g.
 * hard_break) are padded to their nodeSize so every char offset in the
 * returned string still lines up 1:1 with a ProseMirror content position
 * relative to the paragraph's content start.
 */
export function buildParagraphScanText(paragraph: Node): string {
  let text = "";
  paragraph.forEach((child) => {
    if (!child.isText) {
      text += " ".repeat(child.nodeSize);
      return;
    }
    const hasCodeMark = child.marks.some((mark) => mark.type.name === "code");
    text += hasCodeMark ? " ".repeat(child.text!.length) : child.text;
  });
  return text;
}

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent) => {
    if (node.type.name !== "paragraph") return;
    // Scope to paragraphs that are a direct child of a list_item. This also
    // guards against decorating inside a code_block: a code_block is never
    // a "paragraph" node, so it can't reach this branch regardless of
    // nesting.
    if (!parent || parent.type.name !== "list_item") return;

    const scanText = buildParagraphScanText(node);
    const tokens = scanMetaTokens(scanText);
    if (tokens.length === 0) return false;

    const contentStart = pos + 1;
    for (const token of tokens) {
      const from = contentStart + token.start;
      const to = contentStart + token.end;

      if (token.kind === "label") {
        decorations.push(
          Decoration.inline(from, to, {
            class: "meta-chip meta-chip--label",
          }),
        );
        continue;
      }

      // due / done — whole-token chip, plus sub-decorations for the dimmed
      // `[due::`/`]` syntax and the emphasized date. `done` (the completion
      // date the editor can append on check-off) gets its own muted class.
      decorations.push(
        Decoration.inline(from, to, {
          class:
            token.kind === "done"
              ? "meta-chip meta-chip--done"
              : "meta-chip meta-chip--due",
        }),
      );

      const datePart = token.datePart;
      if (!datePart) continue;
      const dateFrom = contentStart + datePart.start;
      const dateTo = contentStart + datePart.end;

      if (dateFrom > from) {
        decorations.push(
          Decoration.inline(from, dateFrom, { class: "meta-chip__syntax" }),
        );
      }
      decorations.push(
        Decoration.inline(dateFrom, dateTo, { class: "meta-chip__date" }),
      );
      if (to > dateTo) {
        decorations.push(
          Decoration.inline(dateTo, to, { class: "meta-chip__syntax" }),
        );
      }
    }

    // No need to recurse into the paragraph's own text-node children — the
    // scan above already covered its full content.
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

export const taskMetaChipsPlugin = $prose(
  () =>
    new Plugin({
      key: taskMetaChipsKey,

      state: {
        init(_, state) {
          return buildDecorations(state.doc);
        },
        apply(tr, oldDeco) {
          if (tr.docChanged) {
            return buildDecorations(tr.doc);
          }
          return oldDeco.map(tr.mapping, tr.doc);
        },
      },

      props: {
        decorations(state) {
          return taskMetaChipsKey.getState(state);
        },
      },
    }),
);
