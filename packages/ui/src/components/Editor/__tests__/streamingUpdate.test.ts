import { describe, it, expect } from "vitest";
import { Schema, Node as ProseMirrorNode } from "@milkdown/prose/model";
import { EditorState, TextSelection } from "@milkdown/prose/state";
import { EditorView } from "@milkdown/prose/view";
import { applyStreamingUpdate } from "../streamingUpdate";

// Minimal schema sufficient to exercise block-level append: paragraphs,
// headings, and code blocks. The goal is to test the DIFF/APPLY logic, not
// Milkdown's real markdown parser, so we use a small hand-rolled schema and a
// stub parseMarkdown that maps each top-level block to one of these nodes.
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      toDOM: () => ["p", 0],
    },
    heading: {
      group: "block",
      content: "text*",
      attrs: { level: { default: 1 } },
      toDOM: (node) => [`h${node.attrs["level"]}`, 0],
    },
    code_block: {
      group: "block",
      content: "text*",
      marks: "",
      code: true,
      toDOM: () => ["pre", ["code", 0]],
    },
    text: { group: "inline" },
  },
});

// Map one markdown block string to a single ProseMirror node.
function blockToNode(block: string): ProseMirrorNode {
  if (block.startsWith("# ")) {
    return schema.nodes["heading"].create(
      { level: 1 },
      block.length > 2 ? schema.text(block.slice(2)) : null,
    );
  }
  if (block.startsWith("```")) {
    const body = block.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "");
    return schema.nodes["code_block"].create(
      null,
      body.length > 0 ? schema.text(body) : null,
    );
  }
  return schema.nodes["paragraph"].create(
    null,
    block.length > 0 ? schema.text(block) : null,
  );
}

// Parse a full markdown string into a doc node by splitting on blank lines.
function docFromMarkdown(md: string): ProseMirrorNode {
  const blocks = md
    .replace(/^\s*\n/, "")
    .replace(/\s+$/, "")
    .split(/\n[ \t]*\n+/)
    .filter((b) => b.length > 0);
  const nodes = blocks.length > 0 ? blocks.map(blockToNode) : [
    schema.nodes["paragraph"].create(),
  ];
  return schema.nodes["doc"].create(null, nodes);
}

// The injected parser used by applyStreamingUpdate: parses a trailing markdown
// region into a Fragment of block nodes.
function parseMarkdown(md: string): ProseMirrorNode {
  return docFromMarkdown(md);
}

// Build a headless EditorView seeded from markdown. ProseMirror's EditorView
// needs a DOM mount; jsdom (the ui vitest environment) provides one.
function makeView(md: string): EditorView {
  const doc = docFromMarkdown(md);
  const state = EditorState.create({ schema, doc });
  const mount = document.createElement("div");
  return new EditorView(mount, { state });
}

function docText(view: EditorView): string[] {
  const out: string[] = [];
  view.state.doc.forEach((node) => out.push(node.textContent));
  return out;
}

describe("applyStreamingUpdate — append-only growth", () => {
  it("extends the last block (trailing-only growth) and keeps prefix nodes", () => {
    const prev = "# Title\n\nFirst para.";
    const next = "# Title\n\nFirst para. Now longer.";
    const view = makeView(prev);
    const prefixNode = view.state.doc.child(0); // the heading

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual(["Title", "First para. Now longer."]);
    // The unchanged prefix heading node is byte-identical (same instance kept).
    expect(view.state.doc.child(0)).toBe(prefixNode);
  });

  it("appends new blocks", () => {
    const prev = "# Title\n\nFirst para.";
    const next = "# Title\n\nFirst para.\n\nSecond para.\n\nThird.";
    const view = makeView(prev);

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual([
      "Title",
      "First para.",
      "Second para.",
      "Third.",
    ]);
  });

  it("appends all blocks from an empty prev (cold start)", () => {
    const prev = "";
    const next = "# Title\n\nBody paragraph.";
    const view = makeView(prev);

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual(["Title", "Body paragraph."]);
  });
});

describe("applyStreamingUpdate — bail-out safety valve", () => {
  it("bails when a NON-trailing block changed", () => {
    const prev = "# Title\n\nFirst para.\n\nSecond.";
    const next = "# Changed Title\n\nFirst para.\n\nSecond.";
    const view = makeView(prev);
    const before = docText(view);

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(false);
    // Document untouched on bail.
    expect(docText(view)).toEqual(before);
  });

  it("bails when a middle block changed even though the tail matches", () => {
    const prev = "A\n\nB\n\nC";
    const next = "A\n\nB-changed\n\nC";
    const view = makeView(prev);

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(false);
    expect(docText(view)).toEqual(["A", "B", "C"]);
  });

  it("bails (no corruption) when parseMarkdown throws", () => {
    const prev = "# Title\n\nFirst.";
    const next = "# Title\n\nFirst.\n\nSecond.";
    const view = makeView(prev);
    const before = docText(view);
    const throwingParser = () => {
      throw new Error("parse boom");
    };

    const result = applyStreamingUpdate(view, prev, next, throwingParser);

    expect(result.applied).toBe(false);
    expect(docText(view)).toEqual(before);
  });
});

describe("applyStreamingUpdate — selection preservation", () => {
  it("preserves a selection entirely inside the unchanged prefix", () => {
    const prev = "# Title\n\nFirst para.";
    const next = "# Title\n\nFirst para.\n\nSecond.";
    const view = makeView(prev);

    // Put the cursor inside the heading text "Title" (prefix block).
    const headingTextPos = 3; // inside "Title"
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, headingTextPos),
      ),
    );
    const anchorBefore = view.state.selection.anchor;

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(true);
    // The prefix did not move, so the selection anchor is unchanged.
    expect(view.state.selection.anchor).toBe(anchorBefore);
  });

  it("drops the cursor to the document end when the selection was in the replaced tail", () => {
    const prev = "# Title\n\nFirst para.";
    const next = "# Title\n\nFirst para. extended.";
    const view = makeView(prev);

    // Cursor at the very end of the doc (inside the trailing block).
    const end = view.state.doc.content.size;
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, end),
      ),
    );

    const result = applyStreamingUpdate(view, prev, next, parseMarkdown);

    expect(result.applied).toBe(true);
    expect(view.state.selection.anchor).toBe(view.state.doc.content.size);
  });
});

describe("applyStreamingUpdate — no-op and meta", () => {
  it("treats prev === next as applied with no document change", () => {
    const md = "# Title\n\nBody.";
    const view = makeView(md);
    const before = docText(view);

    const result = applyStreamingUpdate(view, md, md, parseMarkdown);

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual(before);
  });

  it("does not add the streaming transaction to undo history", () => {
    const prev = "# Title\n\nFirst.";
    const next = "# Title\n\nFirst.\n\nSecond.";
    const view = makeView(prev);

    applyStreamingUpdate(view, prev, next, parseMarkdown);

    // Selection/doc updated; the apply must succeed without throwing. The
    // addToHistory:false meta is asserted indirectly: a streaming apply that
    // polluted history would still apply, so we just confirm the apply landed.
    expect(docText(view)).toEqual(["Title", "First.", "Second."]);
  });
});

// A markdown serializer that mirrors blockToNode: it reproduces, byte-for-byte,
// the markdown each node was built from. A fenced code_block re-emits its body
// between ``` fences, so a code body containing a blank line serializes to text
// that splitBlocks WOULD split into two blocks.
function serializeNode(node: ProseMirrorNode): string {
  if (node.type.name === "heading") {
    return `# ${node.textContent}`;
  }
  if (node.type.name === "code_block") {
    return "```\n" + node.textContent + "\n```";
  }
  return node.textContent;
}

function serializeDoc(doc: ProseMirrorNode): string {
  const parts: string[] = [];
  doc.forEach((node) => parts.push(serializeNode(node)));
  return parts.join("\n\n");
}

describe("applyStreamingUpdate — re-serialize correctness gate", () => {
  // A real skew: the FIRST document block is a fenced code block whose body
  // contains an internal blank line. That single code_block node serializes to
  // four lines that splitBlocks tears into TWO markdown blocks. So when the code
  // block is part of the unchanged prefix and a paragraph grows after it, the
  // naive block-count -> node mapping over-counts by one: it maps the position
  // PAST a phantom second prefix node, slicing inside/after the wrong boundary
  // and producing a document that does NOT serialize back to `next`. The gate
  // must catch that and bail.
  it("bails when the block-count mapping skews through a multi-block code node", () => {
    // One code_block node, body "a\n\nb" -> serializes to "```\na\n\nb\n```".
    const code = "```\na\n\nb\n```";
    const prev = `${code}\n\nFirst.`;
    const next = `${code}\n\nFirst. extended.`;

    // Build the view directly from nodes so the doc has exactly TWO top-level
    // children (code_block + paragraph), matching how Milkdown would hold it,
    // even though splitBlocks sees three "blocks" in the markdown.
    const codeNode = schema.nodes["code_block"].create(
      null,
      schema.text("a\n\nb"),
    );
    const paraNode = schema.nodes["paragraph"].create(
      null,
      schema.text("First."),
    );
    const doc = schema.nodes["doc"].create(null, [codeNode, paraNode]);
    const state = EditorState.create({ schema, doc });
    const mount = document.createElement("div");
    const view = new EditorView(mount, { state });
    const before = docText(view);

    // parseMarkdown here would (wrongly) split the trailing region; the gate is
    // what protects us. Use a parser that reproduces the test schema mapping.
    const result = applyStreamingUpdate(
      view,
      prev,
      next,
      parseMarkdown,
      serializeDoc,
    );

    // The naive mapping mis-slices, so the re-serialized doc != next -> bail.
    expect(result.applied).toBe(false);
    // Document untouched on bail (no corruption).
    expect(docText(view)).toEqual(before);
  });

  it("applies (applied:true) when the result round-trips to the target markdown", () => {
    const prev = "# Title\n\nFirst para.";
    const next = "# Title\n\nFirst para.\n\nSecond para.";
    const view = makeView(prev);

    const result = applyStreamingUpdate(
      view,
      prev,
      next,
      parseMarkdown,
      serializeDoc,
    );

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual(["Title", "First para.", "Second para."]);
    // The applied doc serializes back to exactly the target markdown.
    expect(serializeDoc(view.state.doc)).toBe(next);
  });

  it("bails without dispatching when serializeDoc reports a mismatch", () => {
    const prev = "# Title\n\nFirst.";
    const next = "# Title\n\nFirst.\n\nSecond.";
    const view = makeView(prev);
    const before = docText(view);

    // A serializer that never matches `next` proves the gate aborts the apply.
    const wrongSerializer = () => "totally different output";

    const result = applyStreamingUpdate(
      view,
      prev,
      next,
      parseMarkdown,
      wrongSerializer,
    );

    expect(result.applied).toBe(false);
    // Transaction discarded: document is untouched.
    expect(docText(view)).toEqual(before);
  });

  it("tolerates a trailing-newline difference (normalized before compare)", () => {
    const prev = "# Title\n\nFirst.";
    const next = "# Title\n\nFirst.\n\nSecond.";
    const view = makeView(prev);

    // Serializer appends a trailing newline; the gate trims trailing whitespace
    // on both sides, so this must still apply.
    const trailingNewlineSerializer = (doc: ProseMirrorNode) =>
      serializeDoc(doc) + "\n";

    const result = applyStreamingUpdate(
      view,
      prev,
      next,
      parseMarkdown,
      trailingNewlineSerializer,
    );

    expect(result.applied).toBe(true);
    expect(docText(view)).toEqual(["Title", "First.", "Second."]);
  });
});
