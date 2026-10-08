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
import {
  bulletZoomKey,
  bulletZoomPlugin,
  computeZoomPath,
  exitBulletZoom,
  findEnclosingListItemPos,
  isPosInsideSubtree,
  zoomIntoListItemAtCursor,
  zoomOutOneLevel,
  zoomToPosition,
} from "../bulletZoomPlugin";

// Real (headless) Milkdown editor with the production commonmark+gfm schema
// plus bulletZoomPlugin itself — same pattern listConversion.test.ts uses for
// the schema, extended with the plugin under test so decoration-producing
// behavior renders into real DOM we can assert against.
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
    .use(bulletZoomPlugin)
    .create();
}

function withView<T>(editor: Editor, fn: (view: EditorView) => T): T {
  return editor.action((ctx) => fn(ctx.get(editorViewCtx)));
}

/** Position directly before the text node matching `word` (its first
 *  occurrence in document order) — usable with doc.resolve(). */
function wordPos(view: EditorView, word: string): number {
  const { state } = view;
  let pos = -1;
  state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text === word) pos = nodePos;
  });
  if (pos === -1) throw new Error(`word not found: ${word}`);
  return pos;
}

function placeCursorInWord(view: EditorView, word: string): void {
  const pos = wordPos(view, word) + 1;
  view.dispatch(
    view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))),
  );
}

function listItemPosForWord(view: EditorView, word: string): number {
  const pos = findEnclosingListItemPos(
    view.state.doc.resolve(wordPos(view, word)),
  );
  if (pos == null) throw new Error(`no enclosing list_item for: ${word}`);
  return pos;
}

describe("findEnclosingListItemPos", () => {
  it("returns null outside any list_item", async () => {
    const editor = await makeEditor("plain\n");
    withView(editor, (view) => {
      expect(
        findEnclosingListItemPos(
          view.state.doc.resolve(wordPos(view, "plain")),
        ),
      ).toBeNull();
    });
  });

  it("finds the INNERMOST enclosing list_item in a 3-deep nest", async () => {
    const editor = await makeEditor("- a\n  - b\n    - c\n");
    withView(editor, (view) => {
      const itemPos = listItemPosForWord(view, "c");
      const node = view.state.doc.nodeAt(itemPos);
      expect(node?.type.name).toBe("list_item");
      expect(node?.textContent).toBe("c");
    });
  });
});

describe("isPosInsideSubtree", () => {
  it("is true for a descendant and false for an unrelated sibling", async () => {
    const editor = await makeEditor("- a\n  - b\n- c\n");
    withView(editor, (view) => {
      const aPos = listItemPosForWord(view, "a");
      expect(isPosInsideSubtree(view.state.doc, aPos, wordPos(view, "b"))).toBe(
        true,
      );
      expect(isPosInsideSubtree(view.state.doc, aPos, wordPos(view, "c"))).toBe(
        false,
      );
    });
  });

  it("is true for the root's own position", async () => {
    const editor = await makeEditor("- a\n");
    withView(editor, (view) => {
      const aPos = listItemPosForWord(view, "a");
      expect(isPosInsideSubtree(view.state.doc, aPos, aPos)).toBe(true);
    });
  });
});

describe("computeZoomPath", () => {
  it("returns null when the position isn't a list_item", async () => {
    const editor = await makeEditor("plain\n");
    withView(editor, (view) => {
      expect(computeZoomPath(view.state.doc, 0)).toBeNull();
    });
  });

  it("builds a root-first ancestor chain plus the zoom root's own text", async () => {
    const editor = await makeEditor("- a\n  - b\n    - c\n");
    withView(editor, (view) => {
      const cPos = listItemPosForWord(view, "c");
      const info = computeZoomPath(view.state.doc, cPos)!;
      expect(info.ancestors.map((a) => a.text)).toEqual(["a", "b"]);
      expect(info.current.text).toBe("c");
      expect(info.current.pos).toBe(cPos);
    });
  });

  it("returns an empty ancestor list for a top-level item", async () => {
    const editor = await makeEditor("- a\n- b\n");
    withView(editor, (view) => {
      const aPos = listItemPosForWord(view, "a");
      const info = computeZoomPath(view.state.doc, aPos)!;
      expect(info.ancestors).toEqual([]);
      expect(info.current.text).toBe("a");
    });
  });
});

describe("bulletZoomPlugin decorations (via zoomToPosition)", () => {
  it("shows the zoom root + its descendants, hides everything else, and promotes the title", async () => {
    const editor = await makeEditor("- a\n  - b\n    - c\n  - d\n- e\n");
    withView(editor, (view) => {
      zoomToPosition(view, listItemPosForWord(view, "b"));
    });
    withView(editor, (view) => {
      const root = view.dom.querySelector(".bullet-zoom-root");
      expect(root?.textContent).toContain("b");
      expect(root?.textContent).toContain("c"); // descendant stays visible
      expect(view.dom.querySelector(".bullet-zoom-title")?.textContent).toBe(
        "b",
      );

      const hiddenTexts = Array.from(
        view.dom.querySelectorAll(".bullet-zoom-hidden"),
      ).map((el) => el.textContent?.trim());
      // "a"'s own paragraph (ancestor-on-path's own text) and the unrelated
      // "d" / "e" subtrees are all hidden.
      expect(hiddenTexts).toContain("a");
      expect(hiddenTexts.some((t) => t?.includes("d"))).toBe(true);
      expect(hiddenTexts.some((t) => t?.includes("e"))).toBe(true);
      // Nothing hidden contains "c" — it's inside the visible zoom root.
      expect(hiddenTexts.some((t) => t?.includes("c"))).toBe(false);
    });
  });

  it("returns to an empty decoration set once zoom exits", async () => {
    const editor = await makeEditor("- a\n  - b\n");
    withView(editor, (view) => {
      zoomToPosition(view, listItemPosForWord(view, "b"));
    });
    withView(editor, (view) => {
      exitBulletZoom(view);
    });
    withView(editor, (view) => {
      expect(view.dom.querySelectorAll(".bullet-zoom-hidden").length).toBe(0);
      expect(view.dom.querySelectorAll(".bullet-zoom-root").length).toBe(0);
    });
  });
});

describe("zoom root position mapping survives unrelated edits", () => {
  it("keeps tracking the same logical item after an insertion earlier in the doc", async () => {
    const editor = await makeEditor("- a\n- b\n  - c\n");
    let originalPos = -1;
    withView(editor, (view) => {
      originalPos = listItemPosForWord(view, "c");
      zoomToPosition(view, originalPos);
    });
    withView(editor, (view) => {
      // Insert a brand-new top-level bullet item BEFORE "a" — this shifts
      // every position after it, including the zoom root.
      const { schema } = view.state;
      const newItem = schema.nodes["list_item"]!.create(
        null,
        schema.nodes["paragraph"]!.create(null, schema.text("new")),
      );
      const newList = schema.nodes["bullet_list"]!.create(null, newItem);
      view.dispatch(view.state.tr.insert(0, newList));
    });
    withView(editor, (view) => {
      const st = bulletZoomKey.getState(view.state)!;
      expect(st.zoomRootPos).not.toBeNull();
      expect(st.zoomRootPos).not.toBe(originalPos);
      const node = view.state.doc.nodeAt(st.zoomRootPos!);
      expect(node?.textContent).toBe("c");
      expect(view.dom.querySelector(".bullet-zoom-root")?.textContent).toBe(
        "c",
      );
    });
  });

  it("exits zoom gracefully when the zoomed item is deleted out from under it", async () => {
    const editor = await makeEditor("- a\n- b\n");
    let bPos = -1;
    withView(editor, (view) => {
      bPos = listItemPosForWord(view, "b");
      zoomToPosition(view, bPos);
    });
    withView(editor, (view) => {
      const node = view.state.doc.nodeAt(bPos)!;
      view.dispatch(view.state.tr.delete(bPos, bPos + node.nodeSize));
    });
    withView(editor, (view) => {
      const st = bulletZoomKey.getState(view.state);
      expect(st?.zoomRootPos ?? null).toBeNull();
      expect(view.dom.querySelectorAll(".bullet-zoom-hidden").length).toBe(0);
    });
  });
});

describe("zoomIntoListItemAtCursor / zoomOutOneLevel / exitBulletZoom", () => {
  it("zoomIntoListItemAtCursor is a no-op outside a list_item", async () => {
    const editor = await makeEditor("plain\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "plain");
      expect(zoomIntoListItemAtCursor(view)).toBe(false);
      expect(
        bulletZoomKey.getState(view.state)?.zoomRootPos ?? null,
      ).toBeNull();
    });
  });

  it("zooms into the cursor's item, steps out one level, then exits", async () => {
    const editor = await makeEditor("- a\n  - b\n");
    withView(editor, (view) => {
      placeCursorInWord(view, "b");
      expect(zoomIntoListItemAtCursor(view)).toBe(true);
    });
    withView(editor, (view) => {
      expect(
        bulletZoomKey.getState(view.state)?.zoomRootPos ?? null,
      ).not.toBeNull();
      expect(zoomOutOneLevel(view)).toBe(true);
    });
    withView(editor, (view) => {
      const st = bulletZoomKey.getState(view.state)!;
      const node = view.state.doc.nodeAt(st.zoomRootPos!);
      // "a"'s own first-paragraph text — not .textContent, which would
      // concatenate in "b" too since it's still a descendant (nodeSize-wise
      // we stepped OUT to "a", which still contains "b" in its subtree).
      expect(node?.firstChild?.textContent).toBe("a"); // stepped out to the parent
    });
    withView(editor, (view) => {
      // Already at the top level — zooming out one more level exits fully.
      expect(zoomOutOneLevel(view)).toBe(true);
      expect(
        bulletZoomKey.getState(view.state)?.zoomRootPos ?? null,
      ).toBeNull();
    });
    withView(editor, (view) => {
      expect(exitBulletZoom(view)).toBe(false); // already inactive — no-op
    });
  });
});
