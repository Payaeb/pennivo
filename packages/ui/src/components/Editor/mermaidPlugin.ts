import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { Decoration, DecorationSet } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';
import mermaid from 'mermaid';

function isDarkMode(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    // Use 'neutral' for unfilled/outline-style boxes
    theme: 'neutral',
    securityLevel: 'loose',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    themeVariables: isDarkMode()
      ? {
          primaryColor: 'transparent',
          primaryBorderColor: '#7a7872',
          primaryTextColor: '#E8E6E1',
          secondaryColor: 'transparent',
          secondaryBorderColor: '#5A5852',
          secondaryTextColor: '#E8E6E1',
          tertiaryColor: 'transparent',
          tertiaryBorderColor: '#5A5852',
          tertiaryTextColor: '#E8E6E1',
          lineColor: '#7a7872',
          textColor: '#E8E6E1',
          mainBkg: 'transparent',
          nodeBorder: '#7a7872',
          clusterBkg: 'rgba(255,255,255,0.05)',
          titleColor: '#E8E6E1',
          edgeLabelBackground: '#1C1C1C',
          nodeTextColor: '#E8E6E1',
          // Gantt-specific
          sectionBkgColor: 'rgba(255,255,255,0.04)',
          altSectionBkgColor: 'rgba(255,255,255,0.08)',
          gridColor: '#3a3a3a',
          taskTextColor: '#E8E6E1',
          taskTextDarkColor: '#E8E6E1',
          taskTextOutsideColor: '#E8E6E1',
          taskBorderColor: '#7a7872',
          taskBkgColor: 'rgba(94, 158, 116, 0.3)',
          activeTaskBorderColor: '#5E9E74',
          activeTaskBkgColor: 'rgba(94, 158, 116, 0.5)',
          doneTaskBorderColor: '#5A5852',
          doneTaskBkgColor: 'rgba(90, 88, 82, 0.3)',
          critBorderColor: '#D49872',
          critBkgColor: 'rgba(212, 152, 114, 0.3)',
          todayLineColor: '#5E9E74',
          // Sequence diagram
          actorTextColor: '#E8E6E1',
          actorBorder: '#7a7872',
          actorBkg: 'transparent',
          signalColor: '#E8E6E1',
          labelTextColor: '#E8E6E1',
          noteBkgColor: 'rgba(255,255,255,0.06)',
          noteTextColor: '#E8E6E1',
          noteBorderColor: '#5A5852',
        }
      : {
          primaryColor: 'transparent',
          primaryBorderColor: '#8A8880',
          primaryTextColor: '#1A1A18',
          secondaryColor: 'transparent',
          secondaryBorderColor: '#AEACA6',
          secondaryTextColor: '#1A1A18',
          tertiaryColor: 'transparent',
          tertiaryBorderColor: '#AEACA6',
          tertiaryTextColor: '#1A1A18',
          lineColor: '#8A8880',
          textColor: '#1A1A18',
          mainBkg: 'transparent',
          nodeBorder: '#8A8880',
          clusterBkg: 'rgba(0,0,0,0.03)',
          titleColor: '#1A1A18',
          edgeLabelBackground: '#FAFAF8',
          nodeTextColor: '#1A1A18',
          // Gantt-specific
          sectionBkgColor: 'rgba(0,0,0,0.02)',
          altSectionBkgColor: 'rgba(0,0,0,0.05)',
          gridColor: '#ddd',
          taskTextColor: '#1A1A18',
          taskTextDarkColor: '#1A1A18',
          taskTextOutsideColor: '#1A1A18',
          taskBorderColor: '#8A8880',
          taskBkgColor: 'rgba(74, 124, 89, 0.2)',
          activeTaskBorderColor: '#4A7C59',
          activeTaskBkgColor: 'rgba(74, 124, 89, 0.35)',
          doneTaskBorderColor: '#AEACA6',
          doneTaskBkgColor: 'rgba(174, 172, 166, 0.2)',
          critBorderColor: '#B06040',
          critBkgColor: 'rgba(176, 96, 64, 0.2)',
          todayLineColor: '#4A7C59',
          // Sequence diagram
          actorTextColor: '#1A1A18',
          actorBorder: '#8A8880',
          actorBkg: 'transparent',
          signalColor: '#1A1A18',
          labelTextColor: '#1A1A18',
          noteBkgColor: 'rgba(0,0,0,0.03)',
          noteTextColor: '#1A1A18',
          noteBorderColor: '#AEACA6',
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
    const { svg } = await mermaid.render(id, code);
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
          if (view.state.doc.eq(prevState.doc)) return;
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            // Clear cache when theme might have changed
            svgCache.clear();
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
