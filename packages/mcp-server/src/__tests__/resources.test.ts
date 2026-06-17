import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, type Harness } from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";

function resourceText(result: unknown): string {
  const contents = ((result as { contents?: unknown }).contents ?? []) as {
    text?: string;
  }[];
  return contents[0]?.text ?? "";
}

describe("resources", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = seedWorkspace();
    h = await connect(root);
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("lists the three resources/templates", async () => {
    const resources = await h.client.listResources();
    const templates = await h.client.listResourceTemplates();
    const names = [
      ...resources.resources.map((r) => r.name),
      ...templates.resourceTemplates.map((t) => t.name),
    ];
    expect(names).toContain("workspace");
    expect(names).toContain("recent");
    expect(names).toContain("file");
  });

  it("pennivo://workspace returns root, file count, and tree", async () => {
    const res = await h.client.readResource({ uri: "pennivo://workspace" });
    const data = JSON.parse(resourceText(res)) as {
      root: string;
      fileCount: number;
      entries: { name: string }[];
    };
    expect(data.root).toBe(".");
    expect(data.fileCount).toBeGreaterThan(0);
    expect(data.entries.some((e) => e.name === "notes.md")).toBe(true);
  });

  it("pennivo://recent returns workspace-relative files", async () => {
    const res = await h.client.readResource({ uri: "pennivo://recent" });
    const data = JSON.parse(resourceText(res)) as { files: { path: string }[] };
    expect(data.files.length).toBeGreaterThan(0);
    expect(
      data.files.every((f) => !f.path.includes(":") && !f.path.startsWith("/")),
    ).toBe(true);
  });

  it("pennivo://file/<path> returns a file's contents", async () => {
    const res = await h.client.readResource({
      uri: "pennivo://file/sub/deep.md",
    });
    expect(resourceText(res)).toContain("fox runs here too.");
  });

  it("pennivo://file/<path> rejects a traversal path", async () => {
    await expect(
      h.client.readResource({ uri: "pennivo://file/../../../etc/hosts" }),
    ).rejects.toThrow();
  });
});
