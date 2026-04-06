import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';

const collapsibleKey = new PluginKey('collapsible-list');

/** Set of node positions (start of list_item) that are currently collapsed */
const collapsedItems = new Set<number>();

/**
 * Check if a list_item node has a nested list (sub-items).
 */
function hasNestedList(node: import('@milkdown/prose/model').Node): boolean {
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

    handleClick(view, _pos, event) {
      // Check if user clicked the collapse toggle
      const target = event.target as HTMLElement;
      if (!target.classList.contains('collapse-toggle')) return false;

      // Find the list_item position from the data attribute
      const itemPos = Number(target.dataset['pos']);
      if (isNaN(itemPos)) return false;

      if (collapsedItems.has(itemPos)) {
        collapsedItems.delete(itemPos);
      } else {
        collapsedItems.add(itemPos);
      }

      // Trigger redecoration
      view.dispatch(view.state.tr.setMeta(collapsibleKey, true));
      return true;
    },
  },
}));

function buildDecorations(doc: import('@milkdown/prose/model').Node): DecorationSet {
  const decorations: Decoration[] = [];

  // Clean up collapsed positions that no longer exist
  const validPositions = new Set<number>();

  doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return;

    if (hasNestedList(node)) {
      validPositions.add(pos);

      const isCollapsed = collapsedItems.has(pos);

      // Add a widget decoration for the toggle button
      decorations.push(
        Decoration.widget(pos + 1, () => {
          const toggle = document.createElement('span');
          toggle.className = `collapse-toggle${isCollapsed ? ' collapse-toggle--collapsed' : ''}`;
          toggle.dataset['pos'] = String(pos);
          toggle.contentEditable = 'false';
          // Chevron SVG
          toggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`;
          return toggle;
        }, { side: -1 })
      );

      // If collapsed, hide nested lists with a node decoration
      if (isCollapsed) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'list-item--collapsed',
          })
        );
      } else {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'list-item--collapsible',
          })
        );
      }
    }
  });

  // Clean stale positions
  for (const p of collapsedItems) {
    if (!validPositions.has(p)) {
      collapsedItems.delete(p);
    }
  }

  return DecorationSet.create(doc, decorations);
}
