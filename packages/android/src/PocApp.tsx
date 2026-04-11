import {
  useState,
  useCallback,
  useRef,
  useEffect,
  lazy,
  Suspense,
} from "react";
import { MilkdownProvider } from "@milkdown/react";
import { Editor } from "@pennivo/ui";
import { useTheme } from "@pennivo/ui";

const LazySourceEditor = lazy(() =>
  import("../../ui/src/components/SourceEditor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);

const WELCOME_CONTENT = `# Pennivo Android PoC

This is a **proof-of-concept** to test the Milkdown editor on Android.

## Things to test

### WYSIWYG mode
1. **Basic typing** — Does text appear correctly? Any lag?
2. **Swipe typing** — Try GBoard swipe input
3. **Autocomplete** — Accept word suggestions from keyboard
4. Tap a **checkbox** below
5. **Scroll** through this document

### Source mode (tap the Source button)
6. Type \`**bold**\` — does it stay as raw markdown?
7. Type \`# Heading\` — does it stay as raw text?
8. Edit markdown syntax directly
9. Switch back to WYSIWYG — do changes appear?

### Checkboxes (tap to toggle)

- [ ] Unchecked task — tap me
- [ ] Another unchecked task
- [x] Already completed task
- [ ] One more to try

### Lists

- Bullet list item
- Another item
  - Nested item

1. Numbered list
2. Second item

### Code

Inline \`code\` and a code block:

\`\`\`javascript
function hello() {
  console.log("Hello from Pennivo!");
}
\`\`\`

### Table

| Feature | Status |
|---------|--------|
| Typing  | Test   |
| IME     | Test   |
| Source  | Test   |

### Blockquote

> This is a blockquote.
> Does it render correctly?

---

Try editing everything above. The goal is to find any input bugs before building the full Android app.
`;

export function PocApp() {
  const { mode, toggleTheme } = useTheme();
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const markdownRef = useRef(WELCOME_CONTENT);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Prevent focus-induced scroll jumps: when ProseMirror focuses the editor
  // for the first time (e.g. checkbox tap), the browser scrolls the scroll
  // container to bring the focused element into view. We intercept this by
  // saving scrollTop before any focus event and restoring it immediately.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let savedTop = 0;
    const onFocusIn = () => {
      // Restore the scroll position that was saved just before focus
      requestAnimationFrame(() => {
        if (Math.abs(el.scrollTop - savedTop) > 50) {
          el.scrollTop = savedTop;
        }
      });
    };
    const onPointerDown = () => {
      // Save scroll position right before any interaction that might cause focus
      savedTop = el.scrollTop;
    };
    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("focusin", onFocusIn);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  const handleCharCountChange = useCallback((count: number) => {
    setCharCount(count);
  }, []);

  const handleMarkdownChange = useCallback((markdown: string) => {
    markdownRef.current = markdown;
  }, []);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      if (prev) {
        // Returning from source mode -> WYSIWYG: remount with updated content
        setEditorKey((k) => k + 1);
      }
      return !prev;
    });
    // Scroll to top on mode switch -- CodeMirror and ProseMirror use different
    // scroll containers, so preserving exact position isn't feasible.
    // The real app can use cursor position to approximate this.
    scrollRef.current?.scrollTo(0, 0);
  }, []);

  return (
    <div className="poc-app">
      <header className="poc-header">
        <span className="poc-title">Pennivo PoC</span>
        <div className="poc-header-right">
          <span className="poc-stats">
            {wordCount}w / {charCount}c
          </span>
          <button
            className={`poc-mode-btn ${sourceMode ? "poc-mode-btn--active" : ""}`}
            onClick={toggleSourceMode}
          >
            {sourceMode ? "WYSIWYG" : "Source"}
          </button>
          <button className="poc-theme-btn" onClick={toggleTheme}>
            {mode === "dark" ? "\u2600" : "\u263D"}
          </button>
        </div>
      </header>
      <main className="poc-editor-area" ref={scrollRef}>
        {!sourceMode && (
          <MilkdownProvider key={editorKey}>
            <Editor
              initialContent={markdownRef.current}
              onWordCountChange={handleWordCountChange}
              onCharCountChange={handleCharCountChange}
              onMarkdownChange={handleMarkdownChange}
            />
          </MilkdownProvider>
        )}
        {sourceMode && (
          <Suspense
            fallback={
              <div className="poc-loading">Loading source editor...</div>
            }
          >
            <LazySourceEditor
              content={markdownRef.current}
              active={sourceMode}
              onMarkdownChange={handleMarkdownChange}
              onWordCountChange={handleWordCountChange}
              onCharCountChange={handleCharCountChange}
            />
          </Suspense>
        )}
      </main>
    </div>
  );
}
