import { useRef } from 'react';
import { Milkdown, useEditor } from '@milkdown/react';
import { Editor as MilkdownEditorCore, defaultValueCtx, rootCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { history } from '@milkdown/plugin-history';
import { $prose } from '@milkdown/utils';
import { Plugin } from '@milkdown/prose/state';
import { InputRule, inputRules } from '@milkdown/prose/inputrules';
import type { EditorView } from '@milkdown/prose/view';
import './Editor.css';

export const DEFAULT_CONTENT = `# On Writing

Every writer I know has a ritual. Some need silence, others need the hum of a café. **What they all share is the need for a tool that disappears** — something that gets out of the way and lets the words come.

Most writing software has forgotten this. It offers dashboards, integrations, templates. It wants you to manage your writing rather than *do* your writing.

> "The best tool is the one you forget you're using."

## What a writing tool should be

Plain text, rendered beautifully. Saved reliably. Nothing more. The file format should be \`.md\` — readable anywhere, owned by no one, lasting forever.

- Use the toolbar above to format text
- Press \`Ctrl+B\` for bold, \`Ctrl+I\` for italic
- Type \`## \` at the start of a line for a heading
`;

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')           // Remove images (alt text is not content)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // Links → keep link text, drop URL
    .replace(/\*{1,2}|_{1,2}|~~/g, '')         // Remove formatting markers
    .replace(/^\s*[-*+>]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .replace(/^\s*-\s*\[[ x]\]\s*/gm, '')     // Remove task list markers
    .replace(/\|/g, '')                         // Remove table pipes
    .replace(/-{3,}/g, '')                      // Remove horizontal rules / table separators
    .trim();
}

function countWords(markdown: string): number {
  const text = stripMarkdown(markdown);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function countCharacters(markdown: string): number {
  const text = stripMarkdown(markdown);
  // Count non-whitespace characters for a meaningful character count
  return text.replace(/\s/g, '').length;
}

interface EditorProps {
  initialContent?: string;
  onWordCountChange?: (count: number) => void;
  onCharCountChange?: (count: number) => void;
  onMarkdownChange?: (markdown: string) => void;
  onViewUpdate?: (view: EditorView) => void;
  onImagePaste?: (file: File) => Promise<string | null>;
}

export function Editor({ initialContent = DEFAULT_CONTENT, onWordCountChange, onCharCountChange, onMarkdownChange, onViewUpdate, onImagePaste }: EditorProps) {
  // Ref so the paste plugin always sees the latest callback without re-creating the editor
  const onImagePasteRef = useRef(onImagePaste);
  onImagePasteRef.current = onImagePaste;

  useEditor((root) => {
    // ProseMirror plugin that fires on every state update — most reliable timing
    const toolbarSync = $prose(() => new Plugin({
      view: () => ({
        update: (view) => {
          onViewUpdate?.(view);
        },
      }),
    }));

    // Extract an image File from a DataTransfer (clipboard or drag), if any
    function getImageFile(dt: DataTransfer | null): File | null {
      if (!dt) return null;
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) return file;
        }
      }
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        if (file.type.startsWith('image/')) return file;
      }
      return null;
    }

    // Save an image file via the callback and insert it into the editor.
    // If dropPos is provided (external drop), insert at that position.
    function handleImageFile(file: File, view: EditorView, dropPos?: number) {
      const handler = onImagePasteRef.current;
      if (!handler) return;

      handler(file).then((src) => {
        if (!src) return;
        const { schema } = view.state;
        const imageNode = schema.nodes['image'].create({ src, alt: '' });
        if (dropPos != null) {
          view.dispatch(view.state.tr.insert(dropPos, imageNode));
        } else {
          view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
        }
      });
    }

    // Auto-convert typed URLs into links when followed by a space
    const autolinkPlugin = $prose(() => {
      const urlRegex = /(?:https?:\/\/)[^\s<]+[^\s<.,;:!?"')}\]]/;
      return inputRules({
        rules: [
          new InputRule(
            new RegExp(`(^|\\s)(${urlRegex.source})\\s$`),
            (state, match, start, end) => {
              const linkMark = state.schema.marks['link'];
              if (!linkMark) return null;

              const prefix = match[1] || '';
              const url = match[2]!;
              const linkStart = start + prefix.length;
              const linkEnd = linkStart + url.length;

              const mark = linkMark.create({ href: url });
              return state.tr
                .addMark(linkStart, linkEnd, mark)
                .insertText(' ', end - 1, end);
            },
          ),
        ],
      });
    });

    // Click on task list checkboxes to toggle checked state
    const taskListClick = $prose(() => new Plugin({
      props: {
        handleClick: (view, pos, event) => {
          const { state } = view;
          const $pos = state.doc.resolve(pos);

          // Walk up to find the list_item with a checked attribute
          for (let d = $pos.depth; d >= 0; d--) {
            const node = $pos.node(d);
            if (node.type.name === 'list_item' && node.attrs['checked'] != null) {
              // Check if the click was on the checkbox area (left side of the li)
              const domNode = view.nodeDOM(view.state.doc.resolve($pos.before(d)).pos) as HTMLElement | null;
              if (!domNode) break;

              const rect = domNode.getBoundingClientRect();
              // Checkbox is rendered via CSS ::before at the left edge
              const clickInCheckboxArea = event.clientX < rect.left + 28;
              if (!clickInCheckboxArea) break;

              const nodePos = $pos.before(d);
              view.dispatch(
                state.tr.setNodeMarkup(nodePos, undefined, {
                  ...node.attrs,
                  checked: !node.attrs['checked'],
                }),
              );
              return true;
            }
          }
          return false;
        },
      },
    }));

    // Ctrl+Click to follow links, hover to show URL preview
    const linkClick = $prose(() => new Plugin({
      props: {
        handleClick: (view, pos, event) => {
          if (!(event.ctrlKey || event.metaKey)) return false;
          const { doc } = view.state;
          const $pos = doc.resolve(pos);
          const marks = $pos.marks();
          const linkMark = marks.find(m => m.type.name === 'link');
          if (!linkMark) return false;
          const href = linkMark.attrs['href'] as string;
          if (href) {
            window.pennivo?.openExternal(href);
          }
          return true;
        },
        handleDOMEvents: {
          mousemove: (view, event) => {
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            const editorEl = view.dom.closest('.editor-wrapper');
            if (!pos || !editorEl) return false;

            // Remove existing preview
            const existing = editorEl.querySelector('.link-url-preview');

            const $pos = view.state.doc.resolve(pos.pos);
            const linkMark = $pos.marks().find(m => m.type.name === 'link');
            if (!linkMark) {
              existing?.remove();
              return false;
            }

            const href = linkMark.attrs['href'] as string;
            if (!href) { existing?.remove(); return false; }

            if (existing) {
              existing.textContent = `${href}  —  Ctrl+Click to open`;
              return false;
            }

            const preview = document.createElement('div');
            preview.className = 'link-url-preview';
            preview.textContent = `${href}  —  Ctrl+Click to open`;
            editorEl.appendChild(preview);
            return false;
          },
          mouseleave: (view) => {
            const editorEl = view.dom.closest('.editor-wrapper');
            editorEl?.querySelector('.link-url-preview')?.remove();
            return false;
          },
        },
      },
    }));

    // Intercept clipboard paste and drag-drop for images
    const imagePaste = $prose(() => new Plugin({
      props: {
        handlePaste: (view, event) => {
          const file = getImageFile(event.clipboardData);
          if (!file) return false;
          event.preventDefault();
          handleImageFile(file, view);
          return true;
        },
        handleDrop: (view, event) => {
          // Internal drag (e.g. moving an image within the editor) —
          // let ProseMirror handle the move natively so the original is deleted.
          if (view.dragging) return false;

          const file = getImageFile(event.dataTransfer);
          if (!file) return false;
          event.preventDefault();
          // Resolve drop position from mouse coordinates
          const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY });
          handleImageFile(file, view, dropCoords?.pos);
          return true;
        },
      },
    }));

    return MilkdownEditorCore.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
      })
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(history)
      .use(toolbarSync)
      .use(autolinkPlugin)
      .use(taskListClick)
      .use(linkClick)
      .use(imagePaste)
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onWordCountChange?.(countWords(markdown));
          onCharCountChange?.(countCharacters(markdown));
          onMarkdownChange?.(markdown);
        });
      });
  });

  return (
    <div className="editor-wrapper">
      <Milkdown />
    </div>
  );
}
