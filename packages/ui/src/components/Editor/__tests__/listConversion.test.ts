import { describe, it, expect } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import {
  applyListConversion,
  findListScope,
  flipCheckedInScope,
  innermostListFormat,
  retypeListScope,
} from "../listConversion";

// Build a real (but headless) Milkdown editor with the production
// commonmark+gfm schema, the same schema the app's toolbar operates on. This
// is the only way to exercise the real `checked` attr / task-list-item
// extension and the real markdown round-trip without reimplementing the gfm
// schema extension by hand.
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
    .create();
}

function withView<T>(editor: Editor, fn: (view: EditorView) => T): T {
  return editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

function serialize(editor: Editor): string {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const serializer = ctx.get(serializerCtx);
    return serializer(view.state.doc);
  });
}

/** Resolve the position just inside the text node matching `word` (its first
 *  occurrence in document order) and move the selection there. */
function placeCursorInWord(view: EditorView, word: string): void {
  const { state } = view;
  let pos = -1;
  state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text === word) pos = nodePos + 1;
  });
  if (pos === -1) throw new Error(`word not found: ${word}`);
  view.dispatch(
    state.tr.setSelection(TextSelection.near(state.doc.resolve(pos))),
  );
}

/** Select from the start of `wordA` to the end of `wordB` (first occurrence
 *  of each, in document order). */
function selectWords(view: EditorView, wordA: string, wordB: string): void {
  const { state } = view;
  let a = -1;
  let b = -1;
  state.doc.descendants((node, nodePos) => {
    if (a === -1 && node.isText && node.text === wordA) a = nodePos;
    if (node.isText && node.text === wordB) b = nodePos + node.text!.length;
  });
  if (a === -1 || b === -1) throw new Error("words not found");
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, a, b)));
}

function checkboxLineCount(markdown: string): number {
  return markdown.split("\n").filter((l) => /^\s*[*-]\s+\[[ xX]?\]\s+/.test(l))
    .length;
}

describe("innermostListFormat", () => {
  it("returns null outside any list", async () => {
    const editor = await makeEditor("plain\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "plain");
      expect(innermostListFormat(view.state.selection.$from)).toBeNull();
    });
  });

  it("detects a plain bullet item", async () => {
    const editor = await makeEditor("- one\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "one");
      expect(innermostListFormat(view.state.selection.$from)).toBe(
        "bulletList",
      );
    });
  });

  it("detects an ordered item", async () => {
    const editor = await makeEditor("1. one\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "one");
      expect(innermostListFormat(view.state.selection.$from)).toBe(
        "orderedList",
      );
    });
  });

  it("detects a task item via the innermost enclosing bullet_list", async () => {
    const editor = await makeEditor("- [ ] one\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "one");
      expect(innermostListFormat(view.state.selection.$from)).toBe("taskList");
    });
  });

  it("reports the INNERMOST list's format, not an ancestor's", async () => {
    // Bullet parent, ordered child: cursor in the child must read orderedList.
    const editor = await makeEditor("- parent\n  1. child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      expect(innermostListFormat(view.state.selection.$from)).toBe(
        "orderedList",
      );
      placeCursorInWord(view, "parent");
      expect(innermostListFormat(view.state.selection.$from)).toBe(
        "bulletList",
      );
    });
  });
});

describe("findListScope", () => {
  it("scopes a collapsed cursor to the single containing item", async () => {
    const editor = await makeEditor("- parent\n  - child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to);
      expect(scope).not.toBeNull();
      expect(scope!.startIndex).toBe(0);
      expect(scope!.endIndex).toBe(1);
      // The scoped list is the INNER list (just "child"), not the outer one
      // containing "parent" — it has exactly one child.
      expect(scope!.listNode.childCount).toBe(1);
    });
  });

  it("never includes an ancestor: the middle level of a 3-deep nest scopes alone", async () => {
    const editor = await makeEditor("- a\n  - b\n    - c\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "b");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to);
      expect(scope).not.toBeNull();
      // "b"'s own enclosing list contains only "b" (single item) — "a" is an
      // ancestor and outside this node entirely, "c" is nested inside "b"'s
      // OWN content, also outside this scope's listNode.
      expect(scope!.listNode.childCount).toBe(1);
      expect(scope!.startIndex).toBe(0);
      expect(scope!.endIndex).toBe(1);
    });
  });

  it("extends to cover a range selection across sibling items in the same list", async () => {
    const editor = await makeEditor("- parent\n  - childA\n  - childB\n");
    withView(editor, (view) => {
      selectWords(view, "childA", "childB");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to);
      expect(scope).not.toBeNull();
      expect(scope!.listNode.childCount).toBe(2);
      expect(scope!.startIndex).toBe(0);
      expect(scope!.endIndex).toBe(2);
    });
  });

  it("falls back to the single $from item when $to is outside the list", async () => {
    const editor = await makeEditor("plain\n\n- item\n");
    withView(editor, (view) => {
      const { state } = view;
      let plainPos = -1;
      let itemPos = -1;
      state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "plain") plainPos = pos;
        if (node.isText && node.text === "item") itemPos = pos + 4;
      });
      view.dispatch(
        state.tr.setSelection(
          TextSelection.create(state.doc, plainPos, itemPos),
        ),
      );
      const { $from, $to } = view.state.selection;
      // $from (in "plain") isn't in a list at all.
      expect(findListScope($from, $to)).toBeNull();
    });
  });

  it("returns null inside a blockquote (matches getActiveFormats' precedence)", async () => {
    const editor = await makeEditor("> quoted\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "quoted");
      const { $from, $to } = view.state.selection;
      expect(findListScope($from, $to)).toBeNull();
    });
  });
});

describe("flipCheckedInScope", () => {
  it("sets checked:false only on the scoped item", async () => {
    const editor = await makeEditor("- parent\n  - childA\n  - childB\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "childA");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to)!;
      const tr = view.state.tr;
      const changed = flipCheckedInScope(tr, scope);
      expect(changed).toBe(true);
      view.dispatch(tr);
    });
    expect(serialize(editor)).toContain("[ ] childA");
    expect(serialize(editor)).not.toContain("[ ] childB");
    expect(serialize(editor)).not.toContain("[ ] parent");
  });

  it("leaves an already-task item's checked state untouched (does not force-uncheck)", async () => {
    const editor = await makeEditor("- [x] childA\n- childB\n");
    withView(editor, (view) => {
      selectWords(view, "childA", "childB");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to)!;
      const tr = view.state.tr;
      flipCheckedInScope(tr, scope);
      view.dispatch(tr);
    });
    const out = serialize(editor);
    expect(out).toContain("[x] childA");
    expect(out).toContain("[ ] childB");
  });
});

describe("retypeListScope", () => {
  it("retypes the full scoped list in place (no prefix/suffix)", async () => {
    const editor = await makeEditor("- parent\n  - childA\n  - childB\n");
    withView(editor, (view) => {
      selectWords(view, "childA", "childB");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to)!;
      const tr = view.state.tr;
      retypeListScope(tr, scope, view.state.schema.nodes["ordered_list"], {
        order: 1,
      });
      view.dispatch(tr);
    });
    const out = serialize(editor);
    expect(out).toMatch(/\*\s+parent/);
    expect(out).toMatch(/1\.\s+childA/);
    expect(out).toMatch(/2\.\s+childB/);
  });

  it("splits off an untouched prefix/suffix when only a subset is scoped", async () => {
    const editor = await makeEditor(
      "- parent\n  - childA\n  - childB\n  - childC\n",
    );
    withView(editor, (view) => {
      selectWords(view, "childB", "childB");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to)!;
      expect(scope.startIndex).toBe(1);
      expect(scope.endIndex).toBe(2);
      const tr = view.state.tr;
      retypeListScope(tr, scope, view.state.schema.nodes["ordered_list"], {
        order: 1,
      });
      view.dispatch(tr);
    });
    const out = serialize(editor);
    // childA stays a bullet, childB becomes the sole ordered item, childC
    // stays a bullet — all still nested under the (unchanged) bullet parent.
    expect(out).toMatch(/\*\s+parent/);
    expect(out).toMatch(/\*\s+childA/);
    expect(out).toMatch(/1\.\s+childB/);
    expect(out).toMatch(/\*\s+childC/);
  });

  it("clears checked when retyping a task item away from taskList", async () => {
    const editor = await makeEditor("- [ ] child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      const { $from, $to } = view.state.selection;
      const scope = findListScope($from, $to)!;
      const tr = view.state.tr;
      retypeListScope(tr, scope, view.state.schema.nodes["ordered_list"], {
        order: 1,
      });
      view.dispatch(tr);
    });
    const out = serialize(editor);
    expect(out).not.toContain("[ ]");
    expect(out).toMatch(/1\.\s+child/);
  });
});

describe("applyListConversion — the reported bug: nested bullet -> task", () => {
  it("converts ONLY the nested child, leaving the parent a plain bullet", async () => {
    const editor = await makeEditor("- parent\n  - child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      applyListConversion(view, "taskList");
    });
    const out = serialize(editor);
    expect(out).toMatch(/^\*\s+parent/m);
    expect(out).not.toContain("[ ] parent");
    expect(out).toMatch(/\*\s+\[ \]\s+child/);
  });

  it("three-level fixture: converting the middle item to task leaves the top and bottom alone", async () => {
    const editor = await makeEditor("- a\n  - b\n    - c\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "b");
      applyListConversion(view, "taskList");
    });
    const out = serialize(editor);
    expect(out).not.toContain("[ ] a");
    expect(out).toContain("[ ] b");
    expect(out).not.toContain("[ ] c");
  });

  it("does not disturb an unrelated sibling at the same level", async () => {
    const editor = await makeEditor("- parent\n  - childA\n  - childB\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "childA");
      applyListConversion(view, "taskList");
    });
    const out = serialize(editor);
    expect(out).toContain("[ ] childA");
    expect(out).not.toContain("[ ] childB");
    expect(out).not.toContain("[ ] parent");
  });
});

describe("applyListConversion — toggle task OFF on a nested item", () => {
  it("does not corrupt the ancestor's checked attr", async () => {
    const editor = await makeEditor("- [ ] parent\n  - [ ] child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      applyListConversion(view, "taskList"); // already a task -> toggles off
    });
    const out = serialize(editor);
    // The ancestor must still read as a (unchecked) task — never flipped by
    // the toggle-off of its descendant.
    expect(out).toContain("[ ] parent");
  });
});

describe("applyListConversion — bulletList/orderedList on nested items", () => {
  it("single nested item: converting to ordered leaves the bullet parent a bullet", async () => {
    const editor = await makeEditor("- parent\n  - child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      applyListConversion(view, "orderedList");
    });
    const out = serialize(editor);
    expect(out).toMatch(/^\*\s+parent/m);
    expect(out).toMatch(/1\.\s+child/);
  });

  it("two selected nested siblings become numbered under an unchanged bullet parent", async () => {
    const editor = await makeEditor("- parent\n  - childA\n  - childB\n");
    withView(editor, (view) => {
      selectWords(view, "childA", "childB");
      applyListConversion(view, "orderedList");
    });
    const out = serialize(editor);
    expect(out).toMatch(/^\*\s+parent/m);
    expect(out).toMatch(/1\.\s+childA/);
    expect(out).toMatch(/2\.\s+childB/);
  });
});

describe("applyListConversion — fresh wrap (not currently in a list)", () => {
  it("multi-line selection becomes one task checkbox per line", async () => {
    const editor = await makeEditor("alpha\n\nbravo\n\ncharlie\n");
    withView(editor, (view) => {
      // A text-interior range spanning all three paragraphs, as a real
      // Ctrl+A/drag selection would resolve to (unlike raw doc-boundary
      // positions 0/doc.content.size, which don't point into inline content).
      selectWords(view, "alpha", "charlie");
      applyListConversion(view, "taskList");
    });
    await new Promise((r) => setTimeout(r, 0)); // flush the queueMicrotask
    const out = serialize(editor);
    expect(checkboxLineCount(out)).toBe(3);
    expect(out).toContain("alpha");
    expect(out).toContain("bravo");
    expect(out).toContain("charlie");
  });
});

describe("applyListConversion — mixed-tree round trip (requirement 6)", () => {
  it("bullet parent with a task child round-trips", async () => {
    const editor = await makeEditor("- parent\n  - child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      applyListConversion(view, "taskList");
    });
    const out = serialize(editor);
    expect(out).toMatch(/^\*\s+parent/m);
    expect(out).toMatch(/\*\s+\[ \]\s+child/);

    // Round-trip: re-parse the produced markdown into a fresh editor and
    // serialize again — it must come out byte-identical.
    const roundTripped = await makeEditor(out);
    expect(serialize(roundTripped)).toBe(out);
  });

  it("task parent with a plain bullet child round-trips", async () => {
    const editor = await makeEditor("- [ ] parent\n  - child\n");
    const out = serialize(editor);
    expect(out).toContain("[ ] parent");
    expect(out).not.toContain("[ ] child");

    const roundTripped = await makeEditor(out);
    expect(serialize(roundTripped)).toBe(out);
  });

  it("ordered sublist under a bullet parent round-trips", async () => {
    const editor = await makeEditor("- parent\n  - child\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "child");
      applyListConversion(view, "orderedList");
    });
    const out = serialize(editor);
    expect(out).toMatch(/^\*\s+parent/m);
    expect(out).toMatch(/1\.\s+child/);

    const roundTripped = await makeEditor(out);
    expect(serialize(roundTripped)).toBe(out);
  });
});
