import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';

const collapsibleKey = new PluginKey('collapsible-list');

/**
 * Track collapsed state by ordinal index among all collapsible list items.
 * This is stable when editing text within items, and naturally adjusts
 * when items are added or removed.
 */
const collapsedIndices = new Set<number>();

function hasNestedList(node: Node): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type.name === 'bullet_list' || child.type.name === 'ordered_list') {
      return true;
    }
  }
  return false;
}

export const collapsibleListPlugin = $prose(() => new Plugin({
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

    handleDOMEvents: {
      mousedown(view, event) {
        const target = event.target as HTMLElement;
        const toggle = target.closest('.collapse-toggle') as HTMLElement | null;
        if (!toggle) return false;

        event.preventDefault();
        event.stopPropagation();

        const idx = Number(toggle.dataset['idx']);
        if (isNaN(idx)) return false;

        if (collapsedIndices.has(idx)) {
          collapsedIndices.delete(idx);
        } else {
          collapsedIndices.add(idx);
        }

        view.dispatch(view.state.tr.setMeta(collapsibleKey, true));
        return true;
      },
    },
  },
}));

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  let collapsibleIndex = 0;

  doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return;
    if (!hasNestedList(node)) return;

    const idx = collapsibleIndex++;
    const isCollapsed = collapsedIndices.has(idx);

    decorations.push(
      Decoration.widget(pos + 1, () => {
        const toggle = document.createElement('span');
        toggle.className = `collapse-toggle${isCollapsed ? ' collapse-toggle--collapsed' : ''}`;
        toggle.dataset['idx'] = String(idx);
        toggle.contentEditable = 'false';
        toggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`;
        return toggle;
      }, { side: -1 })
    );

    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: isCollapsed ? 'list-item--collapsed' : 'list-item--collapsible',
      })
    );
  });

  return DecorationSet.create(doc, decorations);
}
