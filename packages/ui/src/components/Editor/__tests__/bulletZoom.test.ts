import { describe, it, expect, afterEach } from "vitest";
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
  setBulletZoomClickEnabled,
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

describe("Shift+Tab outdent guardrail (zoom subtree boundary)", () => {
  // Simulates a real Shift+Tab keydown through the FULL plugin chain (not
  // just bulletZoomPlugin's own handler in isolation) — `someProp` is the
  // same mechanism prosemirror-view's own native keydown listener uses
  // internally, so this exercises bulletZoomPlugin's guard AND, when it
  // doesn't block, @milkdown/preset-commonmark's real listItemKeymap
  // (Shift-Tab → liftListItem) exactly as production does. w3c-keyname
  // (which prosemirror-keymap's matching sits on) reads `event.key`
  // directly, so a plain object with the right shape is enough — no jsdom
  // DOM event dispatch required.
  function pressShiftTab(view: EditorView): void {
    const event = {
      key: "Tab",
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault() {},
    } as unknown as KeyboardEvent;
    view.someProp("handleKeyDown", (f) => f(view, event));
  }

  // a > b > c > d (each the sole child of the one before it) — zoom root is
  // always "b" across these tests, so "c" is a DIRECT CHILD of the root
  // (one lift away from escaping the subtree) and "d" is a GRANDCHILD
  // (one lift away from "c", still two levels inside the root either way).
  const NESTED_FIXTURE = "- a\n  - b\n    - c\n      - d\n";

  it("blocks Shift+Tab on the zoom root itself — doc unchanged", async () => {
    const editor = await makeEditor(NESTED_FIXTURE);
    withView(editor, (view) => {
      zoomToPosition(view, listItemPosForWord(view, "b"));
    });
    withView(editor, (view) => {
      placeCursorInWord(view, "b");
      const before = view.state.doc.toJSON();
      pressShiftTab(view);
      expect(view.state.doc.toJSON()).toEqual(before);
      // still the zoom root — zoom wasn't knocked out either
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).not.toBeNull();
    });
  });

  it("blocks Shift+Tab on a DIRECT CHILD of the zoom root — doc unchanged (regression: this used to lift the child OUT of the zoomed subtree)", async () => {
    const editor = await makeEditor(NESTED_FIXTURE);
    withView(editor, (view) => {
      zoomToPosition(view, listItemPosForWord(view, "b"));
    });
    withView(editor, (view) => {
      placeCursorInWord(view, "c");
      const before = view.state.doc.toJSON();
      pressShiftTab(view);
      expect(view.state.doc.toJSON()).toEqual(before);
    });
  });

  it("allows Shift+Tab on a grandchild — outdents one level and stays inside the zoomed subtree", async () => {
    const editor = await makeEditor(NESTED_FIXTURE);
    withView(editor, (view) => {
      zoomToPosition(view, listItemPosForWord(view, "b"));
    });
    withView(editor, (view) => {
      const depthBefore = view.state.doc.resolve(wordPos(view, "d")).depth;
      pressShiftTab(view);
      const dPosAfter = wordPos(view, "d");
      const depthAfter = view.state.doc.resolve(dPosAfter).depth;
      // actually lifted by one level — this plugin didn't swallow the event
      expect(depthAfter).toBeLessThan(depthBefore);

      const st = bulletZoomKey.getState(view.state)!;
      expect(st.zoomRootPos).not.toBeNull();
      expect(
        isPosInsideSubtree(view.state.doc, st.zoomRootPos!, dPosAfter),
      ).toBe(true);
      // "c" (the direct child, now d's sibling) is still visible too — the
      // lift didn't collapse/merge anything unexpected.
      expect(
        isPosInsideSubtree(view.state.doc, st.zoomRootPos!, wordPos(view, "c")),
      ).toBe(true);
    });
  });
});

describe("setBulletZoomClickEnabled (mobile opt-out)", () => {
  // Module-level flag, like collapsibleListPlugin's collapsedIndices — reset
  // it after every test in this block so other tests/files see the default.
  afterEach(() => {
    setBulletZoomClickEnabled(true);
  });

  it("gates the bullet-glyph click handler without affecting zoomToPosition/keyboard entry", async () => {
    const editor = await makeEditor("- a\n  - b\n");
    withView(editor, (view) => {
      const itemPos = listItemPosForWord(view, "b");
      // jsdom's getBoundingClientRect() is all-zero by default, so the
      // click handler's "gutter" check (clientX within [rect.left - 28,
      // rect.left)) is satisfied by any negative clientX here.
      const fakeEvent = { clientX: -14, clientY: 0 } as MouseEvent;

      setBulletZoomClickEnabled(false);
      const handledWhileDisabled = view.someProp("handleClick", (f) =>
        f(view, itemPos, fakeEvent),
      );
      expect(handledWhileDisabled).not.toBe(true);
      expect(
        bulletZoomKey.getState(view.state)?.zoomRootPos ?? null,
      ).toBeNull();

      // The keyboard entry point (used by desktop's Ctrl+.) is untouched by
      // the flag — it keeps working while click entry is disabled.
      placeCursorInWord(view, "b");
      expect(zoomIntoListItemAtCursor(view)).toBe(true);
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).toBe(itemPos);
      exitBulletZoom(view);

      setBulletZoomClickEnabled(true);
      const handledWhileEnabled = view.someProp("handleClick", (f) =>
        f(view, itemPos, fakeEvent),
      );
      expect(handledWhileEnabled).toBe(true);
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).toBe(itemPos);
    });
  });

  it("injects an override that hides the icon and drops its pointer-events", async () => {
    await makeEditor("- a\n");
    const style = document.head.querySelector(
      'style[data-pennivo-style="bullet-zoom-affordance-override"]',
    );
    expect(style).not.toBeNull();
    const css = style!.textContent ?? "";
    expect(css).toContain(".bullet-zoom-affordance-disabled");
    expect(css).toContain("li::after");
    expect(css).not.toContain("data-checked");
    expect(css).toContain("display: none !important");
    expect(css).toContain("pointer-events: none !important");
  });

  it("zooms the li under an icon-band click (target = li), and respects the opt-out", async () => {
    const editor = await makeEditor("- a\n  - b\n");
    withView(editor, (view) => {
      const bPos = listItemPosForWord(view, "b");
      const liB = view.nodeDOM(bPos) as HTMLElement;
      // jsdom rects are all zero: clientX -40 is inside -48..-30.
      const iconEvent = {
        clientX: -40,
        clientY: 0,
        target: liB,
      } as unknown as MouseEvent;
      // pos deliberately points at the PARENT item, as posAtCoords may.
      const parentPos = listItemPosForWord(view, "a");

      setBulletZoomClickEnabled(false);
      expect(
        view.someProp("handleClick", (f) => f(view, parentPos, iconEvent)),
      ).not.toBe(true);

      setBulletZoomClickEnabled(true);
      expect(
        view.someProp("handleClick", (f) => f(view, parentPos, iconEvent)),
      ).toBe(true);
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).toBe(bPos);
    });
  });

  it("zooms a task li on an icon-band click, but an in-gutter click on it does not zoom", async () => {
    const editor = await makeEditor("- [ ] parent\n  - [ ] child\n");
    withView(editor, (view) => {
      setBulletZoomClickEnabled(true);
      const parentPos = listItemPosForWord(view, "parent");
      const liParent = view.nodeDOM(parentPos) as HTMLElement;
      // In-gutter click (-14): the checkbox owns it; must not zoom.
      const gutterEvent = {
        clientX: -14,
        clientY: 0,
        target: liParent,
      } as unknown as MouseEvent;
      expect(
        view.someProp("handleClick", (f) => f(view, parentPos, gutterEvent)),
      ).not.toBe(true);
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).toBeNull();

      const iconEvent = {
        clientX: -40,
        clientY: 0,
        target: liParent,
      } as unknown as MouseEvent;
      expect(
        view.someProp("handleClick", (f) => f(view, parentPos, iconEvent)),
      ).toBe(true);
      expect(bulletZoomKey.getState(view.state)?.zoomRootPos).toBe(parentPos);
    });
  });

  it("suppresses the hover affordance by toggling a class on the editor DOM root", async () => {
    const editor = await makeEditor("- a\n");
    withView(editor, (view) => {
      setBulletZoomClickEnabled(false);
      // The affordance class is resynced on every view update (handleClick
      // itself doesn't trigger one in this test, so dispatch a no-op
      // transaction to force the plugin's view().update() to run).
      view.dispatch(view.state.tr);
      expect(
        view.dom.classList.contains("bullet-zoom-affordance-disabled"),
      ).toBe(true);

      setBulletZoomClickEnabled(true);
      view.dispatch(view.state.tr);
      expect(
        view.dom.classList.contains("bullet-zoom-affordance-disabled"),
      ).toBe(false);
    });
  });
});
