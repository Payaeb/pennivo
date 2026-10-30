import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import type { EditorView } from "@milkdown/prose/view";
import {
  __resetCollapsedForTests,
  collapsibleListPlugin,
  isPositionHiddenByCollapse,
  revealPosition,
} from "../collapsibleListPlugin";

const MD = [
  "- Alpha",
  "  - Beta",
  "    - Gamma leaf",
  "  - Delta",
  "- Epsilon",
  "  - Zeta leaf",
  "",
].join("\n");

// Collapsible ordinals in document order: Alpha=0, Beta=1, Epsilon=2.

const editors: Editor[] = [];

async function makeEditor(markdown: string): Promise<Editor> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .use(collapsibleListPlugin)
    .create();
  editors.push(editor);
  return editor;
}

function withView<T>(editor: Editor, fn: (view: EditorView) => T): T {
  return editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

function wordPos(view: EditorView, word: string): number {
  let pos = -1;
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text?.startsWith(word)) pos = p;
  });
  if (pos === -1) throw new Error(`word not found: ${word}`);
  return pos + 1;
}

beforeEach(() => __resetCollapsedForTests());
afterEach(async () => {
  __resetCollapsedForTests();
  while (editors.length) await editors.pop()!.destroy();
});

describe("isPositionHiddenByCollapse", () => {
  it("is false when nothing is collapsed", async () => {
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Gamma")),
      ).toBe(false);
    });
  });

  it("is true under a collapsed ancestor, false elsewhere", async () => {
    __resetCollapsedForTests([2]); // Epsilon
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Zeta")),
      ).toBe(true);
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Gamma")),
      ).toBe(false);
    });
  });
});

describe("revealPosition", () => {
  it("returns false and dispatches nothing when nothing is collapsed", async () => {
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      const before = view.state;
      expect(revealPosition(view, wordPos(view, "Gamma"))).toBe(false);
      expect(view.state).toBe(before);
    });
  });

  it("expands only collapsed ancestors on the path, leaving siblings collapsed", async () => {
    __resetCollapsedForTests([0, 1, 2]); // Alpha, Beta, Epsilon
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      const gamma = wordPos(view, "Gamma");
      expect(isPositionHiddenByCollapse(view.state, gamma)).toBe(true);
      expect(revealPosition(view, gamma)).toBe(true);
      expect(isPositionHiddenByCollapse(view.state, gamma)).toBe(false);
      // Epsilon was not on the path, so it is still collapsed.
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Zeta")),
      ).toBe(true);
      const collapsed = view.dom.querySelectorAll(".list-item--collapsed");
      expect(collapsed.length).toBe(1);
      expect(collapsed[0]!.textContent).toContain("Epsilon");
    });
  });

  it("leaves the target's own collapsed children alone", async () => {
    __resetCollapsedForTests([0, 1]); // Alpha, Beta
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      // Beta is the clicked item: its text is hidden only by Alpha. Alpha
      // must expand; Beta's own collapse (hiding Gamma) is the user's choice.
      const beta = wordPos(view, "Beta");
      expect(revealPosition(view, beta)).toBe(true);
      expect(isPositionHiddenByCollapse(view.state, beta)).toBe(false);
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Gamma")),
      ).toBe(true);
      const collapsed = view.dom.querySelectorAll(".list-item--collapsed");
      expect(collapsed.length).toBe(1);
      expect(collapsed[0]!.textContent).toContain("Beta");
    });
  });

  it("dispatches a doc-preserving transaction", async () => {
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(MD);
    withView(editor, (view) => {
      const docBefore = view.state.doc;
      const orig = view.dispatch.bind(view);
      const seen: boolean[] = [];
      view.dispatch = (tr) => {
        seen.push(tr.docChanged);
        orig(tr);
      };
      expect(revealPosition(view, wordPos(view, "Delta"))).toBe(true);
      expect(seen).toEqual([false]);
      expect(view.state.doc).toBe(docBefore);
    });
  });
});
