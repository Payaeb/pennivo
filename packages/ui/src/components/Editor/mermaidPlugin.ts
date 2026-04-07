import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';
import mermaid from 'mermaid';

function isDarkMode(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function initMermaid() {
  const dark = isDarkMode();
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    securityLevel: 'loose',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    themeVariables: {
      // Background
      primaryColor: 'transparent',
      primaryBorderColor: dark ? '#7a7872' : '#8A8880',
      primaryTextColor: dark ? '#E8E6E1' : '#1A1A18',
      secondaryColor: 'transparent',
      secondaryBorderColor: dark ? '#5A5852' : '#AEACA6',
      secondaryTextColor: dark ? '#E8E6E1' : '#1A1A18',
      tertiaryColor: 'transparent',
      tertiaryBorderColor: dark ? '#5A5852' : '#AEACA6',
      tertiaryTextColor: dark ? '#E8E6E1' : '#1A1A18',
      lineColor: dark ? '#7a7872' : '#8A8880',
      textColor: dark ? '#E8E6E1' : '#1A1A18',
      mainBkg: 'transparent',
      nodeBorder: dark ? '#7a7872' : '#8A8880',
      clusterBkg: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
      titleColor: dark ? '#E8E6E1' : '#1A1A18',
      edgeLabelBackground: dark ? '#1C1C1C' : '#FAFAF8',
      nodeTextColor: dark ? '#E8E6E1' : '#1A1A18',

      // Gantt
      sectionBkgColor: dark ? '#1a1a1a' : 'transparent',
      altSectionBkgColor: dark ? '#222222' : 'rgba(0,0,0,0.03)',
      excludeBkgColor: dark ? '#2a2a2a' : 'rgba(0,0,0,0.05)',
      gridColor: dark ? '#333333' : '#e0e0e0',
      taskTextColor: dark ? '#E8E6E1' : '#1A1A18',
      taskTextDarkColor: dark ? '#E8E6E1' : '#1A1A18',
      taskTextOutsideColor: dark ? '#E8E6E1' : '#1A1A18',
      taskBorderColor: dark ? '#7a7872' : '#8A8880',
      taskBkgColor: dark ? 'rgba(94,158,116,0.25)' : 'rgba(74,124,89,0.2)',
      activeTaskBorderColor: dark ? '#5E9E74' : '#4A7C59',
      activeTaskBkgColor: dark ? 'rgba(94,158,116,0.3)' : 'rgba(74,124,89,0.25)',
      doneTaskBorderColor: dark ? '#5A5852' : '#AEACA6',
      doneTaskBkgColor: dark ? 'rgba(90,88,82,0.2)' : 'rgba(174,172,166,0.15)',
      critBorderColor: dark ? '#D49872' : '#B06040',
      critBkgColor: dark ? 'rgba(212,152,114,0.3)' : 'rgba(176,96,64,0.2)',
      todayLineColor: dark ? '#5E9E74' : '#4A7C59',

      // Sequence
      actorTextColor: dark ? '#E8E6E1' : '#1A1A18',
      actorBorder: dark ? '#7a7872' : '#8A8880',
      actorBkg: 'transparent',
      signalColor: dark ? '#E8E6E1' : '#1A1A18',
      labelTextColor: dark ? '#E8E6E1' : '#1A1A18',
      noteBkgColor: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
      noteTextColor: dark ? '#E8E6E1' : '#1A1A18',
      noteBorderColor: dark ? '#5A5852' : '#AEACA6',
    },
  });
}

const mermaidKey = new PluginKey('mermaid-preview');

const svgCache = new Map<string, string>();
let renderCounter = 0;

async function renderMermaidSvg(code: string): Promise<{ svg: string; error?: string }> {
  if (!code.trim()) return { svg: '' };

  const dark = isDarkMode();
  const cacheKey = `${dark}:${code}`;
  const cached = svgCache.get(cacheKey);
  if (cached) return { svg: cached };

  initMermaid();

  const id = `mermaid-${++renderCounter}`;
  try {
    let { svg } = await mermaid.render(id, code);
    // Strip inline fill from text/tspan so CSS var(--text-primary) controls all text color.
    // Remove fill from style="..." attributes AND standalone fill="..." attributes.
    svg = svg.replace(/<(text|tspan)\b[^>]*>/g, (match) => {
      // Remove fill:... from style attribute
      let cleaned = match.replace(/(\bstyle="[^"]*?)fill:\s*[^";]+;?\s*/g, '$1');
      // Remove standalone fill="..." attribute
      cleaned = cleaned.replace(/\bfill="[^"]*"/g, '');
      return cleaned;
    });
    svgCache.set(cacheKey, svg);
    return { svg };
  } catch (err) {
    document.getElementById('d' + id)?.remove();
    const msg = err instanceof Error ? err.message : 'Could not render diagram';
    return { svg: '', error: msg };
  }
}

export const mermaidPlugin = $prose(() => {
  const previewElements = new Map<number, HTMLElement>();
  const renderedContent = new Map<number, string>();

  function createPreviewWidget(pos: number, code: string): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-preview-widget';
    wrapper.contentEditable = 'false';

    const isGantt = code.trim().startsWith('gantt');

    if (!code.trim()) {
      wrapper.innerHTML = '<span class="mermaid-preview-hint">Enter mermaid syntax below...</span>';
    } else {
      wrapper.innerHTML = '<span class="mermaid-preview-loading">Rendering...</span>';
      renderMermaidSvg(code).then(({ svg, error }) => {
        if (svg) {
          wrapper.innerHTML = svg;
        } else {
          const errorEl = document.createElement('span');
          errorEl.className = 'mermaid-preview-error';
          errorEl.textContent = error || 'Could not render diagram';
          errorEl.title = error || '';
          wrapper.innerHTML = '';
          wrapper.appendChild(errorEl);
        }

        // For gantt diagrams, add "Edit Chart" button and dispatch auto-open event
        if (isGantt) {
          wrapper.style.position = 'relative';

          const editBtn = document.createElement('button');
          editBtn.className = 'mermaid-gantt-edit-btn';
          editBtn.textContent = 'Edit Chart';
          editBtn.contentEditable = 'false';
          editBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const rect = wrapper.getBoundingClientRect();
            document.dispatchEvent(new CustomEvent('gantt-edit-request', {
              detail: { pos, code, rect: { top: rect.bottom, left: rect.left, width: rect.width } },
            }));
          });
          wrapper.appendChild(editBtn);
        }
      });
    }

    previewElements.set(pos, wrapper);
    renderedContent.set(pos, code);
    return wrapper;
  }

  function buildDecorations(doc: Node): DecorationSet {
    const decorations: Decoration[] = [];

    // Clear all cached elements — fresh render every time
    previewElements.clear();
    renderedContent.clear();

    doc.descendants((node, pos) => {
      if (node.type.name !== 'code_block') return;
      if (node.attrs['language'] !== 'mermaid') return;

      const code = node.textContent;
      const isGantt = code.trim().startsWith('gantt');

      decorations.push(
        Decoration.widget(pos, () => {
          return createPreviewWidget(pos, code);
        }, { side: -1 })
      );

      // Hide the raw code block for gantt charts — the table editor replaces it
      if (isGantt) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: 'mermaid-gantt-hidden-code',
          })
        );
      }
    });

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
        // Only rebuild decorations on explicit meta trigger (from debounce)
        if (tr.getMeta(mermaidKey)) {
          return buildDecorations(tr.doc);
        }
        // For normal doc changes, just remap positions
        if (tr.docChanged) {
          return oldDeco.map(tr.mapping, tr.doc);
        }
        return oldDeco;
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
          if (view.state.doc.eq(prevState.doc)) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            svgCache.clear();
            previewElements.clear();
            renderedContent.clear();
            view.dispatch(view.state.tr.setMeta(mermaidKey, true));
          }, 500);
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
