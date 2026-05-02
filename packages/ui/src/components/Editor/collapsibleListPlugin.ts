import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { Node, ResolvedPos } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import type { EditorState } from "@milkdown/prose/state";

const collapsibleKey = new PluginKey("collapsible-list");

/**
 * Track collapsed state by ordinal index among all collapsible list items.
 * This is stable when editing text within items, and naturally adjusts
 * when items are added or removed.
 */
const collapsedIndices = new Set<number>();

function hasNestedList(node: Node): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (
      child.type.name === "bullet_list" ||
      child.type.name === "ordered_list"
    ) {
      return true;
    }
  }
  return false;
}

export const collapsibleListPlugin = $prose(
  () =>
    new Plugin({
      key: collapsibleKey,

      state: {
        init(_, state) {
          return buildDecorations(state.doc);
        },
        apply(tr, oldDeco) {
          if (tr.docChanged || tr.getMeta(collapsibleKey)) {
            return buildDecorations(tr.doc);
          }
          return oldDeco.map(tr.mapping, tr.doc);
        },
      },

      props: {
        decorations(state) {
          return collapsibleKey.getState(state);
        },

        handleKeyDown(view, event) {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          ) {
            return false;
          }
          return handleEnterOnCollapsedItem(view);
        },

        handleDOMEvents: {
          mousedown(view, event) {
            const target = event.target as HTMLElement;
            const toggle = target.closest(
              ".collapse-toggle",
            ) as HTMLElement | null;
            if (!toggle) return false;

            event.preventDefault();
            event.stopPropagation();

            const idx = Number(toggle.dataset["idx"]);
            if (isNaN(idx)) return false;

            if (collapsedIndices.has(idx)) {
              collapsedIndices.delete(idx);
            } else {
              collapsedIndices.add(idx);
            }

            // Find the list_item this toggle belongs to and place the cursor
            // at the end of its first paragraph. Without this, clicking the
            // chevron (especially on the last bullet) can leave the cursor
            // outside any paragraph — so the next Enter falls through our
            // handler and just refocuses instead of creating a sibling.
            const cursorPos = findEndOfFirstParagraph(view.state, idx);
            const tr = view.state.tr.setMeta(collapsibleKey, true);
            if (cursorPos !== -1) {
              tr.setSelection(TextSelection.create(tr.doc, cursorPos));
            }
            view.dispatch(tr);
            view.focus();
            return true;
          },
        },
      },
    }),
);

/**
 * When the user presses Enter inside a list_item that is currently collapsed,
 * the default `splitListItem` reparents the (CSS-hidden but still tree-present)
 * children under the new sibling — visually the children "jump" to the new
 * bullet. This handler detects that case and instead inserts a new sibling
 * list_item AFTER the collapsed parent's full nodeSize so the children stay
 * attached to the original parent. Any text after the cursor moves to the
 * new sibling.
 */
function handleEnterOnCollapsedItem(view: EditorView): boolean {
  const state = view.state;
  const { $from, empty } = state.selection;
  if (!empty) return false; // let default handle ranged selections

  const listItemDepth = findListItemDepth($from);
  if (listItemDepth === -1) return false;

  const listItemNode = $from.node(listItemDepth);
  if (!hasNestedList(listItemNode)) return false;

  const listItemPos = $from.before(listItemDepth);
  const idx = collapsibleIndexOf(state, listItemPos);
  if (idx === -1 || !collapsedIndices.has(idx)) return false;

  const { schema } = state;
  const listItemType = schema.nodes["list_item"];
  const paragraphType = schema.nodes["paragraph"];
  if (!listItemType || !paragraphType) return false;

  // Slice content of current paragraph from cursor to end — moves to new sibling.
  const paragraph = $from.parent;
  const tail = paragraph.content.cut($from.parentOffset);

  let tr = state.tr;
  if (tail.size > 0) {
    tr = tr.delete($from.pos, $from.pos + tail.size);
  }

  const afterParent = $from.after(listItemDepth);
  const mappedAfterParent = tr.mapping.map(afterParent);
  const newListItem = listItemType.create(
    null,
    paragraphType.create(null, tail),
  );
  tr = tr.insert(mappedAfterParent, newListItem);

  // Cursor inside new paragraph: list_item open (+1) + paragraph open (+1).
  const newCursor = mappedAfterParent + 2;
  tr = tr.setSelection(TextSelection.create(tr.doc, newCursor));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function findEndOfFirstParagraph(
  state: EditorState,
  collapsibleIdx: number,
): number {
  let counter = 0;
  let result = -1;
  state.doc.descendants((node, pos) => {
    if (result !== -1) return false;
    if (node.type.name !== "list_item") return true;
    if (!hasNestedList(node)) return true;
    if (counter === collapsibleIdx) {
      // First child of list_item is typically a paragraph; jump cursor to its end.
      const firstChild = node.maybeChild(0);
      if (firstChild && firstChild.type.name === "paragraph") {
        // pos points to before the list_item; +1 enters list_item; +1 enters
        // paragraph; + content size lands at end of paragraph text.
        result = pos + 2 + firstChild.content.size;
      } else {
        result = pos + 1;
      }
      return false;
    }
    counter++;
    return true;
  });
  return result;
}

function findListItemDepth($pos: ResolvedPos): number {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "list_item") return d;
  }
  return -1;
}

function collapsibleIndexOf(state: EditorState, listItemPos: number): number {
  let counter = 0;
  let found = -1;
  state.doc.descendants((node, pos) => {
    if (found !== -1) return false;
    if (node.type.name !== "list_item") return true;
    if (!hasNestedList(node)) return true;
    if (pos === listItemPos) {
      found = counter;
      return false;
    }
    counter++;
    return true;
  });
  return found;
}

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  let collapsibleIndex = 0;

  doc.descendants((node, pos) => {
    if (node.type.name !== "list_item") return;
    if (!hasNestedList(node)) return;

    const idx = collapsibleIndex++;
    const isCollapsed = collapsedIndices.has(idx);

    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const toggle = document.createElement("span");
          toggle.className = `collapse-toggle${isCollapsed ? " collapse-toggle--collapsed" : ""}`;
          toggle.dataset["idx"] = String(idx);
          toggle.contentEditable = "false";
          toggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`;
          return toggle;
        },
        { side: -1 },
      ),
    );

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: isCollapsed ? "list-item--collapsed" : "list-item--collapsible",
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}
