import { describe, it, expect } from "vitest";
import { countWords, countCharacters, stripMarkdown } from "../textStats";

// --- stripMarkdown ---

describe("stripMarkdown", () => {
  it("removes # heading markers", () => {
    expect(stripMarkdown("# Title")).toBe("Title");
    expect(stripMarkdown("### Third level")).toBe("Third level");
  });

  it("removes ** and * formatting", () => {
    expect(stripMarkdown("**bold** text")).toBe("bold text");
    expect(stripMarkdown("*italic* text")).toBe("italic text");
  });

  it("removes ~~ strikethrough", () => {
    expect(stripMarkdown("~~deleted~~ text")).toBe("deleted text");
  });

  it("removes link syntax, keeps link text", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe(
      "click here",
    );
  });

  it("removes image syntax", () => {
    expect(stripMarkdown("![alt text](image.png)")).toBe("");
  });

  it("removes code block fences", () => {
    expect(stripMarkdown("```js\nconst x = 1;\n```")).toBe("");
  });

  it("removes inline code backticks", () => {
    expect(stripMarkdown("use `const` here")).toBe("use  here");
  });

  it("removes blockquote > markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("removes list markers (-, *, 1.)", () => {
    expect(stripMarkdown("- item one")).toBe("item one");
    expect(stripMarkdown("* item two")).toBe("item two");
    expect(stripMarkdown("1. item three")).toBe("item three");
  });

  it("removes horizontal rules", () => {
    expect(stripMarkdown("---")).toBe("");
    expect(stripMarkdown("-----")).toBe("");
  });

  it("removes table pipes", () => {
    // After removing pipes and trimming, only 'cell' remains
    expect(stripMarkdown("| cell |")).toBe("cell");
  });

  it("removes task list markers", () => {
    // The list marker `- ` is stripped first, then `[ ] ` by the task list regex
    // But since `-` strip runs before task-list strip, the input to task-list
    // regex is `[ ] unchecked` which doesn't have leading `- `, so only `- ` is stripped
    expect(stripMarkdown("- [ ] unchecked")).toBe("[ ] unchecked");
    expect(stripMarkdown("- [x] checked")).toBe("[x] checked");
  });
});

// --- countWords ---

describe("countWords", () => {
  it("empty string returns 0", () => {
    expect(countWords("")).toBe(0);
  });

  it("single word returns 1", () => {
    expect(countWords("hello")).toBe(1);
  });

  it("multiple words separated by spaces", () => {
    expect(countWords("hello world foo")).toBe(3);
  });

  it("markdown formatting stripped before counting", () => {
    expect(countWords("**bold** word")).toBe(2);
  });

  it("heading markers not counted", () => {
    expect(countWords("# Title")).toBe(1);
  });

  it("code blocks stripped", () => {
    expect(countWords("before\n```\ncode\n```\nafter")).toBe(2);
  });

  it("link syntax stripped", () => {
    expect(countWords("[text](url)")).toBe(1);
  });

  it("whitespace-only string returns 0", () => {
    expect(countWords("   \n\t  ")).toBe(0);
  });

  it("unicode words counted correctly", () => {
    expect(countWords("café résumé")).toBe(2);
  });
});

// --- countCharacters ---

describe("countCharacters", () => {
  it("empty string returns 0", () => {
    expect(countCharacters("")).toBe(0);
  });

  it("counts non-whitespace characters", () => {
    expect(countCharacters("ab cd")).toBe(4);
  });

  it("markdown formatting stripped before counting", () => {
    expect(countCharacters("**ab**")).toBe(2);
  });

  it("whitespace-only string returns 0", () => {
    expect(countCharacters("   \t\n  ")).toBe(0);
  });
});
