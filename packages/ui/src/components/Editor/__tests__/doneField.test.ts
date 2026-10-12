import { describe, it, expect } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { undo } from "@milkdown/prose/history";
import { applyTaskToggle, planDoneFieldEdit } from "../doneField";

const TODAY = "2026-10-12";

describe("planDoneFieldEdit", () => {
  it("appends a done field with a leading space when none is present", () => {
    expect(planDoneFieldEdit("Pay rent", TODAY, true)).toEqual({
      insertText: " [done:: 2026-10-12]",
      deleteRanges: [],
    });
  });

  it("does not add a second leading space after trailing whitespace or on empty text", () => {
    expect(planDoneFieldEdit("Pay rent ", TODAY, true).insertText).toBe(
      "[done:: 2026-10-12]",
    );
    expect(planDoneFieldEdit("", TODAY, true).insertText).toBe(
      "[done:: 2026-10-12]",
    );
  });

  it("does not double-append when a valid done token already exists", () => {
    const plan = planDoneFieldEdit("Pay rent [done:: 2026-10-01]", TODAY, true);
    expect(plan.insertText).toBeUndefined();
    expect(plan.deleteRanges).toEqual([]);
  });

  it("still appends when the existing done token is invalid", () => {
    const plan = planDoneFieldEdit("Pay rent [done:: soon]", TODAY, true);
    expect(plan.insertText).toBe(" [done:: 2026-10-12]");
  });

  it("removes the done token and its leading space on uncheck", () => {
    const text = "Pay rent [done:: 2026-10-12]";
    const plan = planDoneFieldEdit(text, TODAY, false);
    expect(plan.insertText).toBeUndefined();
    expect(plan.deleteRanges).toEqual([{ from: 8, to: text.length }]);
    const { from, to } = plan.deleteRanges[0]!;
    expect(text.slice(0, from) + text.slice(to)).toBe("Pay rent");
  });

  it("removes multiple done tokens, leaving no double spaces", () => {
    const text = "A [done:: 2026-10-01] b [done:: 2026-10-02] #x";
    const plan = planDoneFieldEdit(text, TODAY, false);
    expect(plan.deleteRanges).toHaveLength(2);
    let out = text;
    for (const r of [...plan.deleteRanges].reverse()) {
      out = out.slice(0, r.from) + out.slice(r.to);
    }
    expect(out).toBe("A b #x");
  });

  it("removes adjacent done tokens without overlapping ranges", () => {
    const text = "A [done:: 2026-10-01] [done:: 2026-10-02]";
    const plan = planDoneFieldEdit(text, TODAY, false);
    let out = text;
    for (const r of [...plan.deleteRanges].reverse()) {
      out = out.slice(0, r.from) + out.slice(r.to);
    }
    expect(out).toBe("A");
  });

  it("takes the trailing space when the token starts the paragraph", () => {
    const text = "[done:: 2026-10-01] Pay rent";
    const plan = planDoneFieldEdit(text, TODAY, false);
    const { from, to } = plan.deleteRanges[0]!;
    expect(text.slice(0, from) + text.slice(to)).toBe("Pay rent");
  });

  it("leaves due tokens alone and does nothing when there is nothing to do", () => {
    expect(
      planDoneFieldEdit("Pay rent [due:: 2026-10-20]", TODAY, false),
    ).toEqual({ deleteRanges: [] });
    expect(planDoneFieldEdit("Pay rent", TODAY, false)).toEqual({
      deleteRanges: [],
    });
  });
});

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
    .use(history)
    .create();
}

describe("applyTaskToggle", () => {
  function firstItemText(editor: Editor): string {
    return editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      return view.state.doc.firstChild!.firstChild!.firstChild!.textContent;
    });
  }

  function toggle(editor: Editor, next: boolean, record: boolean): void {
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      // doc > bullet_list > list_item: the item sits at position 1.
      view.dispatch(applyTaskToggle(view.state, 1, next, record, TODAY));
    });
  }

  function checkedOf(editor: Editor): unknown {
    return editor.action(
      (ctx) =>
        ctx.get(editorViewCtx).state.doc.firstChild!.firstChild!.attrs[
          "checked"
        ],
    );
  }

  it("check then uncheck round-trips the text when recording is on", async () => {
    const editor = await makeEditor("- [ ] Pay rent\n");
    toggle(editor, true, true);
    expect(checkedOf(editor)).toBe(true);
    expect(firstItemText(editor)).toBe("Pay rent [done:: 2026-10-12]");
    toggle(editor, false, true);
    expect(checkedOf(editor)).toBe(false);
    expect(firstItemText(editor)).toBe("Pay rent");
  });

  it("never touches the text when recording is off", async () => {
    const editor = await makeEditor("- [ ] Pay rent\n");
    toggle(editor, true, false);
    expect(checkedOf(editor)).toBe(true);
    expect(firstItemText(editor)).toBe("Pay rent");

    const editor2 = await makeEditor("- [x] Pay rent [done:: 2026-10-01]\n");
    toggle(editor2, false, false);
    expect(firstItemText(editor2)).toBe("Pay rent [done:: 2026-10-01]");
  });

  it("keeps a real space and the code text across check/uncheck after a code span", async () => {
    const editor = await makeEditor("- [ ] run `npm test`\n");
    toggle(editor, true, true);
    expect(firstItemText(editor)).toBe("run npm test [done:: 2026-10-12]");
    toggle(editor, false, true);
    expect(firstItemText(editor)).toBe("run npm test");
  });

  it("never deletes a trailing image or hard break on uncheck", async () => {
    const editor = await makeEditor("- [ ] ![a](x.png)\n");
    const imageCount = (): number =>
      editor.action((ctx) => {
        let n = 0;
        ctx.get(editorViewCtx).state.doc.descendants((node) => {
          if (node.type.name === "image") n++;
        });
        return n;
      });
    expect(imageCount()).toBe(1);
    toggle(editor, true, true);
    expect(imageCount()).toBe(1);
    expect(firstItemText(editor)).toContain(" [done:: 2026-10-12]");
    toggle(editor, false, true);
    expect(imageCount()).toBe(1);
    expect(firstItemText(editor)).toBe("");
  });

  it("is a single undo step covering both the flip and the text", async () => {
    const editor = await makeEditor("- [ ] Pay rent\n");
    toggle(editor, true, true);
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      undo(view.state, view.dispatch);
    });
    expect(checkedOf(editor)).toBe(false);
    expect(firstItemText(editor)).toBe("Pay rent");
  });
});
