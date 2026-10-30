import { describe, it, expect, afterEach } from "vitest";
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
  findListItemByText,
  normalizeListItemText,
  stripInlineMarkdown,
} from "../../utils/findListItemByText";

const MD = [
  "- launch tasks",
  "- week two: behind-the-scenes photos",
  "  - [ ] task 3 #deep",
  "- [ ] filler",
  "- [ ] task 3 #deep",
  "- task 3 #deep",
  "",
].join("\n");

const editors: Editor[] = [];

async function makeView(markdown: string): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .create();
  editors.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}

afterEach(async () => {
  while (editors.length) await editors.pop()!.destroy();
  document.body.innerHTML = "";
});

describe("findListItemByText", () => {
  it("normalizes whitespace and a leading entity/space", () => {
    expect(normalizeListItemText("  a   b\t c ")).toBe("a b c");
    expect(normalizeListItemText("&#x20; lead")).toBe("lead");
  });

  it("finds the nested task, not the earlier 'launch tasks' bullet", async () => {
    const view = await makeView(MD);
    const loc = findListItemByText(view.state.doc, {
      text: "task 3 #deep",
      kind: "task",
      occurrence: 0,
    })!;
    expect(loc).not.toBeNull();
    expect(view.state.doc.textBetween(loc.from, loc.to)).toBe("task 3 #deep");
    expect(view.state.doc.resolve(loc.from).depth).toBeGreaterThan(3);
  });

  it("picks the second duplicate by occurrence", async () => {
    const view = await makeView(MD);
    const t = { text: "task 3 #deep", kind: "task" as const };
    const a = findListItemByText(view.state.doc, { ...t, occurrence: 0 })!;
    const b = findListItemByText(view.state.doc, { ...t, occurrence: 1 })!;
    expect(b.pos).toBeGreaterThan(a.pos);
    expect(view.state.doc.nodeAt(b.pos)!.attrs["checked"]).toBe(false);
    // out of range falls back to the first match
    const c = findListItemByText(view.state.doc, { ...t, occurrence: 9 })!;
    expect(c.pos).toBe(a.pos);
  });

  it("filters by kind (plain vs task)", async () => {
    const view = await makeView(MD);
    const plain = findListItemByText(view.state.doc, {
      text: "task 3 #deep",
      kind: "plain",
      occurrence: 0,
    })!;
    expect(view.state.doc.nodeAt(plain.pos)!.attrs["checked"]).toBeNull();
    expect(
      findListItemByText(view.state.doc, {
        text: "launch tasks",
        kind: "task",
        occurrence: 0,
      }),
    ).toBeNull();
  });

  it("matches despite whitespace differences in the raw text", async () => {
    const view = await makeView(MD);
    const loc = findListItemByText(view.state.doc, {
      text: "&#x20; task   3  #deep ",
      kind: "task",
      occurrence: 0,
    });
    expect(loc).not.toBeNull();
  });
});

describe("stripInlineMarkdown", () => {
  it("strips links, images, code, emphasis and escapes", () => {
    expect(
      stripInlineMarkdown(
        "Email **Sam** about [the deck](https://x) and `npm test`",
      ),
    ).toBe("Email Sam about the deck and npm test");
    expect(stripInlineMarkdown("![alt](a.png) [t][r] <https://e.com>")).toBe(
      "alt t https://e.com",
    );
    expect(stripInlineMarkdown("a *b* _c_ ~~d~~ \\*e\\*")).toBe("a b c d *e*");
  });
  it("keeps snake_case and nested strong links", () => {
    expect(stripInlineMarkdown("use snake_case_name now")).toBe(
      "use snake_case_name now",
    );
    expect(stripInlineMarkdown("**[link](u)** x")).toBe("link x");
    expect(stripInlineMarkdown("`**not bold**`")).toBe("**not bold**");
  });
});

describe("findListItemByText stripped pass", () => {
  it("matches a task with inline markdown by its rendered text", async () => {
    const md = [
      "- launch tasks",
      "- [ ] Email **Sam** about [the deck](https://x) and `npm test`",
      "- [ ] Email **Sam** about [the deck](https://x) and `npm test`",
      "",
    ].join("\n");
    const view = await makeView(md);
    const t = {
      text: "Email **Sam** about [the deck](https://x) and `npm test`",
      kind: "task" as const,
    };
    const a = findListItemByText(view.state.doc, { ...t, occurrence: 0 })!;
    const b = findListItemByText(view.state.doc, { ...t, occurrence: 1 })!;
    expect(a).not.toBeNull();
    expect(b.pos).toBeGreaterThan(a.pos);
  });
});
