import { describe, it, expect } from "vitest";
import { extractLabeledItems } from "../extractLabeled";

describe("extractLabeledItems — basic extraction", () => {
  it("extracts a plain bullet with a label", () => {
    const items = extractLabeledItems("- Big rewrite idea #ideas\n", "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual(["ideas"]);
    expect(items[0].displayText).toBe("Big rewrite idea #ideas");
  });

  it("extracts a plain ordered item with a label", () => {
    const items = extractLabeledItems("1. Research topic #research\n", "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual(["research"]);
  });

  it.each(["-", "*", "+"])("recognizes the %j bullet marker", (marker) => {
    const items = extractLabeledItems(`${marker} idea #tag\n`, "a.md");
    expect(items).toHaveLength(1);
  });

  it("skips a plain bullet with no label at all", () => {
    expect(extractLabeledItems("- just a plain bullet\n", "a.md")).toEqual([]);
  });

  it("indexes a dated plain bullet with no label (labels: [])", () => {
    const items = extractLabeledItems(
      "- Renew passport [due:: 2026-10-20]\n- just text\n",
      "a.md",
    );
    expect(items).toHaveLength(1);
    expect(items[0].labels).toEqual([]);
    expect(items[0].due).toBe("2026-10-20");
    expect(items[0].displayText).toBe("Renew passport");
  });

  it("returns an empty array for a file with no list items", () => {
    expect(
      extractLabeledItems("# Heading\n\nJust a paragraph #tag.\n", "a.md"),
    ).toEqual([]);
  });

  it("returns an empty array for an empty file", () => {
    expect(extractLabeledItems("", "a.md")).toEqual([]);
  });
});

describe("extractLabeledItems — checklist items are never duplicated", () => {
  it("skips a checked/unchecked checklist line even when it carries a label", () => {
    const content = [
      "- [ ] todo item #work",
      "- [x] done item #work",
      "- plain bullet #work",
    ].join("\n");
    const items = extractLabeledItems(content, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].displayText).toBe("plain bullet #work");
  });
});

describe("extractLabeledItems — multiple labels and dedupe", () => {
  it("captures every label on the line, deduped, first-appearance order", () => {
    const items = extractLabeledItems(
      "- #beta idea then #alpha then #beta again\n",
      "a.md",
    );
    expect(items[0].labels).toEqual(["beta", "alpha"]);
  });
});

describe("extractLabeledItems — due field on a plain bullet", () => {
  it("parses a due field on a labeled plain bullet", () => {
    const items = extractLabeledItems(
      "- Renew passport #errands [due:: 2026-10-20]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-20");
    expect(items[0].displayText).toBe("Renew passport #errands");
  });

  it("handles the escaped bracket form on a plain bullet", () => {
    const items = extractLabeledItems(
      "- Renew passport #errands \\[due:: 2026-10-20]\n",
      "a.md",
    );
    expect(items[0].due).toBe("2026-10-20");
    expect(items[0].displayText).toBe("Renew passport #errands");
    expect(items[0].displayText.includes("\\")).toBe(false);
  });

  it("has due null when no field is present", () => {
    const items = extractLabeledItems("- idea #ideas\n", "a.md");
    expect(items[0].due).toBeNull();
  });
});

describe("extractLabeledItems — nesting / indent", () => {
  it("reports the leading-indentation count at various depths", () => {
    const content = [
      "- #top depth 0",
      "  - #nested depth 2",
      "    - #deep depth 4",
    ].join("\n");
    const items = extractLabeledItems(content, "a.md");
    expect(items.map((i) => i.indent)).toEqual([0, 2, 4]);
  });
});

describe("extractLabeledItems — line numbers and charOffset", () => {
  it("assigns 0-based line numbers", () => {
    const content = "para\n- first #a\npara\n- second #b\n";
    const items = extractLabeledItems(content, "a.md");
    expect(items.map((i) => i.line)).toEqual([1, 3]);
  });

  it("computes the absolute char offset of each item line's start", () => {
    const content = "abc\n- item #tag\n";
    const items = extractLabeledItems(content, "a.md");
    expect(items[0].charOffset).toBe("abc\n".length);
  });

  it("stamps the given path onto every item", () => {
    const items = extractLabeledItems("- idea #x\n", "notes/todo.md");
    expect(items[0].path).toBe("notes/todo.md");
  });
});

describe("extractLabeledItems — fenced code blocks", () => {
  it("skips a bullet with a label inside a ``` fence", () => {
    const content = [
      "```",
      "- inside fence #tag",
      "```",
      "- outside #tag",
    ].join("\n");
    const items = extractLabeledItems(content, "a.md");
    expect(items).toHaveLength(1);
    expect(items[0].displayText).toBe("outside #tag");
  });

  it("skips a bullet with a label inside a ~~~ fence", () => {
    const content = [
      "~~~",
      "- inside fence #tag",
      "~~~",
      "- outside #tag",
    ].join("\n");
    const items = extractLabeledItems(content, "a.md");
    expect(items).toHaveLength(1);
  });
});

describe("extractLabeledItems — inline code span suppresses tags", () => {
  it("ignores a #tag-looking token inside an inline code span", () => {
    const items = extractLabeledItems(
      "- run `git #not-a-tag` then ship #real\n",
      "a.md",
    );
    expect(items[0].labels).toEqual(["real"]);
  });
});

describe("extractLabeledItems — tag charset rules (parity with extractTaskItems)", () => {
  it("rejects an all-digit token (#2026 is not a tag)", () => {
    expect(extractLabeledItems("- meet in #2026 sometime\n", "a.md")).toEqual(
      [],
    );
  });

  it("does not match a # preceded by a word character (foo#bar)", () => {
    expect(extractLabeledItems("- see foo#bar here\n", "a.md")).toEqual([]);
  });

  it("accepts a unicode tag", () => {
    const items = extractLabeledItems("- écrire #café aujourd'hui\n", "a.md");
    expect(items[0].labels).toEqual(["café"]);
  });
});

describe("extractLabeledItems — never throws", () => {
  it("never throws on pathological input", () => {
    expect(() => extractLabeledItems("```\n```\n```\n", "a.md")).not.toThrow();
    expect(() => extractLabeledItems("- [due:: ]\n", "a.md")).not.toThrow();
  });
});

describe("extractLabeledItems — HTML character references", () => {
  it("does not index a bullet whose only #-text is &#x20;", () => {
    expect(extractLabeledItems("- &#x20;text\n", "a.md")).toEqual([]);
  });
});

describe("extractLabeledItems — due inside inline code", () => {
  it("does not index a doc bullet whose only due field is in backticks", () => {
    expect(
      extractLabeledItems("- use `[due:: 2020-01-01]` syntax\n", "a.md"),
    ).toEqual([]);
  });

  it("keeps the code span intact and still parses a real field", () => {
    const items = extractLabeledItems(
      "- use `[due:: 2020-01-01]` #docs [due:: 2026-10-20]\n",
      "a.md",
    );
    expect(items).toHaveLength(1);
    expect(items[0].due).toBe("2026-10-20");
    expect(items[0].displayText).toBe("use `[due:: 2020-01-01]` #docs");
  });
});
