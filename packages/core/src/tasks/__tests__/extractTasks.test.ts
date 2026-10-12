import { describe, it, expect } from "vitest";
import { extractTaskItems } from "../extractTasks";

describe("extractTaskItems — markers", () => {
  it.each([
    ["- [ ] dash", "-"],
    ["* [ ] star", "*"],
    ["+ [ ] plus", "+"],
    ["1. [ ] ordered dot", "1."],
    ["1) [ ] ordered paren", "1)"],
    ["23. [ ] multi-digit dot", "23."],
    ["23) [ ] multi-digit paren", "23)"],
  ])("recognizes a %j task line", (line) => {
    const items = extractTaskItems(line, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].checked).toBe(false);
  });

  it("ignores a line that is not a checklist item", () => {
    expect(extractTaskItems("just a paragraph\n", "a.md")).toEqual([]);
    expect(extractTaskItems("- a plain bullet\n", "a.md")).toEqual([]);
    expect(extractTaskItems("1. a plain ordered item\n", "a.md")).toEqual([]);
  });
});

describe("extractTaskItems — checked state", () => {
  it("treats [x] and [X] as checked", () => {
    const items = extractTaskItems("- [x] lower\n- [X] upper\n", "a.md");
    expect(items).toHaveLength(2);
    expect(items[0].checked).toBe(true);
    expect(items[1].checked).toBe(true);
  });

  it("treats [ ] as unchecked", () => {
    const items = extractTaskItems("- [ ] todo\n", "a.md");
    expect(items[0].checked).toBe(false);
  });
});

describe("extractTaskItems — nesting / indent", () => {
  it("reports the leading-indentation count at various depths", () => {
    const content = [
      "- [ ] depth 0",
      "  - [ ] depth 2",
      "    - [ ] depth 4",
      "      - [ ] depth 6",
    ].join("\n");
    const items = extractTaskItems(content, "a.md");
    expect(items.map((i) => i.indent)).toEqual([0, 2, 4, 6]);
  });
});

describe("extractTaskItems — line numbers and charOffset", () => {
  it("assigns 0-based line numbers", () => {
    const content = "para\n- [ ] first\npara\n- [x] second\n";
    const items = extractTaskItems(content, "a.md");
    expect(items.map((i) => i.line)).toEqual([1, 3]);
  });

  it("computes the absolute char offset of each task line's start", () => {
    const content = "abc\n- [ ] task\n";
    const items = extractTaskItems(content, "a.md");
    expect(items[0].charOffset).toBe("abc\n".length);
  });

  it("stamps the given path onto every item", () => {
    const items = extractTaskItems("- [ ] x\n", "notes/todo.md");
    expect(items[0].path).toBe("notes/todo.md");
  });
});

describe("extractTaskItems — CRLF line endings", () => {
  it("does not leak \\r into rawText/displayText and keeps correct line numbers", () => {
    const content = "- [ ] first item\r\n- [x] second #tag\r\n";
    const items = extractTaskItems(content, "a.md");
    expect(items).toHaveLength(2);
    expect(items[0].line).toBe(0);
    expect(items[0].rawText).toBe("first item");
    expect(items[0].rawText.includes("\r")).toBe(false);
    expect(items[1].line).toBe(1);
    expect(items[1].labels).toEqual(["tag"]);
  });

  it("computes correct charOffset across CRLF lines", () => {
    const content = "abc\r\n- [ ] task\r\n";
    const items = extractTaskItems(content, "a.md");
    expect(items[0].charOffset).toBe("abc\r\n".length);
  });
});

describe("extractTaskItems — fenced code blocks", () => {
  it("skips a checklist line inside a ``` fence", () => {
    const content = ["```", "- [ ] inside fence", "```", "- [ ] outside"].join(
      "\n",
    );
    const items = extractTaskItems(content, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].rawText).toBe("outside");
  });

  it("skips a checklist line inside a ~~~ fence", () => {
    const content = ["~~~", "- [ ] inside fence", "~~~", "- [ ] outside"].join(
      "\n",
    );
    const items = extractTaskItems(content, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].rawText).toBe("outside");
  });

  it("treats an unclosed fence as open to EOF, suppressing everything after it", () => {
    const content = ["- [ ] before", "```", "- [ ] never closed"].join("\n");
    const items = extractTaskItems(content, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].rawText).toBe("before");
  });
});

describe("extractTaskItems — inline code span suppresses tags", () => {
  it("ignores a #tag-looking token inside an inline code span", () => {
    const items = extractTaskItems(
      "- [ ] run `git #not-a-tag` then ship #real\n",
      "a.md",
    );
    expect(items[0].labels).toEqual(["real"]);
  });
});

describe("extractTaskItems — tag charset rules", () => {
  it("rejects an all-digit token (#2026 is not a tag)", () => {
    const items = extractTaskItems("- [ ] meet in #2026 sometime\n", "a.md");
    expect(items[0].labels).toEqual([]);
  });

  it("accepts a tag with letters, digits, and a dash", () => {
    const items = extractTaskItems("- [ ] plan #q3-goals review\n", "a.md");
    expect(items[0].labels).toEqual(["q3-goals"]);
  });

  it("does not match a # preceded by a word character (foo#bar)", () => {
    const items = extractTaskItems("- [ ] see foo#bar here\n", "a.md");
    expect(items[0].labels).toEqual([]);
  });

  it("does not match a URL fragment like https://x.com/#frag", () => {
    const items = extractTaskItems(
      "- [ ] read https://x.com/#frag for details\n",
      "a.md",
    );
    expect(items[0].labels).toEqual([]);
  });

  it("accepts a unicode tag", () => {
    const items = extractTaskItems("- [ ] écrire #café aujourd'hui\n", "a.md");
    expect(items[0].labels).toEqual(["café"]);
  });
});

describe("extractTaskItems — label dedupe and order", () => {
  it("dedupes repeated labels and preserves first-appearance order", () => {
    const items = extractTaskItems(
      "- [ ] #beta start then #alpha then #beta again\n",
      "a.md",
    );
    expect(items[0].labels).toEqual(["beta", "alpha"]);
  });
});

describe("extractTaskItems — due date parsing", () => {
  it("parses a plain due field", () => {
    const items = extractTaskItems(
      "- [ ] ship it [due:: 2026-10-15]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-15");
  });

  it("tolerates no space after the double colon", () => {
    const items = extractTaskItems("- [ ] ship it [due::2026-10-15]\n", "a.md");
    expect(items[0].due).toBe("2026-10-15");
  });

  it("tolerates extra spaces around 'due' and the colons", () => {
    const items = extractTaskItems(
      "- [ ] ship it [due ::  2026-10-15]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-15");
  });

  it("treats an invalid calendar date as absent, silently", () => {
    const items = extractTaskItems(
      "- [ ] ship it [due:: 2026-13-45]\n",
      "a.md",
    );
    expect(items[0].due).toBeNull();
  });

  it("treats non-date text as absent, silently", () => {
    const items = extractTaskItems("- [ ] ship it [due:: tomorrow]\n", "a.md");
    expect(items[0].due).toBeNull();
  });

  it("rejects Feb 30 as an invalid calendar date", () => {
    const items = extractTaskItems(
      "- [ ] ship it [due:: 2026-02-30]\n",
      "a.md",
    );
    expect(items[0].due).toBeNull();
  });

  it("has due null when no field is present", () => {
    const items = extractTaskItems("- [ ] just a task\n", "a.md");
    expect(items[0].due).toBeNull();
  });

  it("first due field wins; later ones on the same line are ignored", () => {
    const items = extractTaskItems(
      "- [ ] a [due:: 2026-10-15] b [due:: 2026-11-01]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-15");
  });

  it("still ignores a later field even when the first one is invalid", () => {
    const items = extractTaskItems(
      "- [ ] a [due:: 2026-13-45] b [due:: 2026-11-01]\n",
      "a.md",
    );
    expect(items[0].due).toBeNull();
  });
});

describe("extractTaskItems — displayText", () => {
  it("strips the due field and collapses whitespace but keeps labels", () => {
    const items = extractTaskItems(
      "- [ ] Write report #work [due:: 2026-10-15] for client\n",
      "a.md",
    );
    expect(items[0].rawText).toBe(
      "Write report #work [due:: 2026-10-15] for client",
    );
    expect(items[0].displayText).toBe("Write report #work for client");
  });

  it("strips every due field occurrence from displayText, not just the first", () => {
    const items = extractTaskItems(
      "- [ ] a [due:: 2026-10-15] b [due:: 2026-11-01] c\n",
      "a.md",
    );
    expect(items[0].displayText).toBe("a b c");
  });

  it("collapses to an empty string for an item with no text", () => {
    const items = extractTaskItems("- [ ]\n", "a.md");
    expect(items[0].rawText).toBe("");
    expect(items[0].displayText).toBe("");
  });

  it("handles a bare checkbox with a trailing space and nothing else", () => {
    const items = extractTaskItems("- [ ] \n", "a.md");
    expect(items[0].rawText).toBe("");
    expect(items[0].displayText).toBe("");
  });
});

describe("extractTaskItems — done date parsing", () => {
  it("parses a plain done field", () => {
    const items = extractTaskItems(
      "- [x] shipped it [done:: 2026-10-15]\n",
      "a.md",
    );
    expect(items[0].done).toBe("2026-10-15");
  });

  it("has done null when no field is present", () => {
    const items = extractTaskItems("- [x] shipped it\n", "a.md");
    expect(items[0].done).toBeNull();
  });

  it("treats an invalid calendar date as absent, silently", () => {
    const items = extractTaskItems(
      "- [x] shipped it [done:: 2026-13-45]\n",
      "a.md",
    );
    expect(items[0].done).toBeNull();
  });

  it("is independent of checked — an unchecked item can still carry a stale done field", () => {
    const items = extractTaskItems(
      "- [ ] reopened [done:: 2026-10-01]\n",
      "a.md",
    );
    expect(items[0].checked).toBe(false);
    expect(items[0].done).toBe("2026-10-01");
  });

  it("strips the done field from displayText but keeps due and labels", () => {
    const items = extractTaskItems(
      "- [x] Ship it #work [due:: 2026-10-15] [done:: 2026-10-16]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-15");
    expect(items[0].done).toBe("2026-10-16");
    expect(items[0].labels).toEqual(["work"]);
    expect(items[0].displayText).toBe("Ship it #work");
  });
});

describe("extractTaskItems — escaped bracket form (\\[due::, \\[done::)", () => {
  it("parses a due field whose opening bracket was backslash-escaped on disk", () => {
    const items = extractTaskItems(
      "- [ ] ship it \\[due:: 2026-10-15]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-15");
    expect(items[0].displayText).toBe("ship it");
    expect(items[0].displayText.includes("\\")).toBe(false);
  });

  it("parses a done field whose opening bracket was backslash-escaped on disk", () => {
    const items = extractTaskItems(
      "- [x] shipped it \\[done:: 2026-10-15]\n",
      "a.md",
    );
    expect(items[0].done).toBe("2026-10-15");
    expect(items[0].displayText).toBe("shipped it");
    expect(items[0].displayText.includes("\\")).toBe(false);
  });

  it("handles escaped due and done together with a label, stripping all syntax cleanly", () => {
    const items = extractTaskItems(
      "- [x] Ship #work \\[due:: 2026-10-10] \\[done:: 2026-10-12]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-10");
    expect(items[0].done).toBe("2026-10-12");
    expect(items[0].labels).toEqual(["work"]);
    expect(items[0].displayText).toBe("Ship #work");
  });
});

describe("extractTaskItems — empty input / no tasks", () => {
  it("returns an empty array for an empty file", () => {
    expect(extractTaskItems("", "a.md")).toEqual([]);
  });

  it("returns an empty array for a file with no tasks at all", () => {
    const content = "# Heading\n\nSome paragraph text.\n- a plain bullet\n";
    expect(extractTaskItems(content, "a.md")).toEqual([]);
  });

  it("never throws on pathological input", () => {
    expect(() => extractTaskItems("```\n```\n```\n", "a.md")).not.toThrow();
    expect(() => extractTaskItems("- [ ] [due:: ]\n", "a.md")).not.toThrow();
  });
});

describe("extractTaskItems — HTML character references", () => {
  it("does not read &#x20; as a label", () => {
    const items = extractTaskItems("- [ ] &#x20;text\n", "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual([]);
  });
});
