import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';

const collapsibleKey = new PluginKey('collapsible-list');

/**
 * Track collapsed state by a content-based fingerprint rather than
 * document position (which shifts on every edit).
 */
const collapsedFingerprints = new Set<string>();

function fingerprint(node: Node, pos: number, doc: Node): string {
  // Use the text content of the first child (paragraph) + approximate depth
  const firstChild = node.childCount > 0 ? node.child(0) : null;
  const text = firstChild ? firstChild.textContent.slice(0, 50) : '';
  // Include depth to disambiguate same-text items at different levels
  let depth = 0;
  doc.nodesBetween(0, pos, (_n, _p, parent) => {
    if (parent && (parent.type.name === 'bullet_list' || parent.type.name === 'ordered_list')) {
      depth++;
    }
  });
  return `${depth}:${text}`;
}

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
      // Use mousedown on the DOM to reliably catch clicks on the toggle widget
      mousedown(view, event) {
        const target = event.target as HTMLElement;
        // Check target or its parent (click might land on the SVG/polyline inside)
        const toggle = target.closest('.collapse-toggle') as HTMLElement | null;
        if (!toggle) return false;

        event.preventDefault();
        event.stopPropagation();

        const fp = toggle.dataset['fp'];
        if (!fp) return false;

        if (collapsedFingerprints.has(fp)) {
          collapsedFingerprints.delete(fp);
        } else {
          collapsedFingerprints.add(fp);
        }

        // Trigger redecoration
        view.dispatch(view.state.tr.setMeta(collapsibleKey, true));
        return true;
      },
    },
  },
}));

function buildDecorations(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'list_item') return;
    if (!hasNestedList(node)) return;

    const fp = fingerprint(node, pos, doc);
    const isCollapsed = collapsedFingerprints.has(fp);

    // Widget decoration for the toggle button — inserted before the list item content
    decorations.push(
      Decoration.widget(pos + 1, () => {
        const toggle = document.createElement('span');
        toggle.className = `collapse-toggle${isCollapsed ? ' collapse-toggle--collapsed' : ''}`;
        toggle.dataset['fp'] = fp;
        toggle.contentEditable = 'false';
        toggle.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6,4 10,8 6,12"/></svg>`;
        return toggle;
      }, { side: -1 })
    );

    // Node decoration to add the CSS class for collapsing
    decorations.push(
      Decoration.node(pos, pos + node.nodeSize, {
        class: isCollapsed ? 'list-item--collapsed' : 'list-item--collapsible',
      })
    );
  });

  return DecorationSet.create(doc, decorations);
}
