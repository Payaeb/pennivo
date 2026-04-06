import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';
import mermaid from 'mermaid';

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'loose',
    fontFamily: 'var(--font-ui)',
  });
}

function getMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
}

const mermaidKey = new PluginKey('mermaid-preview');

/** Cache rendered SVGs to avoid re-rendering identical content */
const svgCache = new Map<string, string>();
let renderCounter = 0;

async function renderMermaidSvg(code: string): Promise<string> {
  if (!code.trim()) return '';

  const cacheKey = `${getMermaidTheme()}:${code}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return cached;

  ensureMermaidInit();
  mermaid.initialize({
    startOnLoad: false,
    theme: getMermaidTheme(),
    securityLevel: 'loose',
    fontFamily: 'var(--font-ui)',
  });

  const id = `mermaid-${++renderCounter}`;
  try {
    const { svg } = await mermaid.render(id, code);
    svgCache.set(cacheKey, svg);
    return svg;
  } catch {
    document.getElementById('d' + id)?.remove();
    return '';
  }
}

/**
 * Decoration-based mermaid plugin.
 * Adds a preview widget ABOVE each mermaid code block.
 * The code block itself stays fully editable.
 */
export const mermaidPlugin = $prose(() => {
  /** Map from code block position to the preview DOM element */
  const previewElements = new Map<number, HTMLElement>();
  /** Track which code content we last rendered for each pos */
  const renderedContent = new Map<number, string>();

  function createPreviewWidget(pos: number, code: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-preview-widget';
    wrapper.contentEditable = 'false';

    if (!code.trim()) {
      wrapper.innerHTML = '<span class="mermaid-preview-hint">Enter mermaid syntax below...</span>';
    } else {
      wrapper.innerHTML = '<span class="mermaid-preview-loading">Rendering...</span>';
      // Async render
      renderMermaidSvg(code).then(svg => {
        if (svg) {
          wrapper.innerHTML = svg;
        } else {
          wrapper.innerHTML = '<span class="mermaid-preview-error">Could not render diagram</span>';
        }
      });
    }

    previewElements.set(pos, wrapper);
    renderedContent.set(pos, code);
    return wrapper;
  }

  function buildDecorations(doc: Node): DecorationSet {
    const decorations: Decoration[] = [];
    const usedPositions = new Set<number>();

    doc.descendants((node, pos) => {
      if (node.type.name !== 'code_block') return;
      if (node.attrs['language'] !== 'mermaid') return;

      usedPositions.add(pos);
      const code = node.textContent;

      // Check if we need to re-render (content changed)
      const existingContent = renderedContent.get(pos);
      if (existingContent !== code) {
        previewElements.delete(pos);
        renderedContent.delete(pos);
      }

      decorations.push(
        Decoration.widget(pos, () => {
          const existing = previewElements.get(pos);
          if (existing) return existing;
          return createPreviewWidget(pos, code);
        }, { side: -1, key: `mermaid-${pos}` })
      );
    });

    // Clean up stale entries
    for (const p of previewElements.keys()) {
      if (!usedPositions.has(p)) {
        previewElements.delete(p);
        renderedContent.delete(p);
      }
    }

    return DecorationSet.create(doc, decorations);
  }

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  return new Plugin({
    key: mermaidKey,

    state: {
      init(_, state) {
        return buildDecorations(state.doc);
      },
      apply(tr, oldDeco) {
        if (tr.docChanged || tr.getMeta(mermaidKey)) {
          return buildDecorations(tr.doc);
        }
        return oldDeco.map(tr.mapping, tr.doc);
      },
    },

    props: {
      decorations(state) {
        return mermaidKey.getState(state);
      },
    },

    view() {
      return {
        update(view, prevState) {
          // Debounced re-render when content changes
          if (view.state.doc.eq(prevState.doc)) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            view.dispatch(view.state.tr.setMeta(mermaidKey, true));
          }, 800);
        },
        destroy() {
          if (debounceTimer) clearTimeout(debounceTimer);
          previewElements.clear();
          renderedContent.clear();
        },
      };
    },
  });
});
