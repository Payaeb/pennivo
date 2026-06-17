import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, callTool, firstText, type Harness } from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children?: TreeNode[];
}

function flattenPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.path);
    if (n.children) out.push(...flattenPaths(n.children));
  }
  return out;
}

describe("read tools", () => {
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

  it("exposes the read tools", async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("search");
  });

  describe("list_files", () => {
    it("lists the top level non-recursively, skipping hidden and node_modules", async () => {
      const res = await callTool(h, "list_files", {});
      const data = JSON.parse(firstText(res)) as { entries: TreeNode[] };
      const names = data.entries.map((e) => e.name);
      expect(names).toContain("notes.md");
      expect(names).toContain("todo.txt");
      expect(names).toContain("image-doc.md");
      expect(names).toContain("sub");
      expect(names).not.toContain(".hidden");
      expect(names).not.toContain("node_modules");
      // non-recursive: no children expanded
      expect(
        data.entries.find((e) => e.name === "sub")?.children,
      ).toBeUndefined();
    });

    it("walks recursively and prunes empty folders", async () => {
      const res = await callTool(h, "list_files", { recursive: true });
      const data = JSON.parse(firstText(res)) as { entries: TreeNode[] };
      const all = flattenPaths(data.entries);
      expect(all).toContain("sub/deep.md");
      expect(all).toContain("sub/nested/leaf.markdown");
      // empty-folder has no markdown beneath it -> pruned
      expect(all).not.toContain("empty-folder");
      // hidden + node_modules trees never appear
      expect(all.some((p) => p.includes(".hidden"))).toBe(false);
      expect(all.some((p) => p.includes("node_modules"))).toBe(false);
    });

    it("rejects a traversal path", async () => {
      const res = await callTool(h, "list_files", { path: "../" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/outside the workspace/i);
    });
  });

  describe("read_file", () => {
    it("reads markdown content", async () => {
      const res = await callTool(h, "read_file", { path: "notes.md" });
      expect(res.isError).toBeFalsy();
      expect(firstText(res)).toContain("The quick brown fox.");
    });

    it("decodes %20 in image URLs to a human-readable form", async () => {
      const res = await callTool(h, "read_file", { path: "image-doc.md" });
      const text = firstText(res);
      expect(text).toContain("my pic.png");
      expect(text).not.toContain("my%20pic.png");
    });

    it("rejects a non-markdown file", async () => {
      const res = await callTool(h, "read_file", {
        path: "notes.md/../package-lock.json",
      });
      // resolves inside but wrong extension OR path error — either way an error
      expect(res.isError).toBe(true);
    });

    it("rejects a path outside the workspace", async () => {
      const res = await callTool(h, "read_file", { path: "../../etc/hosts" });
      expect(res.isError).toBe(true);
    });
  });

  describe("search", () => {
    it("finds matching lines across the workspace", async () => {
      const res = await callTool(h, "search", { query: "fox" });
      const data = JSON.parse(firstText(res)) as {
        matchCount: number;
        matches: { path: string; line: number; preview: string }[];
      };
      expect(data.matchCount).toBeGreaterThanOrEqual(2);
      const paths = data.matches.map((m) => m.path);
      expect(paths).toContain("notes.md");
      expect(paths).toContain("sub/deep.md");
    });

    it("scopes search to a subfolder", async () => {
      const res = await callTool(h, "search", { query: "fox", scope: "sub" });
      const data = JSON.parse(firstText(res)) as {
        matches: { path: string }[];
      };
      expect(data.matches.every((m) => m.path.startsWith("sub/"))).toBe(true);
    });

    it("is case-insensitive", async () => {
      const res = await callTool(h, "search", { query: "FOX" });
      const data = JSON.parse(firstText(res)) as { matchCount: number };
      expect(data.matchCount).toBeGreaterThanOrEqual(2);
    });
  });

  it("records successful calls in the audit log with the client name", async () => {
    await callTool(h, "read_file", { path: "notes.md" });
    const recent = h.audit.recent(10);
    const entry = recent.find((e) => e.tool === "read_file");
    expect(entry).toBeDefined();
    expect(entry?.outcome).toBe("ok");
    expect(entry?.path).toBe("notes.md");
    expect(entry?.agent).toBe("test-client");
  });
});
