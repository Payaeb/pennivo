import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, callTool, firstText, type Harness } from "./harness.js";
import { seedWorkspace, cleanup, writeFile } from "./fixtures.js";

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
    interface SearchMatch {
      path: string;
      line: number;
      preview: string;
    }
    interface SearchFileGroup {
      path: string;
      matchCount: number;
      lines: {
        line: number;
        snippet: string;
        ranges: { start: number; end: number }[];
        truncatedStart: boolean;
        truncatedEnd: boolean;
      }[];
    }
    interface SearchData {
      query: string;
      scope: string;
      matchCount: number;
      capped: boolean;
      files: SearchFileGroup[];
      matches: SearchMatch[];
    }

    it("finds matching lines across the workspace", async () => {
      const res = await callTool(h, "search", { query: "fox" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matchCount).toBeGreaterThanOrEqual(2);
      const paths = data.matches.map((m) => m.path);
      expect(paths).toContain("notes.md");
      expect(paths).toContain("sub/deep.md");
    });

    it("exposes the backward-compatible matches[] shape", async () => {
      const res = await callTool(h, "search", { query: "fox" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(Array.isArray(data.matches)).toBe(true);
      expect(data.matches.length).toBeGreaterThan(0);
      for (const m of data.matches) {
        expect(typeof m.path).toBe("string");
        expect(typeof m.line).toBe("number");
        expect(typeof m.preview).toBe("string");
      }
    });

    it("exposes the new ranked files[] grouping", async () => {
      const res = await callTool(h, "search", { query: "fox" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(Array.isArray(data.files)).toBe(true);
      const group = data.files.find((f) => f.path === "notes.md");
      expect(group).toBeDefined();
      expect(group?.matchCount).toBeGreaterThanOrEqual(1);
      expect(group?.lines[0]).toMatchObject({
        line: expect.any(Number),
        snippet: expect.any(String),
        ranges: expect.any(Array),
        truncatedStart: expect.any(Boolean),
        truncatedEnd: expect.any(Boolean),
      });
    });

    it("requires every whitespace-split term (multi-term AND)", async () => {
      // notes.md contains both "quick" and "fox"; deep.md contains "fox" only.
      const res = await callTool(h, "search", { query: "quick fox" });
      const data = JSON.parse(firstText(res)) as SearchData;
      const paths = data.files.map((f) => f.path);
      expect(paths).toContain("notes.md");
      expect(paths).not.toContain("sub/deep.md");
    });

    it("excludes files missing one of the terms", async () => {
      // "fox" exists, "zebra" exists nowhere -> no file qualifies.
      const res = await callTool(h, "search", { query: "fox zebra" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matchCount).toBe(0);
      expect(data.files).toHaveLength(0);
      expect(data.matches).toHaveLength(0);
    });

    it("scopes search to a subfolder", async () => {
      const res = await callTool(h, "search", { query: "fox", scope: "sub" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matches.every((m) => m.path.startsWith("sub/"))).toBe(true);
      expect(data.files.every((f) => f.path.startsWith("sub/"))).toBe(true);
    });

    it("is case-insensitive by default", async () => {
      const res = await callTool(h, "search", { query: "FOX" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matchCount).toBeGreaterThanOrEqual(2);
    });

    it("honors caseSensitive", async () => {
      const insensitive = JSON.parse(
        firstText(await callTool(h, "search", { query: "FOX" })),
      ) as SearchData;
      const sensitive = JSON.parse(
        firstText(
          await callTool(h, "search", { query: "FOX", caseSensitive: true }),
        ),
      ) as SearchData;
      expect(insensitive.matchCount).toBeGreaterThanOrEqual(2);
      // The fixtures spell "fox" in lowercase, so a case-sensitive "FOX" misses.
      expect(sensitive.matchCount).toBe(0);
    });

    it("matches whole words only with wholeWord", async () => {
      writeFile(root, "words.md", "cat\ncategory\n");
      const all = JSON.parse(
        firstText(await callTool(h, "search", { query: "cat" })),
      ) as SearchData;
      // Plain substring "cat" hits both the "cat" line and "category".
      const allLines = all.files.find((f) => f.path === "words.md")?.matchCount;
      expect(allLines).toBe(2);

      const whole = JSON.parse(
        firstText(
          await callTool(h, "search", { query: "cat", wholeWord: true }),
        ),
      ) as SearchData;
      const wholeGroup = whole.files.find((f) => f.path === "words.md");
      expect(wholeGroup?.matchCount).toBe(1);
      expect(wholeGroup?.lines[0].line).toBe(1);
    });

    it("supports basic regex patterns", async () => {
      const res = await callTool(h, "search", {
        query: "qu.ck",
        regex: true,
      });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.files.some((f) => f.path === "notes.md")).toBe(true);
    });

    it("returns empty for an invalid regex without throwing", async () => {
      const res = await callTool(h, "search", {
        query: "fox(",
        regex: true,
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matchCount).toBe(0);
      expect(data.files).toHaveLength(0);
      expect(data.matches).toHaveLength(0);
    });

    it("returns empty for a sub-2-character query (MIN_QUERY_CHARS)", async () => {
      const res = await callTool(h, "search", { query: "f" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.matchCount).toBe(0);
      expect(data.files).toHaveLength(0);
      expect(data.matches).toHaveLength(0);
    });

    it("caps result lines at 200 and flags capped", async () => {
      // The matcher emits up to 20 lines per file, so spread matches across
      // enough files (20 files x 20 lines = 400 candidate lines) to exceed the
      // 200 global cap and exercise capping.
      const block = Array.from({ length: 20 }, () => "needle here").join("\n");
      for (let i = 0; i < 20; i++) {
        writeFile(root, `cap/file-${i}.md`, `${block}\n`);
      }
      const res = await callTool(h, "search", { query: "needle", scope: "cap" });
      const data = JSON.parse(firstText(res)) as SearchData;
      expect(data.capped).toBe(true);
      expect(data.matches.length).toBe(200);
      // matchCount is the true total occurrence count, not the capped line count.
      expect(data.matchCount).toBeGreaterThanOrEqual(400);
    });

    it("returns a windowed snippet around the match", async () => {
      const long = `${"x".repeat(200)} needle ${"y".repeat(200)}`;
      writeFile(root, "long.md", `${long}\n`);
      const res = await callTool(h, "search", { query: "needle" });
      const data = JSON.parse(firstText(res)) as SearchData;
      const group = data.files.find((f) => f.path === "long.md");
      expect(group).toBeDefined();
      const line = group!.lines[0];
      // The snippet is windowed, so it is far shorter than the full line.
      expect(line.snippet.length).toBeLessThan(long.length);
      expect(line.snippet).toContain("needle");
      expect(line.truncatedStart).toBe(true);
      expect(line.truncatedEnd).toBe(true);
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
