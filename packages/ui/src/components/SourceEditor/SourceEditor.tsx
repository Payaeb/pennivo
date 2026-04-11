import { useRef, useEffect, useLayoutEffect } from "react";
import { EditorView, keymap } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  bracketMatching,
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import { cmFindExtension } from "../FindReplace/cmFindReplace";
import { countWords, countCharacters } from "../../utils/textStats";
import "./SourceEditor.css";

interface SourceEditorProps {
  content: string;
  active?: boolean;
  typewriterMode?: boolean;
  onMarkdownChange?: (markdown: string) => void;
  onWordCountChange?: (count: number) => void;
  onCharCountChange?: (count: number) => void;
  onViewReady?: (view: EditorView) => void;
  onViewDestroy?: () => void;
}

// Keymap that prevents CodeMirror from swallowing app-level shortcuts
const passthroughKeymap = keymap.of([
  { key: "Mod-s", run: () => false },
  { key: "Mod-o", run: () => false },
  { key: "Mod-n", run: () => false },
  { key: "Mod-b", run: () => false },
  { key: "Mod-Shift-f", run: () => false },
  { key: "Mod-k", run: () => false },
  { key: "Mod-f", run: () => false }, // Let Pennivo's FindReplace handle Ctrl+F
  { key: "Mod-Shift-p", run: () => false }, // Let Pennivo's CommandPalette handle Ctrl+Shift+P
  { key: "Mod-Shift-o", run: () => false }, // Let Pennivo's Outline handle Ctrl+Shift+O
]);

// Pennivo theme that reads from CSS custom properties
const pennivoTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "14.5px",
    lineHeight: "1.7",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    padding: "0",
    fontFamily: "var(--font-mono)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "var(--selection-bg) !important",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-gutters": {
    display: "none",
  },
  // Markdown syntax colors
  ".cm-header": { color: "var(--text-primary)", fontWeight: "700" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-emphasis": { fontStyle: "italic" },
  ".cm-strikethrough": {
    textDecoration: "line-through",
    color: "var(--text-muted)",
  },
  ".cm-url": { color: "var(--accent)" },
  ".cm-link": { color: "var(--accent)", textDecoration: "underline" },
  ".cm-meta": { color: "var(--sh-meta)" },
  ".cm-comment": { color: "var(--sh-comment)" },
  ".cm-monospace": { fontFamily: "var(--font-mono)" },
  ".cm-quote": { color: "var(--text-muted)", fontStyle: "italic" },
});

export function SourceEditor({
  content,
  active = false,
  typewriterMode = false,
  onMarkdownChange,
  onWordCountChange,
  onCharCountChange,
  onViewReady,
  onViewDestroy,
}: SourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onMarkdownChange);
  const onWordCountRef = useRef(onWordCountChange);
  const onCharCountRef = useRef(onCharCountChange);
  const suppressChangeRef = useRef(false);
  const typewriterModeRef = useRef(typewriterMode);
  typewriterModeRef.current = typewriterMode;

  onChangeRef.current = onMarkdownChange;
  onWordCountRef.current = onWordCountChange;
  onCharCountRef.current = onCharCountChange;

  // Create the editor on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !suppressChangeRef.current) {
        const doc = update.state.doc.toString();
        onChangeRef.current?.(doc);
        onWordCountRef.current?.(countWords(doc));
        onCharCountRef.current?.(countCharacters(doc));
      }

      // Typewriter mode: scroll cursor to vertical center
      // Double-rAF ensures we run after CodeMirror's own scroll adjustments
      if (
        typewriterModeRef.current &&
        (update.selectionSet || update.docChanged)
      ) {
        const view = update.view;
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const head = view.state.selection.main.head;
            const coords = view.coordsAtPos(head);
            if (coords) {
              const scroller = view.scrollDOM;
              const scrollerRect = scroller.getBoundingClientRect();
              const cursorRelative =
                coords.top - scrollerRect.top + scroller.scrollTop;
              scroller.scrollTop = cursorRelative - scrollerRect.height / 2;
            }
          }),
        );
      }
    });

    const state = EditorState.create({
      doc: content,
      extensions: [
        passthroughKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        history(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        syntaxHighlighting(defaultHighlightStyle),
        bracketMatching(),
        cmFindExtension(),
        pennivoTheme,
        EditorView.lineWrapping,
        updateListener,
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    onViewReady?.(view);

    // Fire initial counts
    onWordCountRef.current?.(countWords(content));
    onCharCountRef.current?.(countCharacters(content));

    return () => {
      onViewDestroy?.();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync content prop → CodeMirror doc
  // useLayoutEffect so this runs before any useEffect (e.g. FindReplace search)
  const prevContentRef = useRef(content);
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (content === prevContentRef.current) return;
    prevContentRef.current = content;

    const currentDoc = view.state.doc.toString();
    if (currentDoc === content) return;

    suppressChangeRef.current = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
    suppressChangeRef.current = false;

    onWordCountRef.current?.(countWords(content));
    onCharCountRef.current?.(countCharacters(content));
  }, [content]);

  // Focus the editor when it becomes active.
  // Use preventScroll so mode-switch scroll restoration isn't overridden.
  useEffect(() => {
    if (active && viewRef.current) {
      viewRef.current.contentDOM.focus({ preventScroll: true });
    }
  }, [active]);

  return <div className="source-editor-wrapper" ref={containerRef} />;
}
