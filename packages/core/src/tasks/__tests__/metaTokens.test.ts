import { describe, it, expect } from "vitest";
import { scanMetaTokens } from "../metaTokens";

describe("scanMetaTokens — empty / no tokens", () => {
  it("returns an empty array for an empty string", () => {
    expect(scanMetaTokens("")).toEqual([]);
  });

  it("returns an empty array for text with no tokens", () => {
    expect(scanMetaTokens("just some plain text, nothing special")).toEqual([]);
  });
});

describe("scanMetaTokens — tag position", () => {
  it("finds a tag at the start of the string", () => {
    const text = "#start rest of the line";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "label", value: "start" });
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe("#start");
  });

  it("finds a tag in the middle of the string", () => {
    const text = "before #mid after";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "label", value: "mid" });
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe("#mid");
  });

  it("finds a tag at the end of the string", () => {
    const text = "the end has a #tag";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "label", value: "tag" });
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe("#tag");
    expect(tokens[0]!.end).toBe(text.length);
  });
});

describe("scanMetaTokens — tag charset rules (parity with extractTaskItems)", () => {
  it("rejects an all-digit token (#2026 is not a tag)", () => {
    expect(scanMetaTokens("meet in #2026 sometime")).toEqual([]);
  });

  it("accepts a tag with letters, digits, and a dash", () => {
    const tokens = scanMetaTokens("plan #q3-goals review");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.value).toBe("q3-goals");
  });

  it("does not match a # preceded by a word character (foo#bar)", () => {
    expect(scanMetaTokens("see foo#bar here")).toEqual([]);
  });

  it("does not match a URL fragment like https://x.com/#frag", () => {
    expect(scanMetaTokens("read https://x.com/#frag for details")).toEqual([]);
  });

  it("does not dedupe repeated tags — one token per occurrence", () => {
    const tokens = scanMetaTokens("#beta start then #alpha then #beta again");
    expect(
      tokens.filter((t) => t.kind === "label").map((t) => t.value),
    ).toEqual(["beta", "alpha", "beta"]);
  });
});

describe("scanMetaTokens — due field spacing", () => {
  it("parses a plain due field", () => {
    const text = "ship it [due:: 2026-10-15]";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: "due", value: "2026-10-15" });
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe(
      "[due:: 2026-10-15]",
    );
  });

  it("tolerates no space after the double colon", () => {
    const tokens = scanMetaTokens("ship it [due::2026-10-15]");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.value).toBe("2026-10-15");
  });

  it("tolerates extra spaces around 'due', the colons, and the date", () => {
    const text = "ship it [due ::  2026-10-15  ]";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.value).toBe("2026-10-15");
    // datePart must bound exactly the date digits, excluding the padding.
    const dp = tokens[0]!.datePart!;
    expect(text.slice(dp.start, dp.end)).toBe("2026-10-15");
  });
});

describe("scanMetaTokens — due field validation", () => {
  it("rejects a non-date value, yielding no token", () => {
    expect(scanMetaTokens("ship it [due:: tomorrow]")).toEqual([]);
  });

  it("rejects an invalid calendar date (month 13), yielding no token", () => {
    expect(scanMetaTokens("ship it [due:: 2026-13-45]")).toEqual([]);
  });

  it("rejects Feb 30 as an invalid calendar date", () => {
    expect(scanMetaTokens("ship it [due:: 2026-02-30]")).toEqual([]);
  });
});

describe("scanMetaTokens — due field datePart range", () => {
  it("datePart excludes the [due:: and ] syntax", () => {
    const text = "a [due:: 2026-10-15] b";
    const tokens = scanMetaTokens(text);
    const token = tokens[0]!;
    const dp = token.datePart!;
    expect(text.slice(token.start, dp.start)).toBe("[due:: ");
    expect(text.slice(dp.start, dp.end)).toBe("2026-10-15");
    expect(text.slice(dp.end, token.end)).toBe("]");
  });
});

describe("scanMetaTokens — multiple tokens on one line", () => {
  it("returns a label and a due token with correct, non-overlapping ranges", () => {
    const text = "Write report #work [due:: 2026-10-15] for client";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(2);

    const label = tokens.find((t) => t.kind === "label")!;
    expect(label.value).toBe("work");
    expect(text.slice(label.start, label.end)).toBe("#work");

    const due = tokens.find((t) => t.kind === "due")!;
    expect(due.value).toBe("2026-10-15");
    expect(text.slice(due.start, due.end)).toBe("[due:: 2026-10-15]");

    // Ranges must not overlap and must be sorted by start.
    expect(tokens[0]!.start).toBeLessThan(tokens[1]!.start);
    expect(tokens[0]!.end).toBeLessThanOrEqual(tokens[1]!.start);
  });

  it("returns every due field on a line (unlike extractTaskItems' first-wins due rule)", () => {
    const text = "a [due:: 2026-10-15] b [due:: 2026-11-01] c";
    const tokens = scanMetaTokens(text);
    const dueTokens = tokens.filter((t) => t.kind === "due");
    expect(dueTokens.map((t) => t.value)).toEqual(["2026-10-15", "2026-11-01"]);
  });

  it("returns multiple labels in order alongside a due token", () => {
    const text = "#alpha work on this [due:: 2026-10-15] #beta";
    const tokens = scanMetaTokens(text);
    expect(tokens.map((t) => t.kind)).toEqual(["label", "due", "label"]);
    expect(tokens.map((t) => t.value)).toEqual(["alpha", "2026-10-15", "beta"]);
  });
});

describe("scanMetaTokens — unicode", () => {
  it("accepts a unicode tag and reports correct char-index ranges", () => {
    const text = "écrire #café aujourd'hui";
    const tokens = scanMetaTokens(text);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.value).toBe("café");
    expect(text.slice(tokens[0]!.start, tokens[0]!.end)).toBe("#café");
  });

  it("reports ranges correctly for a tag following unicode text and a due field", () => {
    const text = "note: 日本語 #タグ then [due:: 2026-10-15]";
    const tokens = scanMetaTokens(text);
    const label = tokens.find((t) => t.kind === "label")!;
    expect(label.value).toBe("タグ");
    expect(text.slice(label.start, label.end)).toBe("#タグ");

    const due = tokens.find((t) => t.kind === "due")!;
    expect(text.slice(due.start, due.end)).toBe("[due:: 2026-10-15]");
  });
});
