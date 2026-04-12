import { useRef } from "react";
import { Milkdown, useEditor } from "@milkdown/react";
import {
  Editor as MilkdownEditorCore,
  defaultValueCtx,
  rootCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { history } from "@milkdown/plugin-history";
import { $prose } from "@milkdown/utils";
import { Plugin, Selection } from "@milkdown/prose/state";
import { InputRule, inputRules } from "@milkdown/prose/inputrules";
import type { EditorView } from "@milkdown/prose/view";
import { countWords, countCharacters } from "../../utils/textStats";
import {
  syntaxHighlightPlugin,
  highlightRefreshPlugin,
  highlightViewTrackerPlugin,
} from "./syntaxHighlight";
import { mermaidPlugin } from "./mermaidPlugin";
import { collapsibleListPlugin } from "./collapsibleListPlugin";
import { tablePlugin } from "./tablePlugin";
import { createFindReplacePlugin } from "../FindReplace/FindReplace";
import { getPlatform } from "../../platform";
import "./Editor.css";

interface EditorProps {
  initialContent?: string;
  onWordCountChange?: (count: number) => void;
  onCharCountChange?: (count: number) => void;
  onMarkdownChange?: (markdown: string) => void;
  onViewUpdate?: (view: EditorView) => void;
  onImagePaste?: (file: File) => Promise<string | null>;
}

export function Editor({
  initialContent = "",
  onWordCountChange,
  onCharCountChange,
  onMarkdownChange,
  onViewUpdate,
  onImagePaste,
}: EditorProps) {
  // Ref so the paste plugin always sees the latest callback without re-creating the editor
  const onImagePasteRef = useRef(onImagePaste);
  onImagePasteRef.current = onImagePaste;

  useEditor((root) => {
    // ProseMirror plugin that fires on every state update — most reliable timing
    const toolbarSync = $prose(
      () =>
        new Plugin({
          view: () => ({
            update: (view) => {
              onViewUpdate?.(view);
            },
          }),
        }),
    );

    // Extract an image File from a DataTransfer (clipboard or drag), if any
    function getImageFile(dt: DataTransfer | null): File | null {
      if (!dt) return null;
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) return file;
        }
      }
      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        if (file.type.startsWith("image/")) return file;
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
        const imageNode = schema.nodes["image"].create({ src, alt: "" });
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
              const linkMark = state.schema.marks["link"];
              if (!linkMark) return null;

              const prefix = match[1] || "";
              const url = match[2]!;
              const linkStart = start + prefix.length;
              const linkEnd = linkStart + url.length;

              const mark = linkMark.create({ href: url });
              return state.tr
                .addMark(linkStart, linkEnd, mark)
                .insertText(" ", end - 1, end);
            },
          ),
        ],
      });
    });

    // Allow escaping code blocks: ArrowDown at end of last code block,
    // or Enter at end of code block followed by another code block,
    // creates a paragraph so the user isn't trapped.
    const codeBlockEscape = $prose(
      () =>
        new Plugin({
          props: {
            handleKeyDown: (view, event) => {
              if (event.key !== "ArrowDown" && event.key !== "Enter")
                return false;

              const { state } = view;
              const { $from, empty } = state.selection;
              if (!empty) return false;

              const parent = $from.parent;
              if (parent.type.name !== "code_block") return false;

              // Only act when cursor is at the end of the code block content
              const atEnd = $from.parentOffset === parent.content.size;
              if (!atEnd) return false;

              const codeBlockPos = $from.before($from.depth);
              const afterPos = codeBlockPos + parent.nodeSize;
              const docSize = state.doc.content.size;

              // Check if this is the last node, or next sibling is also a code block
              const isLastNode = afterPos >= docSize;
              const nextNode = isLastNode ? null : state.doc.nodeAt(afterPos);
              const nextIsCodeBlock = nextNode?.type.name === "code_block";
              const nextIsTable = nextNode?.type.name === "table";

              if (
                event.key === "ArrowDown" &&
                (isLastNode || nextIsCodeBlock || nextIsTable)
              ) {
                // Insert paragraph after this code block and move cursor there
                const paragraph = state.schema.nodes["paragraph"].create();
                const tr = state.tr.insert(afterPos, paragraph);
                tr.setSelection(Selection.near(tr.doc.resolve(afterPos + 1)));
                view.dispatch(tr);
                return true;
              }

              if (event.key === "Enter") {
                // If on the last line AND it's empty, exit the code block
                const textBeforeCursor = parent.textContent;
                const lastNewline = textBeforeCursor.lastIndexOf("\n");
                const lastLine =
                  lastNewline === -1
                    ? textBeforeCursor
                    : textBeforeCursor.slice(lastNewline + 1);

                if (
                  lastLine === "" &&
                  (isLastNode || nextIsCodeBlock || nextIsTable)
                ) {
                  // Remove the trailing newline and insert a paragraph after
                  const paragraph = state.schema.nodes["paragraph"].create();
                  const tr = state.tr
                    .delete($from.pos - 1, $from.pos)
                    .insert(afterPos - 1, paragraph);
                  tr.setSelection(Selection.near(tr.doc.resolve(afterPos)));
                  view.dispatch(tr);
                  return true;
                }
              }

              return false;
            },
          },
        }),
    );

    // Allow escaping tables: ArrowDown in the last cell of the last row
    // when the table is the last element, creates a paragraph below.
    const tableEscape = $prose(
      () =>
        new Plugin({
          props: {
            handleKeyDown: (view, event) => {
              if (event.key !== "ArrowDown") return false;

              const { state } = view;
              const { $from, empty } = state.selection;
              if (!empty) return false;

              // Walk up to find a table_cell or table_header
              let cellDepth = -1;
              for (let d = $from.depth; d >= 0; d--) {
                const name = $from.node(d).type.name;
                if (name === "table_cell" || name === "table_header") {
                  cellDepth = d;
                  break;
                }
              }
              if (cellDepth < 0) return false;

              // Find the table node (parent of table_row which is parent of cell)
              let tableDepth = -1;
              for (let d = cellDepth - 1; d >= 0; d--) {
                if ($from.node(d).type.name === "table") {
                  tableDepth = d;
                  break;
                }
              }
              if (tableDepth < 0) return false;

              const tableNode = $from.node(tableDepth);
              const tablePos = $from.before(tableDepth);
              const afterTablePos = tablePos + tableNode.nodeSize;

              // Check if cursor is in the last row
              const rowDepth = cellDepth - 1;
              const rowNode = $from.node(rowDepth);
              const rowIndex = $from.index(tableDepth);
              const isLastRow = rowIndex === tableNode.childCount - 1;
              if (!isLastRow) return false;

              // Check if cursor is in the last cell of the row
              const cellIndex = $from.index(rowDepth);
              const isLastCell = cellIndex === rowNode.childCount - 1;
              if (!isLastCell) return false;

              // Check if cursor is at the end of the cell content
              const cell = $from.parent;
              if ($from.parentOffset < cell.content.size) return false;

              // Only act if the table is the last node in the document
              const isLastNode = afterTablePos >= state.doc.content.size;

              if (isLastNode) {
                const paragraph = state.schema.nodes["paragraph"].create();
                const tr = state.tr.insert(afterTablePos, paragraph);
                tr.setSelection(
                  Selection.near(tr.doc.resolve(afterTablePos + 1)),
                );
                view.dispatch(tr);
                return true;
              }

              return false;
            },
          },
        }),
    );

    // Click on task list checkboxes to toggle checked state.
    // Uses mousedown to save scroll position before focus-induced scroll,
    // then handleClick restores it after toggling.
    let savedCheckboxScroll: number | null = null;
    const taskListClick = $prose(
      () =>
        new Plugin({
          props: {
            handleDOMEvents: {
              mousedown(view, event) {
                const target = event.target as HTMLElement;
                const li = target.closest(
                  "li[data-checked]",
                ) as HTMLElement | null;
                if (!li) return false;

                const rect = li.getBoundingClientRect();
                if (event.clientX >= rect.left + 28) return false;

                // Save scroll position before focus can change it
                const area = view.dom.closest(
                  ".app-editor-area",
                ) as HTMLElement | null;
                savedCheckboxScroll = area?.scrollTop ?? null;
                return false;
              },
            },
            handleClick: (view, pos, event) => {
              const { state } = view;
              const $pos = state.doc.resolve(pos);

              // Walk up to find the list_item with a checked attribute
              for (let d = $pos.depth; d >= 0; d--) {
                const node = $pos.node(d);
                if (
                  node.type.name === "list_item" &&
                  node.attrs["checked"] != null
                ) {
                  // Check if the click was on the checkbox area (left side of the li)
                  const domNode = view.nodeDOM(
                    view.state.doc.resolve($pos.before(d)).pos,
                  ) as HTMLElement | null;
                  if (!domNode) break;

                  const rect = domNode.getBoundingClientRect();
                  // Checkbox is rendered via CSS ::before at the left edge
                  const clickInCheckboxArea = event.clientX < rect.left + 28;
                  if (!clickInCheckboxArea) break;

                  const nodePos = $pos.before(d);
                  view.dispatch(
                    state.tr.setNodeMarkup(nodePos, undefined, {
                      ...node.attrs,
                      checked: !node.attrs["checked"],
                    }),
                  );

                  // Restore scroll position saved during mousedown
                  // (prevents focus-induced jump to top on first click)
                  if (savedCheckboxScroll != null) {
                    const area = view.dom.closest(
                      ".app-editor-area",
                    ) as HTMLElement | null;
                    if (area) {
                      area.scrollTop = savedCheckboxScroll;
                      const s = savedCheckboxScroll;
                      requestAnimationFrame(() => {
                        area.scrollTop = s;
                      });
                    }
                    savedCheckboxScroll = null;
                  }
                  return true;
                }
              }
              savedCheckboxScroll = null;
              return false;
            },
          },
        }),
    );

    // Ctrl+Click to follow links (desktop), hover to show URL preview.
    // On mobile (Capacitor), a single tap on a link emits a custom event
    // so the mobile shell can show an action sheet (Open / Edit / Copy / Remove).
    const isMobileRuntime = getPlatform().platformName === "capacitor";

    // Find the [from, to] range of the link mark that contains `pos`, if any.
    function findLinkRange(
      doc: import("@milkdown/prose/model").Node,
      pos: number,
    ): { from: number; to: number; href: string } | null {
      const $pos = doc.resolve(pos);
      const linkMark = $pos.marks().find((m) => m.type.name === "link");
      if (!linkMark) return null;
      const parent = $pos.parent;
      const parentStart = $pos.start();

      let from = pos;
      let to = pos;
      let found = false;
      parent.forEach((child, offset) => {
        const childStart = parentStart + offset;
        const childEnd = childStart + child.nodeSize;
        if (childStart <= pos && pos <= childEnd) {
          const hasLink = child.marks.some(
            (m) =>
              m.type.name === "link" &&
              m.attrs["href"] === linkMark.attrs["href"],
          );
          if (hasLink) {
            from = childStart;
            to = childEnd;
            found = true;
          }
        }
      });

      // Extend left/right across adjacent text nodes that share the same link mark
      if (found) {
        let i = from;
        while (i > parentStart) {
          const prev = doc.resolve(i - 1);
          const sameLink = prev
            .marks()
            .some(
              (m) =>
                m.type.name === "link" &&
                m.attrs["href"] === linkMark.attrs["href"],
            );
          if (!sameLink) break;
          i -= 1;
        }
        from = i;

        let j = to;
        const parentEnd = parentStart + parent.content.size;
        while (j < parentEnd) {
          const next = doc.resolve(j);
          const sameLink = next
            .marks()
            .some(
              (m) =>
                m.type.name === "link" &&
                m.attrs["href"] === linkMark.attrs["href"],
            );
          if (!sameLink) break;
          j += 1;
        }
        to = j;
      }

      return {
        from,
        to,
        href: linkMark.attrs["href"] as string,
      };
    }

    const linkClick = $prose(
      () =>
        new Plugin({
          props: {
            handleClick: (view, pos, event) => {
              // Mobile: plain tap on a link opens the action sheet.
              if (isMobileRuntime) {
                const range = findLinkRange(view.state.doc, pos);
                if (!range || !range.href) return false;
                const coords = view.coordsAtPos(pos);
                const detail = {
                  href: range.href,
                  from: range.from,
                  to: range.to,
                  anchorRect: {
                    top: coords.bottom,
                    left: coords.left,
                  },
                };
                window.dispatchEvent(
                  new CustomEvent("pennivo-mobile-link-tap", { detail }),
                );
                event.preventDefault();
                return true;
              }

              if (!(event.ctrlKey || event.metaKey)) return false;
              const { doc } = view.state;
              const $pos = doc.resolve(pos);
              const marks = $pos.marks();
              const linkMark = marks.find((m) => m.type.name === "link");
              if (!linkMark) return false;
              const href = linkMark.attrs["href"] as string;
              if (href) {
                getPlatform().openExternal(href);
              }
              return true;
            },
            handleDOMEvents: {
              mousemove: (view, event) => {
                // Hover preview is desktop-only — on mobile, taps surface the
                // action sheet instead.
                if (isMobileRuntime) return false;
                const pos = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                });
                const editorEl = view.dom.closest(".editor-wrapper");
                if (!pos || !editorEl) return false;

                // Remove existing preview
                const existing = editorEl.querySelector(".link-url-preview");

                const $pos = view.state.doc.resolve(pos.pos);
                const linkMark = $pos
                  .marks()
                  .find((m) => m.type.name === "link");
                if (!linkMark) {
                  existing?.remove();
                  return false;
                }

                const href = linkMark.attrs["href"] as string;
                if (!href) {
                  existing?.remove();
                  return false;
                }

                if (existing) {
                  existing.textContent = `${href}  —  Ctrl+Click to open`;
                  return false;
                }

                const preview = document.createElement("div");
                preview.className = "link-url-preview";
                preview.textContent = `${href}  —  Ctrl+Click to open`;
                editorEl.appendChild(preview);
                return false;
              },
              mouseleave: (view) => {
                const editorEl = view.dom.closest(".editor-wrapper");
                editorEl?.querySelector(".link-url-preview")?.remove();
                return false;
              },
            },
          },
        }),
    );

    // Intercept clipboard paste and drag-drop for images
    const imagePaste = $prose(
      () =>
        new Plugin({
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
              const dropCoords = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              handleImageFile(file, view, dropCoords?.pos);
              return true;
            },
          },
        }),
    );

    const findReplacePlugin = $prose(() => createFindReplacePlugin());

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
      .use(codeBlockEscape)
      .use(tableEscape)
      .use(syntaxHighlightPlugin)
      .use(highlightRefreshPlugin)
      .use(highlightViewTrackerPlugin)
      .use(mermaidPlugin)
      .use(collapsibleListPlugin)
      .use(tablePlugin)
      .use(findReplacePlugin)
      .config((ctx) => {
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
          onWordCountChange?.(countWords(markdown));
          onCharCountChange?.(countCharacters(markdown));
          onMarkdownChange?.(markdown);
        });
      });
  });

  return (
    <div className="editor-wrapper" spellCheck>
      <Milkdown />
    </div>
  );
}
