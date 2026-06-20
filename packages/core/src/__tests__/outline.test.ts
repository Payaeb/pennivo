import { describe, it, expect } from "vitest";
import { extractOutline } from "../outline";

describe("extractOutline — levels and lines", () => {
  it("captures heading level, text, and 1-based line", () => {
    const content = "# Title\n\n## Section\n\ntext\n\n### Sub\n";
    expect(extractOutline(content)).toEqual([
      { level: 1, text: "Title", line: 1 },
      { level: 2, text: "Section", line: 3 },
      { level: 3, text: "Sub", line: 7 },
    ]);
  });

  it("supports all six levels", () => {
    const content = "# a\n## b\n### c\n#### d\n##### e\n###### f\n";
    const levels = extractOutline(content).map((h) => h.level);
    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("does not treat 7 hashes as a heading", () => {
    expect(extractOutline("####### too deep\n")).toEqual([]);
  });

  it("requires a space after the hashes", () => {
    expect(extractOutline("#nospace\n")).toEqual([]);
  });
});

describe("extractOutline — trailing hashes stripped", () => {
  it("strips a closing # sequence from the text", () => {
    const result = extractOutline("## Section ##\n");
    expect(result[0].text).toBe("Section");
  });

  it("strips a single trailing # too", () => {
    const result = extractOutline("# Title #\n");
    expect(result[0].text).toBe("Title");
  });
});

describe("extractOutline — fenced code blocks ignored", () => {
  it("ignores # inside a ``` fence", () => {
    const content = "# Real\n\n```\n# not a heading\n```\n\n## After\n";
    expect(extractOutline(content)).toEqual([
      { level: 1, text: "Real", line: 1 },
      { level: 2, text: "After", line: 7 },
    ]);
  });

  it("ignores # inside a ~~~ fence", () => {
    const content = "# Real\n~~~\n### nope\n~~~\n## After\n";
    expect(extractOutline(content)).toEqual([
      { level: 1, text: "Real", line: 1 },
      { level: 2, text: "After", line: 5 },
    ]);
  });

  it("ignores # inside an indented fence", () => {
    const content = "# Real\n   ```\n# nope\n   ```\n## After\n";
    const texts = extractOutline(content).map((h) => h.text);
    expect(texts).toEqual(["Real", "After"]);
  });
});

describe("extractOutline — no headings", () => {
  it("returns an empty array when there are no headings", () => {
    expect(extractOutline("just prose\n\nmore prose\n")).toEqual([]);
  });

  it("returns an empty array for empty content", () => {
    expect(extractOutline("")).toEqual([]);
  });
});
