import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, ALL_ENABLED, type Harness } from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";

/** Concatenate every text block of a prompts/get result's messages. */
function promptText(result: unknown): string {
  const messages = ((result as { messages?: unknown }).messages ?? []) as {
    content?: { type?: string; text?: string };
  }[];
  return messages
    .map((m) => (m.content?.type === "text" ? (m.content.text ?? "") : ""))
    .join("\n");
}

describe("prompts", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = seedWorkspace();
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("lists the five prompts with titles and descriptions", async () => {
    const { prompts } = await h.client.listPrompts();
    const byName = new Map(prompts.map((p) => [p.name, p]));
    for (const name of [
      "summarize_note",
      "make_outline",
      "rewrite_concise",
      "extract_action_items",
      "draft_from_notes",
    ]) {
      const p = byName.get(name);
      expect(p, `prompt ${name} missing`).toBeDefined();
      expect(p?.description && p.description.length > 0).toBe(true);
    }
  });

  it("summarize_note embeds the file content via path safety", async () => {
    const res = await h.client.getPrompt({
      name: "summarize_note",
      arguments: { path: "notes.md" },
    });
    const text = promptText(res);
    expect(text).toContain("Summarize the following note in 3-5 concise");
    expect(text).toContain("The quick brown fox.");
  });

  it("make_outline embeds the file content", async () => {
    const res = await h.client.getPrompt({
      name: "make_outline",
      arguments: { path: "sub/deep.md" },
    });
    const text = promptText(res);
    expect(text).toContain("Produce a hierarchical outline");
    expect(text).toContain("fox runs here too.");
  });

  it("extract_action_items embeds the file content", async () => {
    const res = await h.client.getPrompt({
      name: "extract_action_items",
      arguments: { path: "notes.md" },
    });
    const text = promptText(res);
    expect(text).toContain("Extract every action item");
    expect(text).toContain("The quick brown fox.");
  });

  it("rewrite_concise with a selection uses the selection, not the file", async () => {
    const res = await h.client.getPrompt({
      name: "rewrite_concise",
      arguments: { path: "notes.md", selection: "JUST THE SELECTION TEXT" },
    });
    const text = promptText(res);
    expect(text).toContain("Rewrite the following to be more concise");
    expect(text).toContain("JUST THE SELECTION TEXT");
    expect(text).not.toContain("The quick brown fox.");
  });

  it("rewrite_concise without a selection uses the whole file", async () => {
    const res = await h.client.getPrompt({
      name: "rewrite_concise",
      arguments: { path: "notes.md" },
    });
    expect(promptText(res)).toContain("The quick brown fox.");
  });

  it("draft_from_notes with two comma-separated paths embeds both", async () => {
    const res = await h.client.getPrompt({
      name: "draft_from_notes",
      arguments: { paths: "notes.md, sub/deep.md", topic: "blog post" },
    });
    const text = promptText(res);
    expect(text).toContain("Draft a blog post from these notes:");
    expect(text).toContain("The quick brown fox.");
    expect(text).toContain("fox runs here too.");
    expect(text).toContain("notes.md");
    expect(text).toContain("sub/deep.md");
  });

  it("rejects a traversal path argument", async () => {
    await expect(
      h.client.getPrompt({
        name: "summarize_note",
        arguments: { path: "../../../etc/hosts" },
      }),
    ).rejects.toThrow();
  });

  it("records a resource:prompt:<name> audit event on use", async () => {
    await h.client.getPrompt({
      name: "summarize_note",
      arguments: { path: "notes.md" },
    });
    const events = h.audit.recent(20);
    const evt = events.find(
      (e) => e.tool === "resource:prompt:summarize_note" && e.outcome === "ok",
    );
    expect(evt).toBeDefined();
    expect(evt?.path).toBe("notes.md");
  });

  it("denies prompts when the master switch is off", async () => {
    const root2 = seedWorkspace();
    const h2 = await connect(root2, {
      config: {
        ...ALL_ENABLED,
        enabled: false,
      },
    });
    try {
      const res = await h2.client.getPrompt({
        name: "summarize_note",
        arguments: { path: "notes.md" },
      });
      const text = promptText(res);
      expect(text).toContain("disabled");
      expect(text).not.toContain("The quick brown fox.");
      const denied = h2.audit
        .recent(20)
        .find(
          (e) =>
            e.tool === "resource:prompt:summarize_note" &&
            e.outcome === "denied",
        );
      expect(denied).toBeDefined();
    } finally {
      await h2.close();
      cleanup(root2);
    }
  });
});
