import { describe, it, expect } from "vitest";
import { sanitizeEditorHtmlForExport } from "../exportSanitize";

const TOGGLE =
  '<span class="collapse-toggle ProseMirror-widget" data-idx="0" contenteditable="false"><svg viewBox="0 0 16 16"><polyline points="6,4 10,8 6,12"></polyline></svg></span>';

function parse(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("sanitizeEditorHtmlForExport: removed", () => {
  it("removes the collapse handle and keeps the item text", () => {
    const out = sanitizeEditorHtmlForExport(
      `<ul><li class="list-item--collapsible">${TOGGLE}<p>Parent</p><ul><li><p>Child</p></li></ul></li></ul>`,
    );
    const dom = parse(out);
    expect(dom.querySelector(".collapse-toggle")).toBeNull();
    expect(dom.querySelector("svg")).toBeNull();
    expect(out).not.toContain("data-idx");
    expect(dom.textContent).toContain("Parent");
    expect(dom.textContent).toContain("Child");
  });

  it("strips the collapsed class so collapsed children are exported", () => {
    const out = sanitizeEditorHtmlForExport(
      `<ul><li class="list-item--collapsed">${TOGGLE.replace("collapse-toggle ", "collapse-toggle collapse-toggle--collapsed ")}<p>Parent</p><ul><li><p>Hidden child</p></li></ul></li></ul>`,
    );
    expect(out).not.toContain("list-item--collapsed");
    expect(out).not.toContain("collapse-toggle");
    expect(out).toContain("Hidden child");
    expect(out).not.toContain("class=");
  });

  it("removes the image viewer badge button", () => {
    const out = sanitizeEditorHtmlForExport(
      '<p>x</p><button type="button" class="pennivo-image-badge" aria-label="View image"><svg></svg></button>',
    );
    expect(out).not.toContain("button");
    expect(out).not.toContain("pennivo-image-badge");
  });

  it("removes ProseMirror helper nodes", () => {
    const out = sanitizeEditorHtmlForExport(
      '<p>Hi <a href="https://x.test">link</a><img class="ProseMirror-separator" alt=""><br class="ProseMirror-trailingBreak"></p><div class="ProseMirror-gapcursor"></div>',
    );
    expect(out).not.toContain("ProseMirror");
    expect(out).toContain("link");
  });

  it("removes mermaid and kanban edit buttons and status text", () => {
    const out = sanitizeEditorHtmlForExport(
      '<div class="kanban-preview-widget"><div class="kanban-preview-title">Board</div><button class="mermaid-gantt-edit-btn" contenteditable="false">Edit Board</button></div>' +
        '<div class="mermaid-preview-widget"><span class="mermaid-preview-hint">Enter mermaid syntax below...</span></div>' +
        '<div class="mermaid-preview-widget"><span class="mermaid-preview-loading">Rendering...</span></div>' +
        '<div class="mermaid-preview-widget"><span class="mermaid-preview-error">Could not render diagram</span></div>',
    );
    expect(out).not.toContain("Edit Board");
    expect(out).not.toContain("Enter mermaid");
    expect(out).not.toContain("Rendering");
    expect(out).not.toContain("Could not render");
    expect(out).not.toContain("mermaid-preview-widget");
    expect(out).toContain("Board");
  });

  it("removes the hidden raw source of gantt/kanban blocks", () => {
    const out = sanitizeEditorHtmlForExport(
      '<pre class="mermaid-gantt-hidden-code" data-language="mermaid"><code>gantt\n title X</code></pre><p>after</p>',
    );
    expect(out).not.toContain("gantt");
    expect(out).toContain("after");
  });

  it("strips decoration classes but keeps the text", () => {
    const out = sanitizeEditorHtmlForExport(
      '<ul><li class="bullet-zoom-root bullet-zoom-path-item ProseMirror-selectednode"><p>Task <span class="meta-chip meta-chip--label">#tag</span> <span class="find-match find-match--current">hit</span></p></li></ul>',
    );
    expect(out).not.toContain("bullet-zoom");
    expect(out).not.toContain("ProseMirror");
    expect(out).not.toContain("meta-chip");
    expect(out).not.toContain("find-match");
    expect(out).toContain("#tag");
    expect(out).toContain("hit");
  });

  it("removes contenteditable attributes", () => {
    const out = sanitizeEditorHtmlForExport(
      '<div contenteditable="false"><p>x</p></div>',
    );
    expect(out).not.toContain("contenteditable");
    expect(out).toContain("<p>x</p>");
  });

  it("does not mutate a live element it was derived from", () => {
    const live = document.createElement("div");
    live.innerHTML = `<ul><li class="list-item--collapsed">${TOGGLE}<p>A</p></li></ul>`;
    const before = live.innerHTML;
    sanitizeEditorHtmlForExport(live.innerHTML);
    expect(live.innerHTML).toBe(before);
    expect(live.querySelector(".collapse-toggle")).not.toBeNull();
  });
});

describe("sanitizeEditorHtmlForExport: kept", () => {
  it("keeps a rendered mermaid svg inside its widget", () => {
    const svg =
      '<svg viewBox="0 0 100 50" class="flowchart"><g class="node default"><text>Finish</text></g></svg>';
    const out = sanitizeEditorHtmlForExport(
      `<div class="mermaid-preview-widget ProseMirror-widget" contenteditable="false">${svg}</div>`,
    );
    const dom = parse(out);
    expect(dom.querySelector(".mermaid-preview-widget svg")).not.toBeNull();
    expect(dom.querySelector("svg g.node")).not.toBeNull();
    expect(out).toContain("Finish");
    expect(out).not.toContain("ProseMirror");
  });

  it("keeps a kanban preview's cards", () => {
    const out = sanitizeEditorHtmlForExport(
      '<div class="kanban-preview-widget"><div class="kanban-preview-card">Card one</div></div>',
    );
    expect(out).toContain("Card one");
    expect(out).toContain("kanban-preview-card");
  });

  it("keeps task list items with their checked state", () => {
    const html =
      '<ul><li data-item-type="task" data-checked="true" data-label="•" data-list-type="bullet"><p>Done</p></li><li data-item-type="task" data-checked="false"><p>Todo</p></li></ul>';
    const out = sanitizeEditorHtmlForExport(html);
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('data-checked="false"');
    expect(out).toContain("Done");
    expect(out).toContain("Todo");
  });

  it("keeps images, tables and code blocks", () => {
    const html =
      '<p><img src="pennivo-file:///C:/a/pic.png" alt="Swatch"></p>' +
      "<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Ada</td></tr></tbody></table>" +
      '<pre data-language="ts"><code class="hljs language-ts"><span class="hljs-keyword">const</span> a = 1;</code></pre>';
    const out = sanitizeEditorHtmlForExport(html);
    const dom = parse(out);
    expect(
      dom.querySelector('img[src="pennivo-file:///C:/a/pic.png"]'),
    ).not.toBeNull();
    expect(dom.querySelector("table td")?.textContent).toBe("Ada");
    expect(dom.querySelector("pre[data-language='ts']")).not.toBeNull();
    expect(dom.querySelector(".hljs-keyword")?.textContent).toBe("const");
    expect(dom.querySelector("code")?.className).toBe("hljs language-ts");
  });

  it("keeps ordinary classes and links", () => {
    const out = sanitizeEditorHtmlForExport(
      '<p class="note">See <a href="https://x.test" class="ext">x</a></p>',
    );
    expect(out).toContain('class="note"');
    expect(out).toContain('href="https://x.test"');
  });
});
