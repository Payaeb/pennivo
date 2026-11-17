import { describe, it, expect, afterEach, vi } from "vitest";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
} from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { $prose } from "@milkdown/utils";
import type { EditorView } from "@milkdown/prose/view";
import {
  createImageViewerPlugin,
  type ImageViewerRequest,
} from "../imageViewerPlugin";

const editors: Editor[] = [];

async function makeEditor(
  onOpen: (r: ImageViewerRequest) => void,
): Promise<EditorView> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const plugin = $prose(() => createImageViewerPlugin(onOpen));
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, "Hello\n\n![A cat](cat.png)\n");
    })
    .use(commonmark)
    .use(plugin)
    .create();
  editors.push(editor);
  return editor.action((ctx) => ctx.get(editorViewCtx));
}

function markLoaded(img: HTMLImageElement) {
  Object.defineProperty(img, "complete", { configurable: true, value: true });
  Object.defineProperty(img, "naturalWidth", {
    configurable: true,
    value: 300,
  });
}

afterEach(async () => {
  while (editors.length) await editors.pop()!.destroy();
  document.body.innerHTML = "";
});

describe("imageViewerPlugin", () => {
  it("double-click on a loaded image opens the viewer without touching doc or selection", async () => {
    const onOpen = vi.fn();
    const view = await makeEditor(onOpen);
    const img = view.dom.querySelector("img") as HTMLImageElement;
    expect(img).toBeTruthy();
    markLoaded(img);

    const docBefore = view.state.doc;
    const selBefore = view.state.selection;
    const dispatch = vi.spyOn(view, "dispatch");

    img.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ alt: "A cat" });
    expect(dispatch).not.toHaveBeenCalled();
    expect(view.state.doc).toBe(docBefore);
    expect(view.state.selection).toBe(selBefore);
  });

  it("does not open for an image that failed to load", async () => {
    const onOpen = vi.fn();
    const view = await makeEditor(onOpen);
    const img = view.dom.querySelector("img") as HTMLImageElement;
    // jsdom: complete=false / naturalWidth=0 stands in for a broken image.
    img.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows a hover badge outside the editor DOM and opens from it", async () => {
    const onOpen = vi.fn();
    const view = await makeEditor(onOpen);
    const img = view.dom.querySelector("img") as HTMLImageElement;
    markLoaded(img);
    const htmlBefore = view.dom.innerHTML;
    const rect = (top: number, bottom: number) =>
      ({
        top,
        bottom,
        left: 0,
        right: 400,
        width: 400,
        height: bottom - top,
      }) as DOMRect;
    vi.spyOn(img, "getBoundingClientRect").mockReturnValue(rect(100, 300));
    vi.spyOn(view.dom, "getBoundingClientRect").mockReturnValue(rect(0, 800));

    img.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const badge = document.querySelector(".pennivo-image-badge") as HTMLElement;
    expect(badge).toBeTruthy();
    expect(view.dom.contains(badge)).toBe(false);
    expect(badge.hidden).toBe(false);

    badge.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(badge.hidden).toBe(true);
    expect(view.dom.innerHTML).toBe(htmlBefore);
  });
});
