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
  sinkListItemCommand,
  insertHrCommand,
} from "@milkdown/preset-commonmark";
import {
  toggleStrikethroughCommand,
  insertTableCommand,
  setAlignCommand,
  addRowBeforeCommand,
  addRowAfterCommand,
} from "@milkdown/preset-gfm";
import { lift } from "@milkdown/prose/commands";
import {
  Editor,
  useTheme,
  getPlatform,
  COLOR_SCHEMES,
  LinkActionSheet,
} from "@pennivo/ui";
import type { ColorScheme, ThemeMode } from "@pennivo/ui";
import {
  executeTableAction,
  type TableAction,
} from "../../ui/src/components/Editor/tablePlugin";
import {
  parseMermaidGantt,
  ganttDataToMermaid,
  createDefaultGanttData,
  type GanttData,
  parseKanbanMarkdown,
  kanbanDataToMarkdown,
  createDefaultKanbanData,
  type KanbanData,
} from "@pennivo/core";
import { countCharacters } from "../../ui/src/utils/textStats";
import { MobileToolbar } from "./components/MobileToolbar/MobileToolbar";
import { FileBrowser } from "./components/FileBrowser/FileBrowser";
import { useShareIntent } from "./hooks/useShareIntent";

/* Lazy-loaded components — not needed at startup */
const LazyMobileFindReplace = lazy(() =>
  import("./components/MobileFindReplace/MobileFindReplace").then((m) => ({
    default: m.MobileFindReplace,
  })),
);

/* Lazy wrapper that loads both MobileCommandPalette and MOBILE_COMMANDS
   from the same dynamic import, rendering the palette with commands
   already wired in. */
const LazyMobileCommandPaletteWithCommands = lazy(() =>
  import("./components/MobileCommandPalette/MobileCommandPalette").then(
    (m) => ({
      default: function CommandPaletteWrapper(props: {
        visible: boolean;
        onSelect: (id: string) => void;
        onClose: () => void;
      }) {
        return (
          <m.MobileCommandPalette
            {...props}
            commands={m.MOBILE_COMMANDS}
          />
        );
      },
    }),
  ),
);

const LazyMobileSettings = lazy(() =>
  import("./components/MobileSettings/MobileSettings").then((m) => ({
    default: m.MobileSettings,
  })),
);

const LazyTableToolbar = lazy(() =>
  import("../../ui/src/components/TableToolbar/TableToolbar").then((m) => ({
    default: m.TableToolbar,
  })),
);

const LazySourceEditor = lazy(() =>
  import("../../ui/src/components/SourceEditor/SourceEditor").then((m) => ({
    default: m.SourceEditor,
  })),
);

const LazyGanttEditorPanel = lazy(() =>
  import("../../ui/src/components/GanttEditor/GanttEditorPanel").then((m) => ({
    default: m.GanttEditorPanel,
  })),
);

const LazyKanbanEditorPanel = lazy(() =>
  import("../../ui/src/components/KanbanEditor/KanbanEditorPanel").then(
    (m) => ({
      default: m.KanbanEditorPanel,
    }),
  ),
);

type SaveStatus = "saved" | "saving" | "unsaved";
type Screen = "browser" | "editor" | "settings";

const AUTO_SAVE_DELAY = 3000;
const DEFAULT_FILENAME = "untitled.md";

// Mirror desktop thresholds (packages/ui/src/App.tsx). Android WebView's renderer
// dies around 1.5MB of markdown inside the ProseMirror doc, so we must force
// source mode at that size — on file open AND on paste/bulk content change.
const FILE_SIZE_WARN = 500_000; // 500 KB — warn only
const FILE_SIZE_SOURCE_DEFAULT = 1_000_000; // 1 MB — auto source mode
const FILE_SIZE_SOURCE_LOCKED = 1_500_000; // 1.5 MB — locked to source mode

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
  findReplaceOpen: boolean;
  onFindReplaceClose: () => void;
  onCmViewReady: (view: import("@codemirror/view").EditorView) => void;
  onCmViewDestroy: () => void;
  getCmView: () => import("@codemirror/view").EditorView | null;
  getEditorHtmlRef: React.MutableRefObject<(() => string) | null>;
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
  findReplaceOpen,
  onFindReplaceClose,
  onCmViewReady,
  onCmViewDestroy,
  getCmView,
  getEditorHtmlRef,
}: MobileEditorContentProps) {
  const [, getInstance] = useInstance();
  const [activeFormats, setActiveFormats] = useState<Set<string>>(new Set());

  // Expose getEditorHtml to parent via ref
  useEffect(() => {
    getEditorHtmlRef.current = () => {
      const editor = getInstance();
      if (!editor) return "";
      let html = "";
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        html = view.dom.innerHTML;
      });
      return html;
    };
    return () => {
      getEditorHtmlRef.current = null;
    };
  }, [getInstance, getEditorHtmlRef]);

  // --- Table toolbar state ---
  const [tableToolbarVisible, setTableToolbarVisible] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const { visible } = (e as CustomEvent).detail;
      setTableToolbarVisible(visible);
    };
    document.addEventListener("table-toolbar-update", handler);
    return () => document.removeEventListener("table-toolbar-update", handler);
  }, []);

  const handleTableAction = useCallback(
    (action: TableAction) => {
      const editor = getInstance();
      if (!editor) return;

      switch (action) {
        case "addRowAbove":
          editor.action(callCommand(addRowBeforeCommand.key));
          return;
        case "addRowBelow":
          editor.action(callCommand(addRowAfterCommand.key));
          return;
        case "alignLeft":
          editor.action(callCommand(setAlignCommand.key, "left"));
          return;
        case "alignCenter":
          editor.action(callCommand(setAlignCommand.key, "center"));
          return;
        case "alignRight":
          editor.action(callCommand(setAlignCommand.key, "right"));
          return;
      }

      editor.action((ctx) => {
        executeTableAction(ctx.get(editorViewCtx), action);
      });
    },
    [getInstance],
  );

  // --- Gantt editor state ---
  const [ganttEditor, setGanttEditor] = useState<{
    data: GanttData;
    lastCode: string;
    anchorRect: { top: number; left: number; width: number };
  } | null>(null);

  useEffect(() => {
    const handleGanttEditRequest = (e: Event) => {
      const { code, rect } = (e as CustomEvent).detail;
      const parsed = parseMermaidGantt(code);
      if (parsed) {
        setGanttEditor({ data: parsed, lastCode: code, anchorRect: rect });
      }
    };
    document.addEventListener("gantt-edit-request", handleGanttEditRequest);
    return () =>
      document.removeEventListener(
        "gantt-edit-request",
        handleGanttEditRequest,
      );
  }, []);

  const ganttEditorRef = useRef(ganttEditor);
  ganttEditorRef.current = ganttEditor;

  const handleGanttUpdate = useCallback(
    (data: GanttData) => {
      const ge = ganttEditorRef.current;
      if (!ge) return;
      const newCode = ganttDataToMermaid(data);

      const editor = getInstance();
      if (editor) {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;

          let foundPos = -1;
          let foundNode: import("@milkdown/prose/model").Node | null = null;

          state.doc.descendants((node, pos) => {
            if (foundNode) return false;
            if (
              node.type.name === "code_block" &&
              node.attrs["language"] === "mermaid"
            ) {
              const text = node.textContent;
              if (text === ge.lastCode || text.trim().startsWith("gantt")) {
                foundPos = pos;
                foundNode = node;
                return false;
              }
            }
          });

          if (foundNode && foundPos >= 0) {
            const newBlock = state.schema.nodes["code_block"].create(
              { language: "mermaid" },
              state.schema.text(newCode),
            );
            const tr = state.tr.replaceWith(
              foundPos,
              foundPos +
                (foundNode as import("@milkdown/prose/model").Node).nodeSize,
              newBlock,
            );
            view.dispatch(tr);
          }
        });
      }

      setGanttEditor((prev) =>
        prev ? { ...prev, data, lastCode: newCode } : null,
      );
    },
    [getInstance],
  );

  const handleGanttClose = useCallback(() => {
    setGanttEditor(null);
    const editor = getInstance();
    if (editor) {
      editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
      });
    }
  }, [getInstance]);

  // --- Kanban editor state ---
  const [kanbanEditor, setKanbanEditor] = useState<{
    data: KanbanData;
    lastCode: string;
    anchorRect: { top: number; left: number; width: number };
  } | null>(null);

  useEffect(() => {
    const handleKanbanEditRequest = (e: Event) => {
      const { code, rect } = (e as CustomEvent).detail;
      const parsed = parseKanbanMarkdown(code);
      if (parsed) {
        setKanbanEditor({ data: parsed, lastCode: code, anchorRect: rect });
      }
    };
    document.addEventListener("kanban-edit-request", handleKanbanEditRequest);
    return () =>
      document.removeEventListener(
        "kanban-edit-request",
        handleKanbanEditRequest,
      );
  }, []);

  const kanbanEditorRef = useRef(kanbanEditor);
  kanbanEditorRef.current = kanbanEditor;

  const handleKanbanUpdate = useCallback(
    (data: KanbanData) => {
      const ke = kanbanEditorRef.current;
      if (!ke) return;
      const newCode = kanbanDataToMarkdown(data);

      const editor = getInstance();
      if (editor) {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state } = view;

          let foundPos = -1;
          let foundNode: import("@milkdown/prose/model").Node | null = null;

          state.doc.descendants((node, pos) => {
            if (foundNode) return false;
            if (
              node.type.name === "code_block" &&
              node.attrs["language"] === "kanban"
            ) {
              const text = node.textContent;
              if (text === ke.lastCode || text.trim().startsWith("title:")) {
                foundPos = pos;
                foundNode = node;
                return false;
              }
            }
          });

          if (foundNode && foundPos >= 0) {
            const newBlock = state.schema.nodes["code_block"].create(
              { language: "kanban" },
              state.schema.text(newCode),
            );
            const tr = state.tr.replaceWith(
              foundPos,
              foundPos +
                (foundNode as import("@milkdown/prose/model").Node).nodeSize,
              newBlock,
            );
            view.dispatch(tr);
          }
        });
      }

      setKanbanEditor((prev) =>
        prev ? { ...prev, data, lastCode: newCode } : null,
      );
    },
    [getInstance],
  );

  const handleKanbanClose = useCallback(() => {
    setKanbanEditor(null);
    const editor = getInstance();
    if (editor) {
      editor.action((ctx) => {
        ctx.get(editorViewCtx).focus();
      });
    }
  }, [getInstance]);

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
        case "indent":
          editor.action(callCommand(sinkListItemCommand.key));
          break;
        case "outdent":
          editor.action(callCommand(liftListItemCommand.key));
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
        case "insertCodeBlock":
          editor.action(callCommand(createCodeBlockCommand.key));
          break;
        case "horizontalRule":
          editor.action(callCommand(insertHrCommand.key));
          break;
        case "link": {
          // Mobile prompt-based link insertion (desktop uses a popover).
          const url = window.prompt("Enter URL:");
          if (!url) break;
          let href = url.trim();
          if (href && !/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href)) {
            href = "https://" + href;
          }
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const { from, to, empty } = state.selection;
            const linkMarkType = state.schema.marks["link"];
            if (!linkMarkType) return;
            if (empty) {
              // No selection — insert the URL as the link text
              const linkMark = linkMarkType.create({ href });
              const textNode = state.schema.text(href, [linkMark]);
              view.dispatch(state.tr.replaceSelectionWith(textNode, false));
            } else {
              const linkMark = linkMarkType.create({ href });
              view.dispatch(state.tr.addMark(from, to, linkMark));
            }
            view.focus();
          });
          break;
        }
        case "image": {
          // Try the native image picker first (gallery + camera). If the user
          // cancels or the platform cannot supply an image, fall back to a URL
          // prompt so remote image insertion still works.
          (async () => {
            const insertSrc = (src: string) => {
              editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const imageNodeType = view.state.schema.nodes["image"];
                if (!imageNodeType) return;
                const imageNode = imageNodeType.create({ src, alt: "" });
                view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
                view.focus();
              });
            };
            try {
              const picked = await getPlatform().pickImage("");
              if (picked) {
                // On Capacitor, absolutePath is the data URL of the chosen image.
                insertSrc(picked.absolutePath);
                return;
              }
            } catch (err) {
              console.error("[Pennivo] pickImage failed:", err);
            }
            const src = window.prompt("Enter image URL:");
            if (!src) return;
            insertSrc(src.trim());
          })();
          break;
        }
        case "math": {
          // Insert a math block as a fenced code block with lang="math".
          // (Mermaid/kanban/gantt all use the code_block pattern; math renders via
          // a future KaTeX plugin or shows raw LaTeX until then.)
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const codeBlockType = state.schema.nodes["code_block"];
            if (!codeBlockType) return;
            const codeBlock = codeBlockType.create(
              { language: "math" },
              state.schema.text("E = mc^2"),
            );
            view.dispatch(state.tr.replaceSelectionWith(codeBlock));
            view.focus();
          });
          break;
        }
        case "mermaid": {
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const codeBlockType = state.schema.nodes["code_block"];
            if (!codeBlockType) return;
            const codeBlock = codeBlockType.create(
              { language: "mermaid" },
              state.schema.text("graph TD\n    A[Start] --> B[End]"),
            );
            view.dispatch(state.tr.replaceSelectionWith(codeBlock));
            view.focus();
          });
          break;
        }
        case "kanban": {
          const defaultData = createDefaultKanbanData();
          const code = kanbanDataToMarkdown(defaultData);
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const codeBlockType = state.schema.nodes["code_block"];
            if (!codeBlockType) return;
            const codeBlock = codeBlockType.create(
              { language: "kanban" },
              state.schema.text(code),
            );
            view.dispatch(state.tr.replaceSelectionWith(codeBlock));
            view.focus();
          });
          break;
        }
        case "gantt": {
          const defaultData = createDefaultGanttData();
          const code = ganttDataToMermaid(defaultData);
          editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state } = view;
            const codeBlockType = state.schema.nodes["code_block"];
            if (!codeBlockType) return;
            const codeBlock = codeBlockType.create(
              { language: "mermaid" },
              state.schema.text(code),
            );
            view.dispatch(state.tr.replaceSelectionWith(codeBlock));
            view.focus();
          });
          break;
        }
      }
    },
    [sourceMode, getInstance],
  );

  // Listen for command palette formatting commands
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail as string;
      handleToolbarAction(id);
    };
    window.addEventListener("pennivo:command", handler);
    return () => window.removeEventListener("pennivo:command", handler);
  }, [handleToolbarAction]);

  // --- Mobile link action sheet ---
  // The Editor's linkClick plugin dispatches a `pennivo-mobile-link-tap`
  // CustomEvent when a user taps a link on mobile, carrying { href, from, to }.
  const [linkSheet, setLinkSheet] = useState<{
    href: string;
    from: number;
    to: number;
  } | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        | { href: string; from: number; to: number }
        | undefined;
      if (!detail) return;
      setLinkSheet({ href: detail.href, from: detail.from, to: detail.to });
    };
    window.addEventListener("pennivo-mobile-link-tap", handler);
    return () =>
      window.removeEventListener("pennivo-mobile-link-tap", handler);
  }, []);

  const closeLinkSheet = useCallback(() => setLinkSheet(null), []);

  const handleLinkOpen = useCallback(() => {
    if (!linkSheet) return;
    const url = linkSheet.href;
    closeLinkSheet();
    // Capacitor's WebView hands off window.open to the native browser.
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      getPlatform().openExternal(url);
    }
  }, [linkSheet, closeLinkSheet]);

  const handleLinkCopy = useCallback(async () => {
    if (!linkSheet) return;
    const url = linkSheet.href;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for older WebViews
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
    } catch (err) {
      console.error("[Pennivo] copy link failed:", err);
    }
    closeLinkSheet();
  }, [linkSheet, closeLinkSheet]);

  const handleLinkRemove = useCallback(() => {
    if (!linkSheet) return;
    const { from, to } = linkSheet;
    const editor = getInstance();
    if (!editor) {
      closeLinkSheet();
      return;
    }
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const linkMarkType = state.schema.marks["link"];
      if (!linkMarkType) return;
      view.dispatch(state.tr.removeMark(from, to, linkMarkType));
    });
    closeLinkSheet();
  }, [linkSheet, getInstance, closeLinkSheet]);

  const handleLinkEdit = useCallback(() => {
    if (!linkSheet) return;
    const current = linkSheet.href;
    const { from, to } = linkSheet;
    closeLinkSheet();
    // Simple prompt-based edit — mirrors the mobile "insert link" flow
    // used elsewhere in this file. A full inline edit form can replace this
    // later without changing the Editor plugin.
    const next = window.prompt("Edit link URL:", current);
    if (next == null) return; // cancelled
    let href = next.trim();
    if (!href) return;
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(href)) {
      href = "https://" + href;
    }
    const editor = getInstance();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const linkMarkType = state.schema.marks["link"];
      if (!linkMarkType) return;
      const tr = state.tr
        .removeMark(from, to, linkMarkType)
        .addMark(from, to, linkMarkType.create({ href }));
      view.dispatch(tr);
    });
  }, [linkSheet, getInstance, closeLinkSheet]);

  // Get ProseMirror view for find/replace
  const getEditorView = useCallback((): import("@milkdown/prose/view").EditorView | null => {
    const editor = getInstance();
    if (!editor) return null;
    let view: import("@milkdown/prose/view").EditorView | null = null;
    try {
      editor.action((ctx) => {
        view = ctx.get(editorViewCtx);
      });
    } catch {
      // Editor not ready
    }
    return view;
  }, [getInstance]);

  return (
    <>
      {findReplaceOpen && (
        <Suspense fallback={null}>
          <LazyMobileFindReplace
            visible={findReplaceOpen}
            getView={getEditorView}
            getCmView={getCmView}
            sourceMode={sourceMode}
            onClose={onFindReplaceClose}
          />
        </Suspense>
      )}
      <main className="mobile-editor-area" ref={scrollRef} aria-label="Document editor">
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
              onViewReady={onCmViewReady}
              onViewDestroy={onCmViewDestroy}
            />
          </Suspense>
        )}
      </main>
      <MobileToolbar
        onAction={handleToolbarAction}
        activeFormats={activeFormats}
        visible={!sourceMode}
      />
      {tableToolbarVisible && !sourceMode && (
        <Suspense fallback={null}>
          <LazyTableToolbar onAction={handleTableAction} />
        </Suspense>
      )}
      {ganttEditor && (
        <Suspense fallback={null}>
          <LazyGanttEditorPanel
            data={ganttEditor.data}
            anchorRect={ganttEditor.anchorRect}
            onUpdate={handleGanttUpdate}
            onClose={handleGanttClose}
          />
        </Suspense>
      )}
      {kanbanEditor && (
        <Suspense fallback={null}>
          <LazyKanbanEditorPanel
            data={kanbanEditor.data}
            anchorRect={kanbanEditor.anchorRect}
            onUpdate={handleKanbanUpdate}
            onClose={handleKanbanClose}
          />
        </Suspense>
      )}
      {linkSheet && (
        <LinkActionSheet
          href={linkSheet.href}
          anchorRect={null}
          onOpen={handleLinkOpen}
          onEdit={handleLinkEdit}
          onCopy={handleLinkCopy}
          onRemove={handleLinkRemove}
          onClose={closeLinkSheet}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Outer component — state management, auto-save, platform calls     */
/* ------------------------------------------------------------------ */

export function MobileApp() {
  const { mode, setMode, colorScheme, setColorScheme } = useTheme();
  const platform = getPlatform();

  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [showStats, setShowStats] = useState(true);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceLocked, setSourceLocked] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceModeRef = useRef(false);
  const fileSizeRef = useRef(0);
  const [editorKey, setEditorKey] = useState(0);
  const [fileName, setFileName] = useState("untitled.md");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [screen, setScreen] = useState<Screen>("browser");
  const [editorReady, setEditorReady] = useState(false);
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const [showThemePicker, setShowThemePicker] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  const markdownRef = useRef("");
  const filePathRef = useRef(DEFAULT_FILENAME);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const themeLoadedRef = useRef(false);
  const cmViewRef = useRef<import("@codemirror/view").EditorView | null>(null);
  const previousScreenRef = useRef<"browser" | "editor">("browser");
  const getEditorHtmlRef = useRef<(() => string) | null>(null);

  // CodeMirror view callbacks for find/replace in source mode
  const handleCmViewReady = useCallback((view: import("@codemirror/view").EditorView) => {
    cmViewRef.current = view;
  }, []);

  const handleCmViewDestroy = useCallback(() => {
    cmViewRef.current = null;
  }, []);

  const getCmView = useCallback(() => cmViewRef.current, []);

  // Lightweight toast banner for large-file warnings and similar notices.
  const showToast = useCallback((message: string, persistent = false) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    if (!persistent) {
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null);
        toastTimerRef.current = null;
      }, 4000);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  /**
   * Apply large-file policy to freshly loaded content. Returns the resulting
   * source-mode state so callers can pass it to setEditorKey / remount flows.
   * The WebView renderer can crash with >1.5MB of markdown in the WYSIWYG
   * ProseMirror doc, so we force source mode at that tier.
   */
  const applyLargeFilePolicy = useCallback(
    (content: string): { sourceMode: boolean; locked: boolean } => {
      // Byte-accurate size estimate (UTF-8). TextEncoder is available in the
      // Android WebView (Chrome 90+).
      const size = new TextEncoder().encode(content).length;
      fileSizeRef.current = size;

      if (size > FILE_SIZE_SOURCE_LOCKED) {
        setSourceMode(true);
        sourceModeRef.current = true;
        setSourceLocked(true);
        showToast(
          "Very large file — opened in source mode only to prevent crashes",
          true,
        );
        return { sourceMode: true, locked: true };
      }
      if (size > FILE_SIZE_SOURCE_DEFAULT) {
        setSourceMode(true);
        sourceModeRef.current = true;
        setSourceLocked(false);
        showToast("Large file — opened in source mode for performance", true);
        return { sourceMode: true, locked: false };
      }
      setSourceLocked(false);
      if (size > FILE_SIZE_WARN) {
        showToast("Large file — may be slow in WYSIWYG mode", true);
      }
      return { sourceMode: sourceModeRef.current, locked: false };
    },
    [showToast],
  );

  // Ctrl+F keyboard shortcut (hardware keyboard)
  useEffect(() => {
    if (screen !== "editor") return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setFindReplaceOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen]);

  // Load persisted theme and settings on mount
  useEffect(() => {
    let cancelled = false;
    platform.getSettings().then((settings) => {
      if (cancelled) return;
      themeLoadedRef.current = true;
      if (
        settings.themeMode === "light" ||
        settings.themeMode === "dark" ||
        settings.themeMode === "system"
      ) {
        setMode(settings.themeMode as ThemeMode);
      }
      if (
        typeof settings.colorScheme === "string" &&
        COLOR_SCHEMES.some((s) => s.id === settings.colorScheme)
      ) {
        setColorScheme(settings.colorScheme as ColorScheme);
      }
      if (typeof settings.showStats === "boolean") {
        setShowStats(settings.showStats);
      }
    });
    return () => { cancelled = true; };
  }, [platform, setMode, setColorScheme]);

  // Persist theme and display settings
  useEffect(() => {
    if (!themeLoadedRef.current) return;
    platform.setSettings({ themeMode: mode, colorScheme, showStats });
  }, [mode, colorScheme, showStats, platform]);

  // Handle files shared from other apps (share intent / "Open with")
  const handleSharedFile = useCallback(
    async (content: string, sharedFileName: string) => {
      // Generate a unique filename to avoid collisions
      const baseName = sharedFileName.replace(/\.(md|markdown)$/i, "");
      const uniqueName = `${baseName}-${Date.now()}.md`;

      // Save to Documents directory
      const saved = await platform.saveFile(uniqueName, content);
      if (!saved) {
        console.error("[Pennivo] Failed to save shared file");
        return;
      }

      // Open in editor
      markdownRef.current = content;
      filePathRef.current = uniqueName;
      applyLargeFilePolicy(content);
      setFileName(uniqueName);
      setEditorKey((k) => k + 1);
      setWordCount(content.trim().split(/\s+/).filter(Boolean).length);
      setCharCount(countCharacters(content));
      setSaveStatus("saved");
      setEditorReady(true);
      setScreen("editor");
      await platform.addRecentFile(uniqueName);
    },
    [platform, applyLargeFilePolicy],
  );

  useShareIntent(handleSharedFile);

  // On first launch, check if there's a recent file and go straight to editor
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
            applyLargeFilePolicy(result.content);
            const name = result.filePath.split("/").pop() || "untitled.md";
            setFileName(name);
            setWordCount(result.content.trim().split(/\s+/).filter(Boolean).length);
            setCharCount(countCharacters(result.content));
            setSaveStatus("saved");
            setEditorReady(true);
            setScreen("editor");
            return;
          }
        }
      } catch (err) {
        console.error("[Pennivo] Failed to load recent file:", err);
      }

      if (cancelled) return;

      // No recent files — start at file browser
      setEditorReady(true);
      setScreen("browser");
    }

    loadInitial();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [platform, applyLargeFilePolicy]);

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

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      await platform.saveFile(filePathRef.current, markdownRef.current);
      await platform.addRecentFile(filePathRef.current);
    }
  }, [platform]);

  const handleWordCountChange = useCallback((count: number) => {
    setWordCount(count);
  }, []);

  const handleCharCountChange = useCallback((count: number) => {
    setCharCount(count);
  }, []);

  const handleMarkdownChange = useCallback(
    (markdown: string) => {
      markdownRef.current = markdown;
      scheduleSave();

      // Paste/bulk-insert guard: if a large paste pushes the doc past the
      // 1.5 MB threshold while in WYSIWYG, flip to source mode before the
      // next ProseMirror update can crash the WebView renderer.
      const size = new TextEncoder().encode(markdown).length;
      fileSizeRef.current = size;
      if (size > FILE_SIZE_SOURCE_LOCKED && !sourceModeRef.current) {
        sourceModeRef.current = true;
        setSourceMode(true);
        setSourceLocked(true);
        setEditorKey((k) => k + 1);
        showToast(
          "Very large content pasted — switched to source mode to prevent crashes",
          true,
        );
      } else if (size <= FILE_SIZE_SOURCE_LOCKED && sourceLocked) {
        // Content shrank back below the hard cap — release the lock.
        setSourceLocked(false);
      }
    },
    [scheduleSave, showToast, sourceLocked],
  );

  const openFileFromBrowser = useCallback(
    async (filePath: string) => {
      // Save current file first if unsaved
      await flushSave();

      const result = await platform.openFilePath(filePath);
      if (result) {
        markdownRef.current = result.content;
        filePathRef.current = result.filePath;
        applyLargeFilePolicy(result.content);
        const name = result.filePath.split("/").pop() || "untitled.md";
        setFileName(name);
        setEditorKey((k) => k + 1);
        setWordCount(result.content.trim().split(/\s+/).filter(Boolean).length);
        setCharCount(countCharacters(result.content));
        setSaveStatus("saved");
        setScreen("editor");
        await platform.addRecentFile(result.filePath);
      }
    },
    [platform, flushSave, applyLargeFilePolicy],
  );

  const handleNewFileFromBrowser = useCallback(
    async (filePath: string) => {
      // Save current file first if unsaved
      await flushSave();

      markdownRef.current = "";
      filePathRef.current = filePath;
      fileSizeRef.current = 0;
      setSourceLocked(false);
      const name = filePath.split("/").pop() || "untitled.md";
      setFileName(name);
      setEditorKey((k) => k + 1);
      setWordCount(0);
      setCharCount(0);
      setSaveStatus("saved");
      setScreen("editor");
      await platform.addRecentFile(filePath);
    },
    [platform, flushSave],
  );

  const handleBackToBrowser = useCallback(async () => {
    // Save before navigating away
    await flushSave();
    setSourceMode(false);
    sourceModeRef.current = false;
    setSourceLocked(false);
    setScreen("browser");
  }, [flushSave]);

  const openSettings = useCallback(() => {
    previousScreenRef.current = screen === "editor" ? "editor" : "browser";
    setScreen("settings");
  }, [screen]);

  const handleBackFromSettings = useCallback(() => {
    setScreen(previousScreenRef.current);
  }, []);

  const toggleSourceMode = useCallback(() => {
    setSourceMode((prev) => {
      // Attempting to leave source mode while the file is over the hard cap
      // would re-enter the WYSIWYG path and crash the WebView.
      if (prev && sourceLocked) {
        showToast(
          "This document is too large for WYSIWYG mode — it would crash the editor",
        );
        return prev;
      }
      if (prev) {
        // Returning from source mode -> WYSIWYG: remount with updated content
        setEditorKey((k) => k + 1);
      }
      sourceModeRef.current = !prev;
      return !prev;
    });
    scrollRef.current?.scrollTo(0, 0);
  }, [sourceLocked, showToast]);

  // Command palette handler
  const handleCommandSelect = useCallback(
    (id: string) => {
      setCommandPaletteOpen(false);
      switch (id) {
        case "sourceMode":
          toggleSourceMode();
          break;
        case "toggleTheme":
          setMode(mode === "light" ? "dark" : "light");
          break;
        case "findReplace":
          setFindReplaceOpen(true);
          break;
        case "newFile":
          handleNewFileFromBrowser(
            `untitled-${Date.now()}.md`,
          );
          break;
        case "save":
          performSave();
          break;
        case "browseFiles":
          handleBackToBrowser();
          break;
        case "settings":
          openSettings();
          break;
        case "toggleStats":
          setShowStats((v) => !v);
          break;
        case "focusMode":
          setFocusMode((v) => !v);
          break;
        case "exportHtml": {
          const htmlContent = getEditorHtmlRef.current?.();
          if (htmlContent) {
            platform.exportHtml(htmlContent, fileName);
          }
          break;
        }
        case "exportPdf": {
          const pdfHtml = getEditorHtmlRef.current?.();
          if (pdfHtml) {
            platform.exportPdf(pdfHtml, fileName);
          }
          break;
        }
        // Formatting commands are dispatched through the toolbar action handler
        // which lives inside MobileEditorContent. We broadcast via a custom event.
        default:
          window.dispatchEvent(
            new CustomEvent("pennivo:command", { detail: id }),
          );
          break;
      }
    },
    [
      mode,
      fileName,
      platform,
      toggleSourceMode,
      setMode,
      handleNewFileFromBrowser,
      performSave,
      handleBackToBrowser,
      openSettings,
    ],
  );

  // Don't render until initial load is complete
  if (!editorReady) {
    return (
      <div className="mobile-app">
        <div className="mobile-loading">Loading...</div>
      </div>
    );
  }

  // Settings screen
  if (screen === "settings") {
    return (
      <div className="mobile-app">
        <Suspense fallback={<div className="mobile-loading">Loading settings...</div>}>
          <LazyMobileSettings
            onBack={handleBackFromSettings}
            themeMode={mode}
            colorScheme={colorScheme}
            onModeChange={setMode}
            onColorSchemeChange={setColorScheme}
          />
        </Suspense>
      </div>
    );
  }

  // File browser screen
  if (screen === "browser") {
    return (
      <div className="mobile-app">
        <FileBrowser
          onOpenFile={openFileFromBrowser}
          onNewFile={handleNewFileFromBrowser}
          currentFilePath={filePathRef.current}
          themeMode={mode}
          colorScheme={colorScheme}
          onColorSchemeChange={setColorScheme}
          onModeChange={setMode}
          onOpenSettings={openSettings}
        />
      </div>
    );
  }

  // Editor screen
  return (
    <div className={`mobile-app${focusMode ? " mobile-app--focus" : ""}`}>
      {!focusMode && (
        <header className="mobile-header">
          <button
            className="mobile-back-btn"
            onClick={handleBackToBrowser}
            aria-label="Back to files"
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="12,4 6,10 12,16" />
            </svg>
          </button>
          <span className="mobile-filename">{fileName}</span>
          <span
            className={`save-dot save-dot--${saveStatus}`}
            title={saveStatus}
            aria-hidden="true"
          />
          <span className="sr-only" role="status" aria-live="polite">
            {saveStatus === "saved" ? "Document saved" : saveStatus === "saving" ? "Saving..." : "Unsaved changes"}
          </span>
        </header>
      )}

      {focusMode && (
        <button
          className="mobile-focus-exit"
          onClick={() => setFocusMode(false)}
          aria-label="Exit focus mode"
          type="button"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="14,4 18,4 18,8" />
            <polyline points="6,16 2,16 2,12" />
            <line x1="18" y1="4" x2="12" y2="10" />
            <line x1="2" y1="16" x2="8" y2="10" />
          </svg>
        </button>
      )}

      {showThemePicker && (
        <div
          className="mobile-theme-picker-backdrop"
          onClick={() => setShowThemePicker(false)}
        >
          <div
            className="mobile-theme-picker"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Theme settings"
          >
            <div className="mobile-theme-picker__section">
              <div className="mobile-theme-picker__label">Mode</div>
              <div className="mobile-theme-picker__options">
                <button
                  className={`mobile-theme-picker__option ${mode === "light" ? "mobile-theme-picker__option--active" : ""}`}
                  onClick={() => setMode("light")}
                  type="button"
                >
                  <span className="mobile-theme-picker__swatch mobile-theme-picker__swatch--light" />
                  Light
                </button>
                <button
                  className={`mobile-theme-picker__option ${mode === "dark" ? "mobile-theme-picker__option--active" : ""}`}
                  onClick={() => setMode("dark")}
                  type="button"
                >
                  <span className="mobile-theme-picker__swatch mobile-theme-picker__swatch--dark" />
                  Dark
                </button>
                <button
                  className={`mobile-theme-picker__option ${mode === "system" ? "mobile-theme-picker__option--active" : ""}`}
                  onClick={() => setMode("system")}
                  type="button"
                >
                  <span className="mobile-theme-picker__swatch mobile-theme-picker__swatch--system" />
                  System
                </button>
              </div>
            </div>
            <div className="mobile-theme-picker__section">
              <div className="mobile-theme-picker__label">Color Scheme</div>
              <div className="mobile-theme-picker__options">
                {COLOR_SCHEMES.map((scheme) => (
                  <button
                    key={scheme.id}
                    className={`mobile-theme-picker__option ${colorScheme === scheme.id ? "mobile-theme-picker__option--active" : ""}`}
                    onClick={() => setColorScheme(scheme.id)}
                    type="button"
                  >
                    <span className={`mobile-theme-picker__swatch mobile-theme-picker__swatch--${scheme.id}`} />
                    {scheme.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {commandPaletteOpen && (
        <Suspense fallback={null}>
          <LazyMobileCommandPaletteWithCommands
            visible={commandPaletteOpen}
            onSelect={handleCommandSelect}
            onClose={() => setCommandPaletteOpen(false)}
          />
        </Suspense>
      )}

      <MilkdownProvider key={editorKey}>
        <MobileEditorContent
          sourceMode={sourceMode}
          scrollRef={scrollRef}
          markdownRef={markdownRef}
          onMarkdownChange={handleMarkdownChange}
          onWordCountChange={handleWordCountChange}
          onCharCountChange={handleCharCountChange}
          findReplaceOpen={findReplaceOpen}
          onFindReplaceClose={() => setFindReplaceOpen(false)}
          onCmViewReady={handleCmViewReady}
          onCmViewDestroy={handleCmViewDestroy}
          getCmView={getCmView}
          getEditorHtmlRef={getEditorHtmlRef}
        />
      </MilkdownProvider>

      {toastMessage && (
        <div
          className="mobile-toast"
          role="status"
          aria-live="polite"
          onClick={() => setToastMessage(null)}
        >
          {toastMessage}
        </div>
      )}

      {!focusMode && (
        <div className="mobile-bottombar" aria-label="Editor tools and statistics">
          <div className="mobile-bottombar-tools">
            <button
              className="mobile-search-btn"
              onClick={() => setFindReplaceOpen((v) => !v)}
              aria-label="Find and replace"
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="8.5" cy="8.5" r="5.5" />
                <line x1="13" y1="13" x2="18" y2="18" />
              </svg>
            </button>
            <button
              className="mobile-command-btn"
              onClick={() => setCommandPaletteOpen(true)}
              aria-label="Commands"
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="6" x2="17" y2="6" />
                <line x1="3" y1="10" x2="17" y2="10" />
                <line x1="3" y1="14" x2="17" y2="14" />
                <polyline points="13,4 17,6 13,8" />
              </svg>
            </button>
            <button
              className={`mobile-mode-btn ${sourceMode ? "mobile-mode-btn--active" : ""}`}
              onClick={toggleSourceMode}
              aria-label={
                sourceMode ? "Switch to WYSIWYG mode" : "Switch to source mode"
              }
              aria-pressed={sourceMode}
              type="button"
            >
              {sourceMode ? "WYSIWYG" : "Source"}
            </button>
            <button
              className="mobile-theme-btn"
              onClick={() => setShowThemePicker((v) => !v)}
              aria-label="Theme settings"
              aria-expanded={showThemePicker}
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="10" cy="10" r="4" />
                <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
              </svg>
            </button>
            <button
              className="mobile-command-btn"
              onClick={openSettings}
              aria-label="Settings"
              type="button"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="10" cy="10" r="2.5" />
                <path d="M16.2 12.2a1.5 1.5 0 0 0 .3 1.65l.05.05a1.8 1.8 0 1 1-2.55 2.55l-.05-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.35v.15a1.8 1.8 0 1 1-3.6 0v-.08a1.5 1.5 0 0 0-1-1.35 1.5 1.5 0 0 0-1.65.3l-.05.05a1.8 1.8 0 1 1-2.55-2.55l.05-.05a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.35-.9H1.4a1.8 1.8 0 1 1 0-3.6h.08a1.5 1.5 0 0 0 1.35-1 1.5 1.5 0 0 0-.3-1.65l-.05-.05a1.8 1.8 0 1 1 2.55-2.55l.05.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.35V1.4a1.8 1.8 0 1 1 3.6 0v.08a1.5 1.5 0 0 0 .9 1.35 1.5 1.5 0 0 0 1.65-.3l.05-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.05a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.35.9h.15a1.8 1.8 0 1 1 0 3.6h-.08a1.5 1.5 0 0 0-1.35.9z" />
              </svg>
            </button>
          </div>
          {showStats && (
            <div
              className="mobile-bottombar-stats"
              role="status"
              onClick={() => setShowStats(false)}
              aria-label="Document statistics"
            >
              <span className="mobile-stat">
                {wordCount.toLocaleString()}w
              </span>
              <span className="mobile-stat-sep">&middot;</span>
              <span className="mobile-stat">
                {charCount.toLocaleString()}c
              </span>
              <span className="mobile-stat-sep">&middot;</span>
              <span className="mobile-stat">
                {wordCount / 238 < 1
                  ? "<1m"
                  : `${Math.ceil(wordCount / 238)}m`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
