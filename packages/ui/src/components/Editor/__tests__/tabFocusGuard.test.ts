import { describe, it, expect } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { tabFocusGuardPlugin } from "../tabFocusGuardPlugin";

async function makeEditor(markdown: string): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .use(tabFocusGuardPlugin)
    .create();
}

function withView<T>(editor: Editor, fn: (view: EditorView) => T): T {
  return editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

function caretIn(view: EditorView, word: string): void {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text?.includes(word)) pos = p;
  });
  if (pos === -1) throw new Error(`word not found: ${word}`);
  view.dispatch(
    view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)),
  );
}

/** Real DOM keydown on the editor root; returns whether the browser's
 *  default (focus traversal) would still run. */
function press(view: EditorView, shiftKey: boolean, extra = {}): boolean {
  const ev = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  view.dom.dispatchEvent(ev);
  return !ev.defaultPrevented;
}

describe("Tab never lets focus leave the editor", () => {
  const cases: Array<[string, string, string]> = [
    ["first bullet (cannot sink)", "- one\n- two\n", "one"],
    ["single-item list", "- solo\n", "solo"],
    ["nested first child (cannot sink)", "- a\n  - b\n  - c\n", "b"],
    ["ordered list first item", "1. one\n2. two\n", "one"],
    ["task list first item", "- [ ] one\n- [ ] two\n", "one"],
    ["plain paragraph", "hello world\n", "hello"],
    ["heading", "# Title\n", "Title"],
    ["code block", "```\ncode here\n```\n", "code"],
  ];

  for (const [name, md, word] of cases) {
    it(`${name}: Tab and Shift+Tab are consumed`, async () => {
      const editor = await makeEditor(md);
      withView(editor, (view) => {
        caretIn(view, word);
        expect(press(view, false)).toBe(false);
        caretIn(view, word);
        expect(press(view, true)).toBe(false);
      });
    });
  }

  it("impossible indent does not change the document or add history", async () => {
    const editor = await makeEditor("- one\n- two\n");
    withView(editor, (view) => {
      caretIn(view, "one");
      const before = view.state.doc.toJSON();
      const stateBefore = view.state;
      press(view, false);
      expect(view.state.doc.toJSON()).toEqual(before);
      expect(view.state.doc.eq(stateBefore.doc)).toBe(true);
    });
  });

  it("possible indent still works (middle bullet nests under previous)", async () => {
    const editor = await makeEditor("- one\n- two\n");
    withView(editor, (view) => {
      caretIn(view, "two");
      expect(press(view, false)).toBe(false);
      const list = view.state.doc.firstChild!;
      expect(list.childCount).toBe(1);
      expect(list.firstChild!.childCount).toBe(2); // paragraph + nested list
    });
  });

  it("table cell Tab still moves to the next cell", async () => {
    const editor = await makeEditor("| a | b |\n| - | - |\n| c | d |\n");
    withView(editor, (view) => {
      caretIn(view, "a");
      const from = view.state.selection.from;
      expect(press(view, false)).toBe(false);
      expect(view.state.selection.from).toBeGreaterThan(from);
    });
  });

  it("Ctrl+Tab is left to the host", async () => {
    const editor = await makeEditor("hello\n");
    withView(editor, (view) => {
      caretIn(view, "hello");
      expect(press(view, false, { ctrlKey: true })).toBe(true);
    });
  });

  it("keys from nested inputs keep native Tab", async () => {
    const editor = await makeEditor("hello\n");
    withView(editor, (view) => {
      const input = document.createElement("input");
      view.dom.appendChild(input);
      const ev = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    });
  });
});
