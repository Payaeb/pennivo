// Completion-date support for the task checkbox ("Record completion dates"
// setting). When enabled, checking a task off appends ` [done:: YYYY-MM-DD]`
// to the end of its first paragraph; unchecking removes every done token.
//
// planDoneFieldEdit is the pure planner (string in, edit plan out, offsets
// relative to the scan string). applyTaskToggle wires it into a single
// ProseMirror transaction together with the checkbox flip, so one undo
// reverts both.

import { scanMetaTokens } from "@pennivo/core";
import type { Node } from "@milkdown/prose/model";
import type { EditorState, Transaction } from "@milkdown/prose/state";

// Placeholder for code-marked text and non-text inline nodes in the planner's
// scan string. Unlike the spaces buildParagraphScanText uses, it is not
// whitespace, so the planner never mistakes padding for a real space (which
// glued the token to a code span and, on uncheck, deleted a real character
// or node). It is not a letter/digit either, so it cannot form or break tags.
const PAD = "￼";

/** Scan text for the done-field planner: 1:1 with ProseMirror offsets. */
function buildPlannerScanText(paragraph: Node): string {
  let text = "";
  paragraph.forEach((child) => {
    if (!child.isText) {
      text += PAD.repeat(child.nodeSize);
      return;
    }
    const hasCode = child.marks.some(
      (m) => m.type.name === "code" || m.type.name === "inlineCode",
    );
    text += hasCode ? PAD.repeat(child.text!.length) : child.text;
  });
  return text;
}

export interface DoneFieldPlan {
  /** Text to append at the END of the paragraph content (includes its own
   *  leading space when one is needed). Absent when nothing should be added. */
  insertText?: string;
  /** Half-open [from, to) ranges to delete, paragraph-relative, ascending,
   *  non-overlapping. Empty when nothing should be removed. */
  deleteRanges: { from: number; to: number }[];
}

/**
 * Decide the done-field edit for a task flipping to `nextChecked`.
 *
 * - checked, no valid done token present: append ` [done:: nowIso]` (no
 *   leading space when the text is empty or already ends in whitespace).
 * - checked, a valid done token already present: no change (never double up).
 * - unchecked: delete every valid done token, plus one adjacent leading
 *   space so no double space is left behind. A token at the very start of
 *   the paragraph takes its trailing space instead.
 */
export function planDoneFieldEdit(
  paragraphScanText: string,
  nowIso: string,
  nextChecked: boolean,
): DoneFieldPlan {
  const doneTokens = scanMetaTokens(paragraphScanText).filter(
    (t) => t.kind === "done",
  );

  if (nextChecked) {
    if (doneTokens.length > 0) return { deleteRanges: [] };
    const needsSpace =
      paragraphScanText.length > 0 && !/\s$/.test(paragraphScanText);
    return {
      insertText: `${needsSpace ? " " : ""}[done:: ${nowIso}]`,
      deleteRanges: [],
    };
  }

  const deleteRanges: { from: number; to: number }[] = [];
  let prevEnd = 0;
  for (const token of doneTokens) {
    let from = token.start;
    let to = token.end;
    if (from > prevEnd && paragraphScanText[from - 1] === " ") {
      from -= 1;
    } else if (from === 0 && paragraphScanText[to] === " ") {
      to += 1;
    }
    deleteRanges.push({ from, to });
    prevEnd = to;
  }
  return { deleteRanges };
}

/**
 * Build the transaction for flipping the task list_item at `itemPos` to
 * `nextChecked`. With `recordCompletionDates` on, the done-field edit on the
 * item's first paragraph rides in the same transaction; with it off, only
 * the checkbox flips and no text is touched.
 */
export function applyTaskToggle(
  state: EditorState,
  itemPos: number,
  nextChecked: boolean,
  recordCompletionDates: boolean,
  nowIso: string,
): Transaction {
  const item = state.doc.nodeAt(itemPos) as Node;
  const tr = state.tr.setNodeMarkup(itemPos, undefined, {
    ...item.attrs,
    checked: nextChecked,
  });
  if (!recordCompletionDates) return tr;

  const first = item.firstChild;
  if (!first || first.type.name !== "paragraph") return tr;

  const contentStart = itemPos + 2; // list_item open + paragraph open
  const plan = planDoneFieldEdit(
    buildPlannerScanText(first),
    nowIso,
    nextChecked,
  );

  // Edits don't move the checkbox markup (setNodeMarkup is size-neutral);
  // apply right-to-left so earlier offsets stay valid.
  if (plan.insertText) {
    tr.insert(
      contentStart + first.content.size,
      state.schema.text(plan.insertText),
    );
  }
  for (let i = plan.deleteRanges.length - 1; i >= 0; i--) {
    const r = plan.deleteRanges[i]!;
    tr.delete(contentStart + r.from, contentStart + r.to);
  }
  return tr;
}
