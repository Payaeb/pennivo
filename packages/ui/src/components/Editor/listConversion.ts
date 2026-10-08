// Scoped bullet/ordered/task list conversions for the toolbar.
//
// `list_item` is schema-generic: `bullet_list` and `ordered_list` are plain
// containers, and task-ness is just a per-item `checked` attr (null = plain,
// false/true = task). Nothing about the schema forces every item in a list
// to share a type, so a bullet parent with a task child (and vice versa) is
// perfectly legal and round-trips through markdown per-item already.
//
// The toolbar conversions used to be implemented as lift-the-item-out-of-
// its-list, wrap-it-in-a-brand-new-list, then scan `doc.nodesBetween(from,
// to, ...)` to flip `checked` on every list_item the scan touched. That scan
// is the bug: `nodesBetween` on a selection visits every ANCESTOR node that
// contains the selected range, not just the selected item(s) — so converting
// one nested bullet to a task also flipped its parent (and grandparent...)
// list_item into a task, because after the lift+rewrap the parent was still
// an ancestor of the (re-wrapped) selection.
//
// This module replaces that pattern with explicit scoping: find the
// INNERMOST list containing the selection, and the exact sibling list_item
// index range the selection covers within that one list — never touching
// anything outside that range, and in particular never an ancestor.
//
// For task conversions the fix is additionally a NO lift/rewrap in-place
// attr flip (task-ness never needs a container change: a list_item can turn
// into a task item while staying exactly where it is, in whatever bullet_list
// or ordered_list already contains it — remark's per-item `checked` handling
// doesn't care, and the container's own `ordered` flag — not the item's own
// vestigial `listType`/`label` attrs — is what decides the rendered marker).
//
// Converting between bulletList and orderedList DOES need a container-type
// change, but only for the SCOPED sibling run: `retypeListScope` splits the
// current list into up to three siblings (an untouched prefix, the retyped
// scoped range, an untouched suffix) rather than lifting/rewrapping the
// whole selection, so items outside the scope — including the scoped run's
// own parent — are never touched.

import type { EditorView } from "@milkdown/prose/view";
import {
  Fragment,
  type Node as ProseMirrorNode,
  type NodeType,
  type ResolvedPos,
} from "@milkdown/prose/model";
import type { Transaction } from "@milkdown/prose/state";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";

export type ListConversionTarget = "bulletList" | "orderedList" | "taskList";

/**
 * The list format of the INNERMOST bullet_list/ordered_list enclosing
 * `$pos`, or null if `$pos` isn't inside a list (or a blockquote intervenes
 * — matches the existing walk-outward semantics in App.tsx's
 * getActiveFormats, which also treats a blockquote as blocking list
 * detection so the toolbar's "active" state and this module's scoping agree
 * on what counts as "in a list").
 */
export function innermostListFormat(
  $pos: ResolvedPos,
): ListConversionTarget | null {
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "bullet_list") {
      const item = d + 1 <= $pos.depth ? $pos.node(d + 1) : null;
      return item && item.attrs["checked"] != null ? "taskList" : "bulletList";
    }
    if (node.type.name === "ordered_list") return "orderedList";
    if (node.type.name === "blockquote") return null;
  }
  return null;
}

export interface ListScope {
  /** Position directly before the innermost list node (bullet_list/
   *  ordered_list) that encloses the selection. */
  listPos: number;
  /** The list node itself, as it existed in the doc the scope was computed
   *  from — callers must apply mutations against that same doc/transaction,
   *  not a later one, since positions and child offsets are only valid there. */
  listNode: ProseMirrorNode;
  /** Half-open [startIndex, endIndex) range of listNode's own list_item
   *  children that the selection covers. */
  startIndex: number;
  endIndex: number;
}

/**
 * Find the scoped sibling list_item range the selection [$from, $to] covers
 * within its innermost enclosing list — never an ancestor list, never a
 * sibling the selection doesn't actually touch.
 *
 * A collapsed selection scopes to the single item containing $from. A range
 * selection extends the scope to cover $to too, but ONLY when $to resolves
 * inside the SAME list at the SAME depth as $from; any other shape (the
 * selection crosses into a different list, or $to isn't in a list at all)
 * falls back to the single-item scope around $from. Under-scoping is always
 * safe here; the bug this module fixes is over-scoping into ancestors.
 */
export function findListScope(
  $from: ResolvedPos,
  $to: ResolvedPos,
): ListScope | null {
  let listDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "bullet_list" || name === "ordered_list") {
      listDepth = d;
      break;
    }
    if (name === "blockquote") return null;
  }
  if (listDepth < 0) return null;

  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const startIndex = $from.index(listDepth);

  let endIndex = startIndex + 1;
  if (
    $to.pos !== $from.pos &&
    $to.depth >= listDepth &&
    $to.before(listDepth) === listPos
  ) {
    endIndex = Math.max(endIndex, $to.index(listDepth) + 1);
  }
  endIndex = Math.min(endIndex, listNode.childCount);

  return { listPos, listNode, startIndex, endIndex };
}

/** Absolute doc positions of the scoped list_item nodes, usable with
 *  setNodeMarkup against the SAME doc the scope was computed from. */
function scopedItemPositions(scope: ListScope): number[] {
  const positions: number[] = [];
  scope.listNode.forEach((_child, childOffset, index) => {
    if (index >= scope.startIndex && index < scope.endIndex) {
      positions.push(scope.listPos + 1 + childOffset);
    }
  });
  return positions;
}

/**
 * In-place task conversion: set `checked: false` on every scoped list_item
 * that isn't already a task item (checked == null), leaving everything else
 * — container type, nesting, already-task siblings' checked state,
 * ancestors — untouched. Returns true if anything changed.
 */
export function flipCheckedInScope(tr: Transaction, scope: ListScope): boolean {
  let changed = false;
  for (const pos of scopedItemPositions(scope)) {
    const node = tr.doc.nodeAt(pos);
    if (!node || node.attrs["checked"] != null) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
    changed = true;
  }
  return changed;
}

/**
 * Change the container type (bullet_list <-> ordered_list) of exactly the
 * scoped sibling run, splitting the current list into up to three siblings
 * — an untouched prefix, the retyped scoped range, an untouched suffix — so
 * items outside the scope (including the scoped range's own parent) are
 * never touched. Clears `checked` on any scoped item that had it, since
 * leaving bullet/ordered list_item are, by definition, no longer tasks.
 */
export function retypeListScope(
  tr: Transaction,
  scope: ListScope,
  targetType: NodeType,
  targetAttrs: Record<string, unknown> | null,
): void {
  const children: ProseMirrorNode[] = [];
  scope.listNode.forEach((child) => children.push(child));

  const prefix = children.slice(0, scope.startIndex);
  const scoped = children
    .slice(scope.startIndex, scope.endIndex)
    .map((item) =>
      item.attrs["checked"] == null
        ? item
        : item.type.create(
            { ...item.attrs, checked: null },
            item.content,
            item.marks,
          ),
    );
  const suffix = children.slice(scope.endIndex);

  const replacement: ProseMirrorNode[] = [];
  if (prefix.length > 0) {
    replacement.push(
      scope.listNode.type.create(
        scope.listNode.attrs,
        Fragment.fromArray(prefix),
      ),
    );
  }
  replacement.push(targetType.create(targetAttrs, Fragment.fromArray(scoped)));
  if (suffix.length > 0) {
    replacement.push(
      scope.listNode.type.create(
        scope.listNode.attrs,
        Fragment.fromArray(suffix),
      ),
    );
  }

  tr.replaceWith(
    scope.listPos,
    scope.listPos + scope.listNode.nodeSize,
    Fragment.fromArray(replacement),
  );
}

/**
 * Apply a list-toolbar conversion to the current selection, scoped to the
 * innermost list the selection is actually in. This is the single entry
 * point the toolbar (desktop App.tsx and the android MobileApp.tsx toolbar)
 * should call for Bullet List / Ordered List / Task List clicks.
 *
 * - If the selection is already in `target`'s format, toggles it OFF by
 *   lifting the item(s) out of the list (unchanged pre-existing semantics).
 * - Else if the selection is in some OTHER list format, converts ONLY the
 *   scoped item(s): an in-place `checked` flip for a task target (no lift,
 *   no rewrap), or a scoped container retype for a bullet/ordered target.
 * - Else (not in any list) wraps the selection in a brand-new list, one
 *   list_item per selected block, matching the pre-existing multi-line
 *   behavior.
 */
export function applyListConversion(
  view: EditorView,
  target: ListConversionTarget,
): void {
  const { state, dispatch } = view;
  const { $from, $to } = state.selection;
  const current = innermostListFormat($from);

  if (current === target) {
    const listItemType = state.schema.nodes["list_item"];
    if (listItemType) liftListItem(listItemType)(state, dispatch);
    return;
  }

  const scope = current != null ? findListScope($from, $to) : null;
  if (scope) {
    const tr = state.tr;
    if (target === "taskList") {
      if (flipCheckedInScope(tr, scope)) dispatch(tr);
      return;
    }
    const targetType =
      state.schema.nodes[
        target === "orderedList" ? "ordered_list" : "bullet_list"
      ];
    if (!targetType) return;
    retypeListScope(
      tr,
      scope,
      targetType,
      target === "orderedList" ? { order: 1 } : null,
    );
    dispatch(tr);
    return;
  }

  // Not currently in any list: fresh wrap. `wrapInList` iterates the
  // selected blocks and produces one list_item per block (unlike
  // ProseMirror's generic `wrapIn`, which would put the whole selection in a
  // single item) — this is what makes a multi-line selection become one
  // bullet per line.
  const listType =
    state.schema.nodes[
      target === "orderedList" ? "ordered_list" : "bullet_list"
    ];
  if (!listType) return;
  const wrapped = wrapInList(listType)(state, dispatch);
  if (!wrapped || target !== "taskList") return;

  // After the wrap, fetch the new state and scope to the just-created list
  // (there is no pre-existing ancestor list here, so this is equivalent to
  // marking every new item — but staying scoped keeps this path correct even
  // if it is ever reached with an enclosing list in the future). A
  // microtask lets `dispatch` above commit so `view.state` reflects the new
  // doc.
  queueMicrotask(() => {
    const s = view.state;
    const { from, to } = s.selection;
    // NOTE: deliberately NOT using findListScope/ResolvedPos depth here. A
    // Ctrl+A / "select all" selection is an AllSelection, whose $from/$to
    // always resolve at depth 0 (it represents "the whole doc", not a text
    // position) — so depth-based scoping can't see the list this just
    // created. That's fine in THIS branch specifically: there was no
    // pre-existing list before the wrap, so there is no ancestor to
    // accidentally include — a plain range scan over the whole selection is
    // exactly as safe as the scoped approach, just simpler.
    const tr = s.tr;
    let changed = false;
    s.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type.name === "list_item" && node.attrs["checked"] == null) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
        changed = true;
      }
    });
    if (changed) view.dispatch(tr);
  });
}
