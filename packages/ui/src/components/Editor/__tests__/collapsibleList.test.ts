import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/core";
import {
  commonmark,
  sinkListItemCommand,
  liftListItemCommand,
} from "@milkdown/preset-commonmark";
import { callCommand } from "@milkdown/utils";
import { TextSelection } from "@milkdown/prose/state";
import { history, undoCommand, redoCommand } from "@milkdown/plugin-history";
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
    .use(history)
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

describe("collapse state survives structural edits", () => {
  const LIST = ["- Xray", "- Yankee", "- Zulu", "  - Zulu child", ""].join(
    "\n",
  );

  function place(view: EditorView, word: string) {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, wordPos(view, word)),
      ),
    );
  }

  function collapsedTexts(view: EditorView): string[] {
    return Array.from(view.dom.querySelectorAll(".list-item--collapsed")).map(
      (el) => el.textContent ?? "",
    );
  }

  it("indenting a middle item under a sibling does not collapse that sibling", async () => {
    __resetCollapsedForTests([0]); // Zulu (the only collapsible item)
    const editor = await makeEditor(LIST);
    withView(editor, (view) => place(view, "Yankee"));
    editor.action(callCommand(sinkListItemCommand.key));
    withView(editor, (view) => {
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Yankee")),
      ).toBe(false);
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("indenting under a user-collapsed item expands it so the caret is visible", async () => {
    const md = ["- Xray", "  - Xchild", "- Yankee", ""].join("\n");
    __resetCollapsedForTests([0]); // Xray collapsed
    const editor = await makeEditor(md);
    withView(editor, (view) => place(view, "Yankee"));
    editor.action(callCommand(sinkListItemCommand.key));
    withView(editor, (view) => {
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Yankee")),
      ).toBe(false);
      expect(collapsedTexts(view).length).toBe(0);
    });
  });

  it("outdent keeps unrelated collapsed items collapsed", async () => {
    const md = ["- Xray", "  - Yankee", "- Zulu", "  - Zulu child", ""].join(
      "\n",
    );
    __resetCollapsedForTests([1]); // Zulu
    const editor = await makeEditor(md);
    withView(editor, (view) => place(view, "Yankee"));
    editor.action(callCommand(liftListItemCommand.key));
    withView(editor, (view) => {
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("deleting an item before a collapsed one keeps that one collapsed", async () => {
    const md = ["- Xray", "- Yankee", "- Zulu", "  - Zulu child", ""].join(
      "\n",
    );
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(md);
    withView(editor, (view) => {
      let from = -1;
      let to = -1;
      view.state.doc.descendants((n, pos) => {
        if (
          from === -1 &&
          n.type.name === "list_item" &&
          n.textContent === "Xray"
        ) {
          from = pos;
          to = pos + n.nodeSize;
        }
      });
      view.dispatch(view.state.tr.delete(from, to));
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("works for ordered and task lists too", async () => {
    const md = [
      "1. Xray",
      "2. Yankee",
      "3. Zulu",
      "   - [ ] Zulu task",
      "",
    ].join(String.fromCharCode(10));
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(md);
    withView(editor, (view) => place(view, "Yankee"));
    editor.action(callCommand(sinkListItemCommand.key));
    withView(editor, (view) => {
      expect(
        isPositionHiddenByCollapse(view.state, wordPos(view, "Yankee")),
      ).toBe(false);
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });
});

describe("collapse state across undo, replacement and bigger edits", () => {
  const nl = String.fromCharCode(10);
  const LIST = ["- Xray", "- Yankee", "- Zulu", "  - Zulu child", ""].join(nl);

  function place(view: EditorView, word: string) {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, wordPos(view, word)),
      ),
    );
  }
  function collapsedTexts(view: EditorView): string[] {
    return Array.from(view.dom.querySelectorAll(".list-item--collapsed")).map(
      (el) => el.textContent ?? "",
    );
  }

  it("undo and redo of an indent keep the right item collapsed", async () => {
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(LIST);
    withView(editor, (view) => place(view, "Yankee"));
    editor.action(callCommand(sinkListItemCommand.key));
    editor.action(callCommand(undoCommand.key));
    withView(editor, (view) => {
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
    editor.action(callCommand(redoCommand.key));
    withView(editor, (view) => {
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("replacing the whole document (file switch / reload) drops collapsed state", async () => {
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(LIST);
    withView(editor, (view) => {
      view.dispatch(
        view.state.tr.replaceWith(
          0,
          view.state.doc.content.size,
          view.state.doc.content,
        ),
      );
      expect(collapsedTexts(view).length).toBe(0);
    });
  });

  it("indenting a multi-item selection keeps unrelated collapsed items collapsed", async () => {
    const md = ["- A1", "- A2", "- A3", "- Zulu", "  - Zulu child", ""].join(
      nl,
    );
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(md);
    withView(editor, (view) => {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            wordPos(view, "A2"),
            wordPos(view, "A3"),
          ),
        ),
      );
    });
    editor.action(callCommand(sinkListItemCommand.key));
    withView(editor, (view) => {
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("inserting a list slice before a collapsed item keeps it collapsed", async () => {
    __resetCollapsedForTests([0]);
    const editor = await makeEditor(LIST);
    withView(editor, (view) => {
      const li = view.state.doc.child(0).child(0); // Xray item
      const at = 1; // start of the first list item
      view.dispatch(view.state.tr.insert(at, li.copy(li.content)));
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("Zulu");
    });
  });

  it("deeply nested collapsed item survives outdenting a sibling above it", async () => {
    const md = [
      "- L1",
      "  - L2",
      "    - L3",
      "      - L4 parent",
      "        - L5",
      "  - L2b",
      "",
    ].join(nl);
    // collapsible ordinals in doc order: L1=0, L2=1, L3=2, L4 parent=3
    __resetCollapsedForTests([3]);
    const editor = await makeEditor(md);
    withView(editor, (view) => place(view, "L2b"));
    editor.action(callCommand(liftListItemCommand.key));
    withView(editor, (view) => {
      const c = collapsedTexts(view);
      expect(c.length).toBe(1);
      expect(c[0]).toContain("L4 parent");
    });
  });
});
