// Phase 18a — Workflowy-style "zoom into a bullet" (hoist).
//
// Generalizes collapsibleListPlugin.ts's decoration-based hide approach:
// instead of hiding ONE collapsed subtree, this hides EVERYTHING outside a
// single zoomed subtree. The markdown on disk, and the ProseMirror doc
// itself, are NEVER touched — this is purely a view-layer decoration set,
// exactly like the collapse plugin. Word count, autosave, and search all
// keep operating on the full in-memory document.
//
// Critical difference from collapsibleListPlugin's addressing scheme: that
// plugin tracks collapsed state by ORDINAL INDEX (a counter over
// doc.descendants()), which is stable under in-place text edits but shifts
// whenever an item above the target is added/removed — acceptable for a
// single collapse toggle, but a zoom session is expected to survive much
// longer stretches of editing. So the zoom root is tracked as a mapped
// DOCUMENT POSITION, carried through tr.mapping on every transaction (the
// same mechanism collapsibleListPlugin already uses for its own decoration
// set, applied here to a position instead). If the mapped position no
// longer resolves to a list_item (the zoomed item was deleted, e.g. by an
// undo/redo that touched it from outside the zoomed view), zoom exits
// gracefully to the whole document rather than rendering garbage.

import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type {
  Node as ProseMirrorNode,
  ResolvedPos,
} from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";

export interface BulletZoomCrumb {
  /** The list_item's "before" position — directly usable to re-target zoom
   *  via zoomToPosition (e.g. a breadcrumb ancestor click). */
  pos: number;
  /** First-paragraph text content of that list_item, untruncated — callers
   *  (the breadcrumb UI) own truncation/ellipsis for display. */
  text: string;
}

export interface BulletZoomInfo {
  /** Root-first ancestors of the zoomed item, NOT including the item
   *  itself. */
  ancestors: BulletZoomCrumb[];
  /** The zoomed item itself. */
  current: BulletZoomCrumb;
}

interface BulletZoomPluginState {
  /** Mapped position directly before the zoomed list_item, or null when
   *  zoom is inactive. */
  zoomRootPos: number | null;
  decorations: DecorationSet;
}

type ZoomMeta = { type: "zoomTo"; pos: number } | { type: "exit" };

export const bulletZoomKey = new PluginKey<BulletZoomPluginState>(
  "bullet-zoom",
);

const ZOOM_CONTAINER_TYPES = new Set(["bullet_list", "ordered_list"]);

/** First child block that's a paragraph, or null. The "title" / breadcrumb
 *  text source for a list_item. */
function firstParagraph(node: ProseMirrorNode): ProseMirrorNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === "paragraph") return child;
  }
  return null;
}

/**
 * Position directly before the innermost list_item enclosing `$pos`, or
 * null if `$pos` isn't inside any list_item. Used by Ctrl+. (zoom into the
 * item at the cursor) and by the bullet-glyph click handler.
 */
export function findEnclosingListItemPos($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === "list_item") return $pos.before(d);
  }
  return null;
}

/**
 * True when `pos` lies within the subtree rooted at the list_item starting
 * at `zoomRootPos` (inclusive of its own span). Used to decide whether a
 * search jump target is currently visible under zoom.
 */
export function isPosInsideSubtree(
  doc: ProseMirrorNode,
  zoomRootPos: number,
  pos: number,
): boolean {
  const node = doc.nodeAt(zoomRootPos);
  if (!node) return false;
  return pos >= zoomRootPos && pos <= zoomRootPos + node.nodeSize;
}

/**
 * Root-first ancestor chain + the zoom root itself, computed fresh from the
 * current doc + zoomRootPos. Returns null if zoomRootPos doesn't resolve to
 * a list_item — callers should treat that as "exit zoom."
 */
export function computeZoomPath(
  doc: ProseMirrorNode,
  zoomRootPos: number,
): BulletZoomInfo | null {
  const rootNode = doc.nodeAt(zoomRootPos);
  if (!rootNode || rootNode.type.name !== "list_item") return null;

  const $inside = doc.resolve(zoomRootPos + 1);
  const ancestors: BulletZoomCrumb[] = [];
  for (let d = 0; d < $inside.depth; d++) {
    const node = $inside.node(d);
    if (node.type.name !== "list_item") continue;
    const pos = $inside.before(d);
    const para = firstParagraph(node);
    ancestors.push({ pos, text: para ? para.textContent : "" });
  }

  const para = firstParagraph(rootNode);
  return {
    ancestors,
    current: { pos: zoomRootPos, text: para ? para.textContent : "" },
  };
}

/**
 * Hide everything outside the subtree rooted at `zoomRootPos`. Walks
 * top-down from the doc, and for every node that is either the zoom root OR
 * an ancestor-on-the-path to it, recurses instead of hiding — everything
 * else gets ONE decoration covering its whole range (hiding a subtree's
 * root via CSS `display:none` hides all its descendants too, so this stays
 * O(depth) decorations regardless of document size, never O(doc size)).
 *
 * Ancestor containers (bullet_list/ordered_list) on the path get
 * `bullet-zoom-path` so a higher-specificity CSS rule can force them
 * visible even if collapsibleListPlugin separately marked some ancestor
 * `.list-item--collapsed` (that plugin's own CSS hides ALL nested ul/ol
 * under a collapsed item, which would otherwise swallow the zoomed subtree
 * too). Ancestor list_items on the path get `bullet-zoom-path-item` so CSS
 * can suppress their own marker/spacing — their own text isn't shown while
 * zoomed (only the breadcrumb displays it), only the nested list containing
 * the path onward is.
 *
 * Returns null if zoomRootPos doesn't resolve to a list_item.
 */
export function buildHideDecorations(
  doc: ProseMirrorNode,
  zoomRootPos: number,
): DecorationSet | null {
  const rootNode = doc.nodeAt(zoomRootPos);
  if (!rootNode || rootNode.type.name !== "list_item") return null;

  const decorations: Decoration[] = [];

  function visitChildren(parent: ProseMirrorNode, contentPos: number): void {
    parent.forEach((child, offset) => {
      const childPos = contentPos + offset;
      if (childPos === zoomRootPos) return; // the zoom root: fully visible

      const childEnd = childPos + child.nodeSize;
      if (childPos < zoomRootPos && zoomRootPos < childEnd) {
        // Ancestor-on-path: stays in the tree so the path can render, but
        // its own non-path content is pruned by the "else" branch below on
        // the next recursion level; mark it for the CSS rules above.
        const cls = ZOOM_CONTAINER_TYPES.has(child.type.name)
          ? "bullet-zoom-path"
          : child.type.name === "list_item"
            ? "bullet-zoom-path-item"
            : null;
        if (cls) {
          decorations.push(Decoration.node(childPos, childEnd, { class: cls }));
        }
        visitChildren(child, childPos + 1);
        return;
      }

      // Unrelated to the path and not the root: hide the whole subtree.
      decorations.push(
        Decoration.node(childPos, childEnd, { class: "bullet-zoom-hidden" }),
      );
    });
  }

  visitChildren(doc, 0);

  decorations.push(
    Decoration.node(zoomRootPos, zoomRootPos + rootNode.nodeSize, {
      class: "bullet-zoom-root",
    }),
  );
  const title = firstParagraph(rootNode);
  if (title) {
    decorations.push(
      Decoration.node(zoomRootPos + 1, zoomRootPos + 1 + title.nodeSize, {
        class: "bullet-zoom-title",
      }),
    );
  }

  return DecorationSet.create(doc, decorations);
}

/** Dispatch a zoom-to transaction targeting the list_item at `pos`. */
export function zoomToPosition(view: EditorView, pos: number): void {
  view.dispatch(
    view.state.tr.setMeta(bulletZoomKey, { type: "zoomTo", pos } as ZoomMeta),
  );
}

/** Exit zoom fully, if it was active. Returns whether anything changed —
 *  callers (scroll restore) use this to avoid acting on a no-op. */
export function exitBulletZoom(view: EditorView): boolean {
  const st = bulletZoomKey.getState(view.state);
  if (!st || st.zoomRootPos == null) return false;
  view.dispatch(
    view.state.tr.setMeta(bulletZoomKey, { type: "exit" } as ZoomMeta),
  );
  return true;
}

/** Ctrl+. — zoom into the list_item containing the cursor. No-op (and
 *  returns false) if the cursor isn't inside a list_item. */
export function zoomIntoListItemAtCursor(view: EditorView): boolean {
  const pos = findEnclosingListItemPos(view.state.selection.$from);
  if (pos == null) return false;
  zoomToPosition(view, pos);
  return true;
}

/** Ctrl+Shift+. — zoom out one level. Exits fully when already at the top
 *  (the zoom root has no ancestor list_item). No-op if zoom isn't active. */
export function zoomOutOneLevel(view: EditorView): boolean {
  const st = bulletZoomKey.getState(view.state);
  if (!st || st.zoomRootPos == null) return false;
  const info = computeZoomPath(view.state.doc, st.zoomRootPos);
  if (!info || info.ancestors.length === 0) {
    exitBulletZoom(view);
    return true;
  }
  const parent = info.ancestors[info.ancestors.length - 1]!;
  zoomToPosition(view, parent.pos);
  return true;
}

export const bulletZoomPlugin = $prose(
  () =>
    new Plugin<BulletZoomPluginState>({
      key: bulletZoomKey,

      state: {
        init() {
          return { zoomRootPos: null, decorations: DecorationSet.empty };
        },
        apply(tr, prev) {
          const meta = tr.getMeta(bulletZoomKey) as ZoomMeta | undefined;
          if (meta) {
            const zoomRootPos = meta.type === "zoomTo" ? meta.pos : null;
            const decorations =
              zoomRootPos != null
                ? buildHideDecorations(tr.doc, zoomRootPos)
                : null;
            if (zoomRootPos != null && !decorations) {
              return { zoomRootPos: null, decorations: DecorationSet.empty };
            }
            return {
              zoomRootPos,
              decorations: decorations ?? DecorationSet.empty,
            };
          }

          if (!tr.docChanged) return prev;
          if (prev.zoomRootPos == null) return prev;

          const mapped = tr.mapping.map(prev.zoomRootPos, -1);
          const node = tr.doc.nodeAt(mapped);
          if (!node || node.type.name !== "list_item") {
            // The zoomed item was deleted out from under us (e.g. an
            // undo/redo touching it from outside the zoomed view) — exit
            // gracefully rather than render an empty/undefined subtree.
            return { zoomRootPos: null, decorations: DecorationSet.empty };
          }
          return {
            zoomRootPos: mapped,
            decorations: buildHideDecorations(tr.doc, mapped)!,
          };
        },
      },

      props: {
        decorations(state) {
          return bulletZoomKey.getState(state)?.decorations ?? null;
        },

        // Guardrail: Shift+Tab (outdent) must not move the zoom root itself
        // past the zoom boundary — that would move it outside its own
        // zoomed subtree, which is incoherent while zoomed. Descendants
        // within the subtree outdent normally (this only blocks when the
        // selection's innermost list_item IS the zoom root).
        handleKeyDown(view, event) {
          if (
            event.key !== "Tab" ||
            !event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          ) {
            return false;
          }
          const st = bulletZoomKey.getState(view.state);
          if (!st || st.zoomRootPos == null) return false;
          const itemPos = findEnclosingListItemPos(view.state.selection.$from);
          if (itemPos !== st.zoomRootPos) return false;
          event.preventDefault();
          return true;
        },

        // Bullet-glyph click zooms in. Scoped to the marker "gutter" to the
        // left of the list_item's own content box (same coordinate-zone
        // technique as the taskListClick checkbox handler in Editor.tsx),
        // so normal text clicks are untouched. Task-list items are excluded
        // — their checkbox already owns that gutter for toggling checked
        // state (taskListClick is registered earlier in the plugin chain
        // and takes priority there regardless).
        //
        // A gutter click resolves (via the editor's own posAtCoords) to the
        // position directly before the clicked item — which is ALSO,
        // simultaneously, "inside that item's parent list, before its first
        // child." ProseMirror's resolve() attributes a boundary position
        // like that to the SHALLOWER (parent) side, so naively depth-
        // walking $pos.node(d) from doc.resolve(pos) finds an ANCESTOR
        // list_item, not the one actually under the click. Check "is there
        // a list_item starting exactly at pos" first and prefer it — that
        // IS the gutter-click case. Only fall back to walking up enclosing
        // ancestors when pos resolves properly inside text content (a
        // plain click elsewhere, which is unambiguous).
        handleClick(view, pos, event) {
          const { doc } = view.state;
          const atPos = doc.nodeAt(pos);

          let itemPos: number;
          let node: ReturnType<typeof doc.nodeAt>;
          if (atPos && atPos.type.name === "list_item") {
            itemPos = pos;
            node = atPos;
          } else {
            const $pos = doc.resolve(pos);
            let itemDepth = -1;
            for (let d = $pos.depth; d >= 0; d--) {
              if ($pos.node(d).type.name === "list_item") {
                itemDepth = d;
                break;
              }
            }
            if (itemDepth === -1) return false;
            node = $pos.node(itemDepth);
            itemPos = $pos.before(itemDepth);
          }
          if (!node) return false;

          if (node.attrs["checked"] != null) return false;

          const dom = view.nodeDOM(itemPos) as HTMLElement | null;
          if (!dom || !(dom instanceof HTMLElement)) return false;

          const rect = dom.getBoundingClientRect();
          const inGutter =
            event.clientX < rect.left && event.clientX > rect.left - 28;
          if (!inGutter) return false;

          zoomToPosition(view, itemPos);
          return true;
        },
      },
    }),
);
