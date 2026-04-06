import { $prose } from '@milkdown/utils';
import { Plugin, Selection } from '@milkdown/prose/state';
import type { EditorView, NodeView } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';
import mermaid from 'mermaid';

// Initialize mermaid with Pennivo-friendly settings
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

// Update mermaid theme based on current app theme
function getMermaidTheme(): 'dark' | 'default' {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
}

let renderCounter = 0;

class MermaidNodeView implements NodeView {
  dom: HTMLElement;
  private previewEl: HTMLElement;
  private codeEl: HTMLElement;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(node: Node, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement('div');
    this.dom.className = 'mermaid-wrapper';
    this.dom.contentEditable = 'false';

    // Preview container
    this.previewEl = document.createElement('div');
    this.previewEl.className = 'mermaid-preview';
    this.dom.appendChild(this.previewEl);

    // Editable code area (hidden by default, shown on click)
    this.codeEl = document.createElement('div');
    this.codeEl.className = 'mermaid-code';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = node.textContent;
    pre.appendChild(code);
    this.codeEl.appendChild(pre);
    this.dom.appendChild(this.codeEl);

    // Label
    const label = document.createElement('span');
    label.className = 'mermaid-label';
    label.textContent = 'mermaid';
    this.dom.appendChild(label);

    // Toggle code visibility on click
    this.dom.addEventListener('click', (e) => {
      // Prevent editor from stealing focus
      e.stopPropagation();
      this.codeEl.classList.toggle('mermaid-code--visible');
    });

    // Double-click to select the node and start editing in source mode
    this.dom.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const pos = this.getPos();
      if (pos != null) {
        this.view.dispatch(
          this.view.state.tr.setSelection(
            Selection.near(this.view.state.doc.resolve(pos))
          )
        );
        this.view.focus();
      }
    });

    this.renderDiagram(node.textContent);
  }

  private async renderDiagram(code: string) {
    ensureMermaidInit();

    // Re-initialize with current theme
    mermaid.initialize({
      startOnLoad: false,
      theme: getMermaidTheme(),
      securityLevel: 'loose',
      fontFamily: 'var(--font-ui)',
    });

    const id = `mermaid-${++renderCounter}`;
    try {
      const { svg } = await mermaid.render(id, code);
      this.previewEl.innerHTML = svg;
      this.previewEl.classList.remove('mermaid-preview--error');
    } catch {
      this.previewEl.textContent = 'Invalid mermaid syntax';
      this.previewEl.classList.add('mermaid-preview--error');
      // Clean up orphaned render element mermaid might have created
      document.getElementById('d' + id)?.remove();
    }
  }

  update(node: Node): boolean {
    if (node.type.name !== 'code_block') return false;
    if (node.attrs['language'] !== 'mermaid') return false;

    // Update code display
    const codeEl = this.codeEl.querySelector('code');
    if (codeEl) codeEl.textContent = node.textContent;

    // Debounced re-render
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => {
      this.renderDiagram(node.textContent);
    }, 500);

    return true;
  }

  // Prevent ProseMirror from managing the node's content
  ignoreMutation() { return true; }
  stopEvent() { return true; }

  destroy() {
    if (this.renderTimer) clearTimeout(this.renderTimer);
  }
}

export const mermaidPlugin = $prose(() => new Plugin({
  props: {
    nodeViews: {
      code_block: (node, view, getPos) => {
        if (node.attrs['language'] === 'mermaid') {
          return new MermaidNodeView(node, view, getPos);
        }
        // Return undefined to use default rendering for non-mermaid code blocks
        return undefined as unknown as NodeView;
      },
    },
  },
}));
