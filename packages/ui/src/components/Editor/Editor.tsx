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
}

export function Editor({ initialContent = DEFAULT_CONTENT, onWordCountChange, onMarkdownChange, onViewUpdate }: EditorProps) {
  useEditor((root) => {
    // ProseMirror plugin that fires on every state update — most reliable timing
    const toolbarSync = $prose(() => new Plugin({
      view: () => ({
        update: (view) => {
          onViewUpdate?.(view);
        },
      }),
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
