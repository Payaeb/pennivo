import { describe, it, expect } from "vitest";
import { searchFiles } from "../searchFiles";
import type { SearchInputFile } from "../types";

/** Find a file result by path, or undefined. */
function fileFor(result: ReturnType<typeof searchFiles>, path: string) {
  return result.files.find((f) => f.path === path);
}

/** Pull the substring a range covers out of its snippet, for readable asserts. */
function rangeText(snippet: string, r: { start: number; end: number }): string {
  return snippet.slice(r.start, r.end);
}

describe("searchFiles — case-insensitive substring (default)", () => {
  const files: SearchInputFile[] = [
    { path: "a.md", content: "The Cat sat on the mat.\n" },
  ];

  it("matches regardless of case by default", () => {
    const result = searchFiles("cat", files);
    const f = fileFor(result, "a.md");
    expect(f).toBeDefined();
    expect(f!.matchCount).toBe(1);
    expect(f!.lines).toHaveLength(1);
    expect(f!.lines[0].line).toBe(1);
    const ln = f!.lines[0];
    expect(rangeText(ln.snippet, ln.ranges[0])).toBe("Cat");
  });
});

describe("searchFiles — case-sensitive", () => {
  const files: SearchInputFile[] = [
    { path: "a.md", content: "Cat and cat and CAT\n" },
  ];

  it("matches only exact case when caseSensitive is true", () => {
    const result = searchFiles("cat", files, { caseSensitive: true });
    const f = fileFor(result, "a.md");
    expect(f).toBeDefined();
    expect(f!.matchCount).toBe(1);
    const ln = f!.lines[0];
    expect(rangeText(ln.snippet, ln.ranges[0])).toBe("cat");
  });

  it("is case-insensitive by default (counts all three)", () => {
    const result = searchFiles("cat", files);
    expect(fileFor(result, "a.md")!.matchCount).toBe(3);
  });
});

describe("searchFiles — multi-term AND", () => {
  it("includes a file only when ALL terms appear somewhere", () => {
    const files: SearchInputFile[] = [
      { path: "both.md", content: "alpha line\nbeta line\n" },
      { path: "one.md", content: "alpha only here\n" },
    ];
    const result = searchFiles("alpha beta", files);
    expect(fileFor(result, "both.md")).toBeDefined();
    expect(fileFor(result, "one.md")).toBeUndefined();
  });

  it("excludes every file when one term is missing everywhere", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "alpha gamma\n" },
    ];
    const result = searchFiles("alpha beta", files);
    expect(result.files).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  it("emits a line containing ANY term and highlights each", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "alpha here\nbeta there\nalpha beta both\n" },
    ];
    const result = searchFiles("alpha beta", files);
    const f = fileFor(result, "a.md")!;
    // alpha x2 + beta x2 = 4 occurrences total.
    expect(f.matchCount).toBe(4);
    // Three lines each contain at least one term.
    expect(f.lines.map((l) => l.line)).toEqual([1, 2, 3]);
    // The third line has both terms highlighted.
    expect(f.lines[2].ranges).toHaveLength(2);
  });
});

describe("searchFiles — per-line highlight ranges for multiple occurrences", () => {
  it("emits one range per occurrence of a term on a line", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "cat cat cat\n" },
    ];
    const result = searchFiles("cat", files);
    const f = fileFor(result, "a.md")!;
    expect(f.matchCount).toBe(3);
    const ln = f.lines[0];
    expect(ln.ranges).toHaveLength(3);
    for (const r of ln.ranges) {
      expect(rangeText(ln.snippet, r)).toBe("cat");
    }
  });
});

describe("searchFiles — whole word", () => {
  it("matches the whole word but not a substring of a longer word", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "a cat in the category\n" },
    ];
    const result = searchFiles("cat", files, { wholeWord: true });
    const f = fileFor(result, "a.md")!;
    expect(f.matchCount).toBe(1);
    const ln = f.lines[0];
    expect(rangeText(ln.snippet, ln.ranges[0])).toBe("cat");
    // The match must be the standalone "cat", not the one inside "category".
    expect(ln.fileOffset).toBe(2);
  });

  it("matches the substring when wholeWord is off", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "a cat in the category\n" },
    ];
    const result = searchFiles("cat", files);
    expect(fileFor(result, "a.md")!.matchCount).toBe(2);
  });
});

describe("searchFiles — regex mode", () => {
  it("matches a basic regex pattern per term", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "id-12 and id-345 here\n" },
    ];
    const result = searchFiles("id-\\d+", files, { regex: true });
    const f = fileFor(result, "a.md")!;
    expect(f.matchCount).toBe(2);
    const texts = f.lines[0].ranges.map((r) =>
      rangeText(f.lines[0].snippet, r),
    );
    expect(texts).toEqual(["id-12", "id-345"]);
  });

  it("still ANDs across regex terms", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "foo123\n" },
      { path: "b.md", content: "foo123 bar456\n" },
    ];
    const result = searchFiles("foo\\d+ bar\\d+", files, { regex: true });
    expect(fileFor(result, "a.md")).toBeUndefined();
    expect(fileFor(result, "b.md")).toBeDefined();
  });

  it("treats metacharacters literally in plain (non-regex) mode", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "value is a.b not axb\n" },
    ];
    const result = searchFiles("a.b", files);
    const f = fileFor(result, "a.md")!;
    // Only the literal "a.b" matches, not "axb".
    expect(f.matchCount).toBe(1);
    expect(rangeText(f.lines[0].snippet, f.lines[0].ranges[0])).toBe("a.b");
  });
});

describe("searchFiles — invalid regex", () => {
  it("sets invalidPattern and returns no matches without throwing", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "anything at all here\n" },
    ];
    let result!: ReturnType<typeof searchFiles>;
    expect(() => {
      result = searchFiles("foo (unclosed", files, { regex: true });
    }).not.toThrow();
    expect(result.invalidPattern).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.totalMatches).toBe(0);
    expect(result.capped).toBe(false);
  });

  it("aborts the whole search if any one term is invalid", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "valid stuff [bad\n" },
    ];
    const result = searchFiles("valid [unclosed", files, { regex: true });
    expect(result.invalidPattern).toBe(true);
    expect(result.files).toEqual([]);
  });
});

describe("searchFiles — snippet windowing", () => {
  it("windows around the first match and sets truncated flags on a long line", () => {
    const left = "x".repeat(100);
    const right = "y".repeat(100);
    const content = `${left}NEEDLE${right}\n`;
    const files: SearchInputFile[] = [{ path: "a.md", content }];
    const result = searchFiles("needle", files, { snippetContextChars: 10 });
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.truncatedStart).toBe(true);
    expect(ln.truncatedEnd).toBe(true);
    // 10 chars context + 6-char match + 10 chars context = 26.
    expect(ln.snippet).toHaveLength(26);
    expect(ln.snippet).toBe(`${"x".repeat(10)}NEEDLE${"y".repeat(10)}`);
  });

  it("returns the whole line untruncated when it fits the window", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "short needle line\n" },
    ];
    const result = searchFiles("needle", files, { snippetContextChars: 40 });
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.truncatedStart).toBe(false);
    expect(ln.truncatedEnd).toBe(false);
    expect(ln.snippet).toBe("short needle line");
  });

  it("recomputes ranges relative to a truncated snippet", () => {
    const left = "x".repeat(100);
    const content = `${left}NEEDLE tail\n`;
    const files: SearchInputFile[] = [{ path: "a.md", content }];
    const result = searchFiles("needle", files, { snippetContextChars: 5 });
    const ln = fileFor(result, "a.md")!.lines[0];
    // Snippet = 5 x's + NEEDLE + 5 chars of " tail".
    expect(ln.truncatedStart).toBe(true);
    expect(rangeText(ln.snippet, ln.ranges[0])).toBe("NEEDLE");
    expect(ln.ranges[0].start).toBe(5);
    expect(ln.ranges[0].end).toBe(11);
  });
});

describe("searchFiles — line numbers and line endings", () => {
  it("computes correct 1-based line numbers with \\n endings", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "one\ntwo target\nthree\n" },
    ];
    const result = searchFiles("target", files);
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.line).toBe(2);
    expect(ln.fileOffset).toBe("one\ntwo ".length);
  });

  it("treats \\r\\n as one line break and computes correct line numbers", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "one\r\ntwo target\r\nthree\r\n" },
    ];
    const result = searchFiles("target", files);
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.line).toBe(2);
  });

  it("does not let a trailing \\r leak into the snippet", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "alpha target\r\nnext\r\n" },
    ];
    const result = searchFiles("target", files);
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.snippet).toBe("alpha target");
    expect(ln.snippet.includes("\r")).toBe(false);
  });

  it("handles a bare trailing \\r with no following \\n", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "alpha target\r" },
    ];
    const result = searchFiles("target", files);
    const ln = fileFor(result, "a.md")!.lines[0];
    expect(ln.snippet).toBe("alpha target");
  });
});

describe("searchFiles — ranking", () => {
  it("sorts files by matchCount desc, then path asc", () => {
    const files: SearchInputFile[] = [
      { path: "low.md", content: "term once\n" },
      { path: "high.md", content: "term term term\n" },
      { path: "bbb.md", content: "term term\n" },
      { path: "aaa.md", content: "term term\n" },
    ];
    const result = searchFiles("term", files);
    expect(result.files.map((f) => f.path)).toEqual([
      "high.md", // 3
      "aaa.md", // 2, path asc before bbb
      "bbb.md", // 2
      "low.md", // 1
    ]);
  });
});

describe("searchFiles — per-file cap", () => {
  it("caps lines per file but matchCount reflects the true total", () => {
    const lines: string[] = [];
    for (let i = 0; i < 10; i++) lines.push(`line ${i} hit`);
    const files: SearchInputFile[] = [
      { path: "a.md", content: lines.join("\n") },
    ];
    const result = searchFiles("hit", files, { maxResultsPerFile: 3 });
    const f = fileFor(result, "a.md")!;
    expect(f.lines).toHaveLength(3);
    expect(f.matchCount).toBe(10);
    // Document order is preserved among the kept lines.
    expect(f.lines.map((l) => l.line)).toEqual([1, 2, 3]);
  });
});

describe("searchFiles — global cap", () => {
  it("caps total result lines across files and sets capped", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "hit\nhit\nhit\n" },
      { path: "b.md", content: "hit\nhit\nhit\n" },
    ];
    const result = searchFiles("hit", files, { maxTotalResults: 4 });
    const total = result.files.reduce((n, f) => n + f.lines.length, 0);
    expect(total).toBe(4);
    expect(result.capped).toBe(true);
    // totalMatches still counts every true occurrence (6), beyond the cap.
    expect(result.totalMatches).toBe(6);
  });

  it("does not set capped when everything fits", () => {
    const files: SearchInputFile[] = [{ path: "a.md", content: "hit\nhit\n" }];
    const result = searchFiles("hit", files, { maxTotalResults: 500 });
    expect(result.capped).toBe(false);
  });
});

describe("searchFiles — short / empty query", () => {
  it("returns empty for an empty query", () => {
    const result = searchFiles("", [{ path: "a.md", content: "anything" }]);
    expect(result).toEqual({
      query: "",
      files: [],
      totalMatches: 0,
      capped: false,
    });
  });

  it("returns empty for a whitespace-only query", () => {
    const result = searchFiles("   \n\t ", [
      { path: "a.md", content: "anything" },
    ]);
    expect(result.files).toEqual([]);
    expect(result.totalMatches).toBe(0);
  });

  it("returns empty for a single non-space character (below min length)", () => {
    const result = searchFiles("a", [{ path: "a.md", content: "a a a" }]);
    expect(result.files).toEqual([]);
  });

  it("matches at the two-character minimum", () => {
    const result = searchFiles("ab", [{ path: "a.md", content: "ab cd ab" }]);
    expect(fileFor(result, "a.md")!.matchCount).toBe(2);
  });
});

describe("searchFiles — totalMatches definition", () => {
  it("sums true matchCount across all included files", () => {
    const files: SearchInputFile[] = [
      { path: "a.md", content: "xy xy\n" },
      { path: "b.md", content: "xy xy xy\n" },
    ];
    const result = searchFiles("xy", files);
    expect(result.totalMatches).toBe(5);
  });
});
