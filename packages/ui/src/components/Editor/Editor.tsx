import { useRef } from 'react';
import { Milkdown, useEditor } from '@milkdown/react';
import { Editor as MilkdownEditorCore, defaultValueCtx, rootCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { history } from '@milkdown/plugin-history';
import { $prose } from '@milkdown/utils';
import { Plugin } from '@milkdown/prose/state';
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

function countWords(markdown: string): number {
  const text = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}|_{1,2}|~~|\[|\]|\(|\)/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/^\s*[-*+>]\s/gm, '')
    .replace(/^\s*\d+\.\s/gm, '')
    .trim();
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

interface EditorProps {
  initialContent?: string;
  onWordCountChange?: (count: number) => void;
  onMarkdownChange?: (markdown: string) => void;
  onViewUpdate?: (view: EditorView) => void;
  onImagePaste?: (file: File) => Promise<string | null>;
}

export function Editor({ initialContent = DEFAULT_CONTENT, onWordCountChange, onMarkdownChange, onViewUpdate, onImagePaste }: EditorProps) {
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

    // Save an image file via the callback and insert it into the editor
    function handleImageFile(file: File, view: EditorView) {
      const handler = onImagePasteRef.current;
      if (!handler) return;

      handler(file).then((src) => {
        if (!src) return;
        // Insert image node directly via ProseMirror transaction
        const { schema } = view.state;
        const imageNode = schema.nodes['image'].create({ src, alt: '' });
        view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
      });
    }

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
          const file = getImageFile(event.dataTransfer);
          if (!file) return false;
          event.preventDefault();
          handleImageFile(file, view);
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
      .use(imagePaste)
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onWordCountChange?.(countWords(markdown));
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
