import { describe, it, expect } from "vitest";
import { splitStableDeferred } from "../deferredTokens";

describe("splitStableDeferred — empty and trivial", () => {
  it("returns empty stable and deferred for an empty string", () => {
    expect(splitStableDeferred("")).toEqual({ stable: "", deferred: "" });
  });

  it("keeps a fully complete multi-paragraph doc entirely stable", () => {
    const md = "# Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });
});

describe("splitStableDeferred — fenced code blocks", () => {
  it("defers from the opening ``` fence when it is still open", () => {
    const md = "Intro paragraph.\n\n```js\nconst x = 1;\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Intro paragraph.\n\n");
    expect(deferred).toBe("```js\nconst x = 1;\n");
  });

  it("keeps a closed ``` fence fully stable", () => {
    const md = "Intro.\n\n```js\nconst x = 1;\n```\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });

  it("defers from an open ~~~ fence", () => {
    const md = "Intro.\n\n~~~\nraw text here\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Intro.\n\n");
    expect(deferred).toBe("~~~\nraw text here\n");
  });

  it("keeps a closed ~~~ fence fully stable", () => {
    const md = "Intro.\n\n~~~\nraw text\n~~~\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });
});

describe("splitStableDeferred — inline emphasis and code", () => {
  it("defers a last line with an unbalanced ** run", () => {
    const md = "Done paragraph.\n\nHere is **bold start";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Done paragraph.\n\n");
    expect(deferred).toBe("Here is **bold start");
  });

  it("keeps a last line with balanced ** stable", () => {
    const md = "Para.\n\nHere is **bold** done.\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });

  it("defers a last line with an unbalanced backtick", () => {
    const md = "Para.\n\nUse `code here";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("Use `code here");
  });

  it("defers an unbalanced single * emphasis", () => {
    const md = "Para.\n\nThis is *emphasis";
    const { deferred } = splitStableDeferred(md);
    expect(deferred).toBe("This is *emphasis");
  });
});

describe("splitStableDeferred — links and images", () => {
  it("defers an incomplete inline link [text](", () => {
    const md = "Para.\n\nSee [the docs](";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("See [the docs](");
  });

  it("keeps a complete inline link [text](url) stable", () => {
    const md = "Para.\n\nSee [the docs](https://x.test/page) now.\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });

  it("defers an incomplete image ![alt](", () => {
    const md = "Para.\n\n![a cat](http://x.test/c";
    const { deferred } = splitStableDeferred(md);
    expect(deferred).toBe("![a cat](http://x.test/c");
  });

  it("defers a dangling reference-style label [text]", () => {
    const md = "Para.\n\nThis links to [the spec]";
    const { deferred } = splitStableDeferred(md);
    expect(deferred).toBe("This links to [the spec]");
  });
});

describe("splitStableDeferred — tables", () => {
  it("defers a mid-construct table (header only)", () => {
    const md = "Para.\n\n| Name | Age |\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("| Name | Age |\n");
  });

  it("defers a table with only a partial delimiter row", () => {
    const md = "Para.\n\n| Name | Age |\n| ---";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("| Name | Age |\n| ---");
  });

  it("keeps a complete table (header + delimiter) stable", () => {
    const md = "Para.\n\n| Name | Age |\n| --- | --- |\n| Ann | 30 |\n";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });
});

describe("splitStableDeferred — trailing line without newline", () => {
  it("keeps a complete trailing paragraph line stable even without newline", () => {
    const md = "Para one.\n\nA finished sentence here.";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe(md);
    expect(deferred).toBe("");
  });

  it("defers a trailing fence-opener line with no newline", () => {
    const md = "Para.\n\n```";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("```");
  });

  it("defers a trailing lone pipe line with no newline", () => {
    const md = "Para.\n\n| col a | col b";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable).toBe("Para.\n\n");
    expect(deferred).toBe("| col a | col b");
  });
});

describe("splitStableDeferred — conservative defer (never render too eagerly)", () => {
  it("never returns a deferred fragment that overlaps the stable text", () => {
    const md = "A.\n\nB.\n\n```js\nopen";
    const { stable, deferred } = splitStableDeferred(md);
    expect(stable + deferred).toBe(md);
  });

  it("always reconstructs the original input from stable + deferred", () => {
    const samples = [
      "",
      "plain",
      "x\n\n**open",
      "x\n\n```\ncode\n```\n",
      "x\n\n| a | b |\n",
      "x\n\n[label](",
    ];
    for (const s of samples) {
      const { stable, deferred } = splitStableDeferred(s);
      expect(stable + deferred).toBe(s);
    }
  });
});
