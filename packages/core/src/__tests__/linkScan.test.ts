import { describe, it, expect } from "vitest";
import { findInboundLinks, type ScanFile } from "../linkScan";

describe("findInboundLinks — basic link kinds", () => {
  it("detects an inline link to the target", () => {
    const files: ScanFile[] = [
      { path: "index.md", content: "See [Notes](./notes.md) for more.\n" },
      { path: "notes.md", content: "# Notes\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toEqual([
      { path: "index.md", line: 1, linkText: "Notes", url: "./notes.md" },
    ]);
  });

  it("detects a reference-style definition with empty linkText", () => {
    const files: ScanFile[] = [
      {
        path: "index.md",
        content: "Use [the ref][n].\n\n[n]: ./notes.md\n",
      },
      { path: "notes.md", content: "# Notes\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: "index.md",
      url: "./notes.md",
      linkText: "",
    });
  });

  it("detects an image reference and reports its alt as linkText", () => {
    const files: ScanFile[] = [
      { path: "doc.md", content: "![diagram](./img/chart.png)\n" },
      { path: "img/chart.png", content: "" },
    ];
    const result = findInboundLinks("img/chart.png", files);
    expect(result).toEqual([
      {
        path: "doc.md",
        line: 1,
        linkText: "diagram",
        url: "./img/chart.png",
      },
    ]);
  });
});

describe("findInboundLinks — non-relative urls ignored", () => {
  it("ignores external, protocol-relative, absolute, and pure-anchor urls", () => {
    const content = [
      "[ext](https://example.com/notes.md)",
      "[mail](mailto:a@b.com)",
      "[proto](//cdn.example.com/notes.md)",
      "[abs](/notes.md)",
      "[anchor](#notes)",
    ].join("\n");
    const files: ScanFile[] = [
      { path: "index.md", content },
      { path: "notes.md", content: "# Notes\n" },
    ];
    expect(findInboundLinks("notes.md", files)).toEqual([]);
  });

  it("ignores a pure-anchor link even when the fragment matches the name", () => {
    const files: ScanFile[] = [
      { path: "notes.md", content: "[jump](#notes.md)\n" },
    ];
    expect(findInboundLinks("notes.md", files)).toEqual([]);
  });
});

describe("findInboundLinks — relative resolution", () => {
  it("resolves a ../ link from a subfolder", () => {
    const files: ScanFile[] = [
      { path: "sub/page.md", content: "Up to [home](../index.md).\n" },
      { path: "index.md", content: "# Home\n" },
    ];
    const result = findInboundLinks("index.md", files);
    expect(result).toEqual([
      { path: "sub/page.md", line: 1, linkText: "home", url: "../index.md" },
    ]);
  });

  it("resolves a ./ link into a subfolder", () => {
    const files: ScanFile[] = [
      { path: "index.md", content: "Open [guide](./docs/guide.md).\n" },
      { path: "docs/guide.md", content: "# Guide\n" },
    ];
    const result = findInboundLinks("docs/guide.md", files);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("index.md");
  });

  it("strips a #fragment before resolving", () => {
    const files: ScanFile[] = [
      { path: "index.md", content: "Jump [s](./notes.md#section).\n" },
      { path: "notes.md", content: "# Notes\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("./notes.md#section");
  });
});

describe("findInboundLinks — line numbers", () => {
  it("reports the 1-based line of each link", () => {
    const files: ScanFile[] = [
      {
        path: "index.md",
        content: "# Title\n\nIntro text.\n\nSee [n](./notes.md).\n",
      },
      { path: "notes.md", content: "# Notes\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(5);
  });
});

describe("findInboundLinks — segment boundary", () => {
  it("does not match a link to a sibling whose name shares a prefix", () => {
    const files: ScanFile[] = [
      {
        path: "index.md",
        content: "[a](./notes.md) and [b](./notes-archive.md)\n",
      },
      { path: "notes.md", content: "# Notes\n" },
      { path: "notes-archive.md", content: "# Archive\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("./notes.md");
  });

  it("does not match a link into a folder whose name shares a prefix", () => {
    const files: ScanFile[] = [
      { path: "index.md", content: "[x](./notes-archive/a.md)\n" },
      { path: "notes/a.md", content: "# A\n" },
    ];
    expect(findInboundLinks("notes/a.md", files)).toEqual([]);
  });
});

describe("findInboundLinks — multiple referrers", () => {
  it("reports one entry per referring file", () => {
    const files: ScanFile[] = [
      { path: "top.md", content: "[t](./target.md)\n" },
      { path: "deep/mid.md", content: "[t](../target.md)\n" },
      { path: "target.md", content: "# T\n" },
    ];
    const result = findInboundLinks("target.md", files);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(["deep/mid.md", "top.md"]);
  });

  it("records multiple links from the same file", () => {
    const files: ScanFile[] = [
      {
        path: "index.md",
        content: "[a](./notes.md) then [b](./notes.md) again\n",
      },
      { path: "notes.md", content: "# Notes\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.linkText)).toEqual(["a", "b"]);
  });
});

describe("findInboundLinks — self reference", () => {
  it("does not backlink to itself for an anchor-only link", () => {
    const files: ScanFile[] = [
      { path: "notes.md", content: "[top](#heading)\n" },
    ];
    expect(findInboundLinks("notes.md", files)).toEqual([]);
  });

  it("does record a genuine self link to its own path", () => {
    const files: ScanFile[] = [
      { path: "notes.md", content: "[me](./notes.md)\n" },
    ];
    const result = findInboundLinks("notes.md", files);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("notes.md");
  });
});
