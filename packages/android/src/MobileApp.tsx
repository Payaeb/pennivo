import {
  useState,
  useCallback,
  useRef,
  useEffect,
  lazy,
  Suspense,
} from "react";
import { MilkdownProvider, useInstance } from "@milkdown/react";
import { editorViewCtx } from "@milkdown/core";
import { callCommand } from "@milkdown/utils";
import {
  toggleStrongCommand,
  toggleEmphasisCommand,
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  toggleInlineCodeCommand,
  turnIntoTextCommand,
  liftListItemCommand,
} from "@milkdown/preset-commonmark";
import {
  toggleStrikethroughCommand,
  insertTableCommand,
} from "@milkdown/preset-gfm";
import { lift } from "@milkdown/prose/commands";
import { Editor, useTheme, getPlatform } from "@pennivo/ui";
import { MobileToolbar } from "./components/MobileToolbar/MobileToolbar";

const LazySourceEditor = lazy(() =>
  import("../../ui/src/components/SourceEditor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);

type SaveStatus = "saved" | "saving" | "unsaved";

const WELCOME_CONTENT = `# Welcome to Pennivo

A clean, focused markdown editor.

Start writing, or open a file from your device. Your work is **auto-saved** as you type.

## Quick tips

- Tap the **Source** button to edit raw markdown
- Tap the theme icon to switch light/dark mode
- Your changes save automatically after a few seconds

---

Happy writing.
`;

const AUTO_SAVE_DELAY = 3000;
const DEFAULT_FILENAME = "welcome.md";

/* ------------------------------------------------------------------ */
/*  Inner component — lives inside MilkdownProvider, uses useInstance  */
/* ------------------------------------------------------------------ */

interface MobileEditorContentProps {
  sourceMode: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  markdownRef: React.MutableRefObject<string>;
  onMarkdownChange: (markdown: string) => void;
  onWordCountChange: (count: number) => void;
  onCharCountChange: (count: number) => void;
}

function getActiveFormats(view: import("@milkdown/prose/view").EditorView): Set<string> {
  const active = new Set<string>();
  const state = view.state;
  const { from, to, empty } = state.selection;
  const { doc } = state;

  // Check marks (bold, italic, strikethrough)
  if (empty) {
    const marks = state.storedMarks ?? state.selection.$from.marks();
    for (const mark of marks) {
      if (mark.type.name === "strong") active.add("bold");
      if (mark.type.name === "emphasis") active.add("italic");
      if (mark.type.name === "strike_through") active.add("strikethrough");
    }
  } else {
    const schema = state.schema;
    if (schema.marks["strong"] && doc.rangeHasMark(from, to, schema.marks["strong"])) active.add("bold");
    if (schema.marks["emphasis"] && doc.rangeHasMark(from, to, schema.marks["emphasis"])) active.add("italic");
    if (schema.marks["strike_through"] && doc.rangeHasMark(from, to, schema.marks["strike_through"])) active.add("strikethrough");
  }

  // Check block-level formats
  const { $from } = state.selection;
  const parent = $from.parent;
  if (parent.type.name === "heading") {
    if (parent.attrs["level"] === 1) active.add("h1");
    if (parent.attrs["level"] === 2) active.add("h2");
  }
  if (parent.type.name === "code_block") active.add("code");

  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bullet_list") {
      const listItem = d + 1 <= $from.depth ? $from.node(d + 1) : null;
      if (listItem && listItem.attrs["checked"] != null) {
        active.add("taskList");
      } else {
        active.add("bulletList");
      }
      break;
    }
    if (node.type.name === "ordered_list") { active.add("orderedList"); break; }
    if (node.type.name === "blockquote") { active.add("blockquote"); break; }
  }

  return active;
}

function MobileEditorContent({
  sourceMode,
  scrollRef,
  markdownRef,
  onMarkdownChange,
  onWordCountChange,
  onCharCountChange,
}: MobileEditorContentProps) {
  const [, getInstance] = useInstance();
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Track active formats on selection/content changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (sourceMode) return;
      const editor = getInstance();
      if (!editor) return;
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const formats = getActiveFormats(view);
          setActiveFormats((prev) => {
            // Only update if changed to avoid re-renders
            if (prev.size !== formats.size) return formats;
            for (const f of formats) if (!prev.has(f)) return formats;
            return prev;
          });
        });
      } catch {
        // Editor not ready
      }
    }, 200);
    return () => clearInterval(interval);
  }, [sourceMode, getInstance]);

  const handleToolbarAction = useCallback(
    (action: string) => {
      if (sourceMode) return;
      const editor = getInstance();
      if (!editor) return;

      switch (action) {
        case "bold":
          editor.action(callCommand(toggleStrongCommand.key));
          break;
        case "italic":
          editor.action(callCommand(toggleEmphasisCommand.key));
          break;
        case "strikethrough":
          editor.action(callCommand(toggleStrikethroughCommand.key));
          break;
        case "h1":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const parent = view.state.selection.$from.parent;
            const isH1 =
              parent.type.name === "heading" && parent.attrs["level"] === 1;
            if (isH1) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 1)(ctx);
          });
          break;
        case "h2":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const parent = view.state.selection.$from.parent;
            const isH2 =
              parent.type.name === "heading" && parent.attrs["level"] === 2;
            if (isH2) callCommand(turnIntoTextCommand.key)(ctx);
            else callCommand(wrapInHeadingCommand.key, 2)(ctx);
          });
          break;
        case "bulletList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { $from } = view.state.selection;
            let inBullet = false;
            let inOtherList = false;
            for (let d = $from.depth; d >= 0; d--) {
              const n = $from.node(d);
              if (n.type.name === "bullet_list") {
                const li = d + 1 <= $from.depth ? $from.node(d + 1) : null;
                if (li && li.attrs["checked"] != null) {
                  inOtherList = true;
                } else {
                  inBullet = true;
                }
                break;
              }
              if (n.type.name === "ordered_list") {
                inOtherList = true;
                break;
              }
            }
            if (inBullet) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (inOtherList) callCommand(liftListItemCommand.key)(ctx);
              callCommand(wrapInBulletListCommand.key)(ctx);
            }
          });
          break;
        case "orderedList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { $from } = view.state.selection;
            let inOrdered = false;
            let inOtherList = false;
            for (let d = $from.depth; d >= 0; d--) {
              const n = $from.node(d);
              if (n.type.name === "ordered_list") {
                inOrdered = true;
                break;
              }
              if (n.type.name === "bullet_list") {
                inOtherList = true;
                break;
              }
            }
            if (inOrdered) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (inOtherList) callCommand(liftListItemCommand.key)(ctx);
              callCommand(wrapInOrderedListCommand.key)(ctx);
            }
          });
          break;
        case "taskList":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { $from } = view.state.selection;
            let inTask = false;
            let inOtherList = false;
            for (let d = $from.depth; d >= 0; d--) {
              const n = $from.node(d);
              if (n.type.name === "bullet_list") {
                const li = d + 1 <= $from.depth ? $from.node(d + 1) : null;
                if (li && li.attrs["checked"] != null) {
                  inTask = true;
                } else {
                  inOtherList = true;
                }
                break;
              }
              if (n.type.name === "ordered_list") {
                inOtherList = true;
                break;
              }
            }
            if (inTask) {
              callCommand(liftListItemCommand.key)(ctx);
            } else {
              if (inOtherList) callCommand(liftListItemCommand.key)(ctx);
              callCommand(wrapInBulletListCommand.key)(ctx);
              queueMicrotask(() => {
                const { state, dispatch } = view;
                const { $from: f } = state.selection;
                for (let d = f.depth; d >= 0; d--) {
                  const node = f.node(d);
                  if (node.type.name === "list_item") {
                    const pos = f.before(d);
                    dispatch(
                      state.tr.setNodeMarkup(pos, undefined, {
                        ...node.attrs,
                        checked: false,
                      }),
                    );
                    break;
                  }
                }
              });
            }
          });
          break;
        case "blockquote":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { $from } = view.state.selection;
            let inBq = false;
            for (let d = $from.depth; d >= 0; d--) {
              if ($from.node(d).type.name === "blockquote") {
                inBq = true;
                break;
              }
            }
            if (inBq) lift(view.state, view.dispatch);
            else callCommand(wrapInBlockquoteCommand.key)(ctx);
          });
          break;
        case "code":
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const inCodeBlock =
              view.state.selection.$from.parent.type.name === "code_block";
            if (inCodeBlock) {
              callCommand(turnIntoTextCommand.key)(ctx);
            } else if (view.state.selection.empty) {
              callCommand(createCodeBlockCommand.key)(ctx);
            } else {
              callCommand(toggleInlineCodeCommand.key)(ctx);
            }
          });
          break;
        case "table":
          editor.action(
            callCommand(insertTableCommand.key, { row: 3, col: 3 }),
          );
          break;
      }
    },
    [sourceMode, getInstance],
  );

  return (
    <>
      <main className="mobile-editor-area" ref={scrollRef}>
        {!sourceMode && (
          <Editor
            initialContent={markdownRef.current}
            onWordCountChange={onWordCountChange}
            onCharCountChange={onCharCountChange}
            onMarkdownChange={onMarkdownChange}
          />
        )}
        {sourceMode && (
          <Suspense
            fallback={
              <div className="mobile-loading">Loading source editor...</div>
            }
          >
            <LazySourceEditor
              content={markdownRef.current}
              active={sourceMode}
              onMarkdownChange={onMarkdownChange}
              onWordCountChange={onWordCountChange}
              onCharCountChange={onCharCountChange}
            />
          </Suspense>
        )}
      </main>
      <MobileToolbar
        onAction={handleToolbarAction}
        activeFormats={activeFormats}
        visible={!sourceMode}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Outer component — state management, auto-save, platform calls     */
/* ------------------------------------------------------------------ */

export function MobileApp() {
  const { mode, toggleTheme } = useTheme();
  const platform = getPlatform();

  const [wordCount, setWordCount] = useState(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [fileName, setFileName] = useState("untitled.md");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [initialContent, setInitialContent] = useState<string | null>(null);

  const markdownRef = useRef("");
  const filePathRef = useRef(DEFAULT_FILENAME);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

  // Load last-opened file or show welcome doc
  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function loadInitial() {
      try {
        const recentFiles = await platform.getRecentFiles();
        if (cancelled) return;

        if (recentFiles.length > 0) {
          const lastFile = recentFiles[0]!;
          const result = await platform.openFilePath(lastFile);
          if (cancelled) return;

          if (result) {
            markdownRef.current = result.content;
            filePathRef.current = result.filePath;
            const name = result.filePath.split("/").pop() || "untitled.md";
            setFileName(name);
            setInitialContent(result.content);
            setWordCount(result.content.trim().split(/\s+/).filter(Boolean).length);
            setSaveStatus("saved");
            return;
          }
        }
      } catch (err) {
        console.error("[Pennivo] Failed to load recent file:", err);
      }

      if (cancelled) return;

      // First run or no recent files -- show welcome
      markdownRef.current = WELCOME_CONTENT;
      filePathRef.current = DEFAULT_FILENAME;
      setFileName(DEFAULT_FILENAME);
      setInitialContent(WELCOME_CONTENT);
      setWordCount(WELCOME_CONTENT.trim().split(/\s+/).filter(Boolean).length);
      setSaveStatus("saved");
    }

    loadInitial();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [platform]);

  // Prevent focus-induced scroll jumps
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let savedTop = 0;
    const onFocusIn = () => {
      requestAnimationFrame(() => {
        if (Math.abs(el.scrollTop - savedTop) > 50) {
          el.scrollTop = savedTop;
        }
      });
    };
    const onPointerDown = () => {
      savedTop = el.scrollTop;
    };
    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("focusin", onFocusIn);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const performSave = useCallback(async () => {
    if (!mountedRef.current) return;
    setSaveStatus("saving");
    try {
      const success = await platform.saveFile(
        filePathRef.current,
        markdownRef.current,
      );
      if (!mountedRef.current) return;
      if (success) {
        setSaveStatus("saved");
        await platform.addRecentFile(filePathRef.current);
      } else {
        setSaveStatus("unsaved");
      }
    } catch (err) {
      console.error("[Pennivo] Auto-save failed:", err);
      if (mountedRef.current) {
        setSaveStatus("unsaved");
      }
    }
  }, [platform]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    setSaveStatus("unsaved");
    saveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DELAY);
  }, [performSave]);

  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  const handleCharCountChange = useCallback((_count: number) => {
    // Not displayed on mobile — header shows word count only
  }, []);

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      markdownRef.current = markdown;
      scheduleSave();
    },
    [scheduleSave],
  );

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      if (prev) {
        // Returning from source mode -> WYSIWYG: remount with updated content
        setEditorKey((k) => k + 1);
      }
      return !prev;
    });
    scrollRef.current?.scrollTo(0, 0);
  }, []);

  // Don't render until initial content is loaded
  if (initialContent === null) {
    return (
      <div className="mobile-app">
        <div className="mobile-loading">Loading...</div>
      </div>
    );
  }

  return (
    <div className="mobile-app">
      <header className="mobile-header">
        <div className="mobile-header-left">
          <span className="mobile-filename">{fileName}</span>
          <span
            className={`save-dot save-dot--${saveStatus}`}
            title={saveStatus}
            aria-label={`Save status: ${saveStatus}`}
          />
          <span className="mobile-stat">{wordCount}w</span>
        </div>
        <div className="mobile-header-right">
          <button
            className={`mobile-mode-btn ${sourceMode ? "mobile-mode-btn--active" : ""}`}
            onClick={toggleSourceMode}
            aria-label={
              sourceMode ? "Switch to WYSIWYG mode" : "Switch to source mode"
            }
          >
            {sourceMode ? "WYSIWYG" : "Source"}
          </button>
          <button
            className="mobile-theme-btn"
            onClick={toggleTheme}
            aria-label={
              mode === "dark"
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            {mode === "dark" ? "\u2600" : "\u263D"}
          </button>
        </div>
      </header>

      <MilkdownProvider key={editorKey}>
        <MobileEditorContent
          sourceMode={sourceMode}
          scrollRef={scrollRef}
          markdownRef={markdownRef}
          onMarkdownChange={handleMarkdownChange}
          onWordCountChange={handleWordCountChange}
          onCharCountChange={handleCharCountChange}
        />
      </MilkdownProvider>

    </div>
  );
}
