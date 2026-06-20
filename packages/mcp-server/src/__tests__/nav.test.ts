import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { makeWorkspace, cleanup, writeFile } from "./fixtures.js";
import { DEFAULT_PERMISSIONS } from "../config.js";

interface Backlink {
  path: string;
  line: number;
  linkText: string;
  url: string;
}
interface BacklinksData {
  path: string;
  count: number;
  capped: boolean;
  backlinks: Backlink[];
}
interface Heading {
  level: number;
  text: string;
  line: number;
}
interface OutlineData {
  path: string;
  headings: Heading[];
}

describe("nav tools", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    h = await connect(root);
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("exposes the nav tools", async () => {
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("find_backlinks");
    expect(names).toContain("get_outline");
  });

  describe("find_backlinks", () => {
    it("finds inline and reference-style links, ignoring external/anchor", async () => {
      writeFile(root, "target.md", "# Target\n");
      writeFile(
        root,
        "inline.md",
        "See [Target](./target.md) for details.\n",
      );
      writeFile(
        root,
        "ref.md",
        "Use [the link][t].\n\n[t]: ./target.md\n",
      );
      writeFile(
        root,
        "noise.md",
        [
          "[ext](https://example.com/target.md)",
          "[anchor](#target)",
          "[abs](/target.md)",
        ].join("\n") + "\n",
      );

      const res = await callTool(h, "find_backlinks", { path: "target.md" });
      const data = JSON.parse(firstText(res)) as BacklinksData;
      expect(data.path).toBe("target.md");
      const paths = data.backlinks.map((b) => b.path).sort();
      expect(paths).toEqual(["inline.md", "ref.md"]);
      expect(data.backlinks.some((b) => b.path === "noise.md")).toBe(false);
    });

    it("reports correct line numbers", async () => {
      writeFile(root, "target.md", "# Target\n");
      writeFile(
        root,
        "src.md",
        "# Title\n\nIntro\n\nLink: [t](./target.md)\n",
      );
      const res = await callTool(h, "find_backlinks", { path: "target.md" });
      const data = JSON.parse(firstText(res)) as BacklinksData;
      const entry = data.backlinks.find((b) => b.path === "src.md");
      expect(entry?.line).toBe(5);
      expect(entry?.linkText).toBe("t");
    });

    it("resolves links from subfolders", async () => {
      writeFile(root, "index.md", "# Home\n");
      writeFile(root, "sub/page.md", "Up to [home](../index.md).\n");
      const res = await callTool(h, "find_backlinks", { path: "index.md" });
      const data = JSON.parse(firstText(res)) as BacklinksData;
      expect(data.backlinks.map((b) => b.path)).toContain("sub/page.md");
    });

    it("rejects a path outside the workspace", async () => {
      const res = await callTool(h, "find_backlinks", {
        path: "../../etc/hosts",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/outside the workspace/i);
    });

    it("is denied when the permission is off", async () => {
      await h.close();
      const off = {
        enabled: true,
        tools: { ...DEFAULT_PERMISSIONS.tools, find_backlinks: false },
      };
      h = await connect(root, { config: off });
      writeFile(root, "target.md", "# Target\n");
      const res = await callTool(h, "find_backlinks", { path: "target.md" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/disabled/i);
    });
  });

  describe("get_outline", () => {
    it("returns heading levels and lines", async () => {
      writeFile(
        root,
        "doc.md",
        "# Title\n\n## Section\n\ntext\n\n### Sub\n",
      );
      const res = await callTool(h, "get_outline", { path: "doc.md" });
      const data = JSON.parse(firstText(res)) as OutlineData;
      expect(data.path).toBe("doc.md");
      expect(data.headings).toEqual([
        { level: 1, text: "Title", line: 1 },
        { level: 2, text: "Section", line: 3 },
        { level: 3, text: "Sub", line: 7 },
      ]);
    });

    it("ignores # inside fenced code blocks", async () => {
      writeFile(
        root,
        "code.md",
        "# Real\n\n```\n# not a heading\n```\n\n## After\n",
      );
      const res = await callTool(h, "get_outline", { path: "code.md" });
      const data = JSON.parse(firstText(res)) as OutlineData;
      expect(data.headings.map((hd) => hd.text)).toEqual(["Real", "After"]);
    });

    it("rejects a non-markdown file", async () => {
      writeFile(root, "data.json", "{}\n");
      const res = await callTool(h, "get_outline", { path: "data.json" });
      expect(res.isError).toBe(true);
    });

    it("rejects a path outside the workspace", async () => {
      const res = await callTool(h, "get_outline", {
        path: "../../etc/hosts",
      });
      expect(res.isError).toBe(true);
    });

    it("is allowed by default (read tool, default on)", async () => {
      await h.close();
      h = await connect(root, { config: ALL_ENABLED });
      writeFile(root, "doc.md", "# Title\n");
      const res = await callTool(h, "get_outline", { path: "doc.md" });
      expect(res.isError).toBeFalsy();
    });
  });
});
