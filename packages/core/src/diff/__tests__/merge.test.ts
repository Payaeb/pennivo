import { describe, it, expect } from "vitest";
import {
  applyMergeResolutions,
  computeMergeSegments,
  countHunks,
  mergeResolution,
  type MergeChoice,
} from "../merge";

describe("computeMergeSegments", () => {
  it("returns a single context segment when both inputs are identical", () => {
    const segs = computeMergeSegments("a\nb\nc", "a\nb\nc");
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("context");
    if (segs[0].kind === "context") {
      expect(segs[0].lines).toEqual(["a", "b", "c"]);
    }
    expect(countHunks(segs)).toBe(0);
  });

  it("returns a single context segment when both inputs are empty", () => {
    const segs = computeMergeSegments("", "");
    // Identical fast-path — 1 context segment with zero lines.
    expect(segs).toHaveLength(1);
    if (segs[0].kind === "context") expect(segs[0].lines).toEqual([]);
  });

  it("emits one hunk with right-only lines for a pure addition", () => {
    const segs = computeMergeSegments("a\nb", "a\nb\nc");
    expect(countHunks(segs)).toBe(1);
    const hunk = segs.find((s) => s.kind === "hunk");
    if (hunk?.kind === "hunk") {
      expect(hunk.hunk.leftLines).toEqual([]);
      expect(hunk.hunk.rightLines).toEqual(["c"]);
    }
  });

  it("emits one hunk with left-only lines for a pure deletion", () => {
    const segs = computeMergeSegments("a\nb\nc", "a\nb");
    expect(countHunks(segs)).toBe(1);
    const hunk = segs.find((s) => s.kind === "hunk");
    if (hunk?.kind === "hunk") {
      expect(hunk.hunk.leftLines).toEqual(["c"]);
      expect(hunk.hunk.rightLines).toEqual([]);
    }
  });

  it("emits multiple hunks when changes are separated by lots of context", () => {
    const left = ["a", "b", "X", "d", "e", "f", "g", "h", "Y", "j"].join("\n");
    const right = ["a", "b", "X1", "d", "e", "f", "g", "h", "Y1", "j"].join(
      "\n",
    );
    const segs = computeMergeSegments(left, right);
    expect(countHunks(segs)).toBe(2);
  });

  it("dense-indexes hunks starting from 0", () => {
    const segs = computeMergeSegments(
      "a\nX\nb\nc\nd\ne\nY\nf",
      "a\nX1\nb\nc\nd\ne\nY1\nf",
    );
    const hunks = segs.filter((s) => s.kind === "hunk");
    expect(hunks).toHaveLength(2);
    if (hunks[0].kind === "hunk") expect(hunks[0].hunk.index).toBe(0);
    if (hunks[1].kind === "hunk") expect(hunks[1].hunk.index).toBe(1);
  });

  it("normalizes CRLF the same way computeDiff does", () => {
    const segs = computeMergeSegments("a\r\nb\r\nc", "a\nb\nc");
    expect(segs).toHaveLength(1);
    expect(segs[0].kind).toBe("context");
  });
});

describe("applyMergeResolutions", () => {
  function resolveAll(
    segs: ReturnType<typeof computeMergeSegments>,
    choice: MergeChoice,
  ): Record<number, MergeChoice> {
    const out: Record<number, MergeChoice> = {};
    for (const s of segs) if (s.kind === "hunk") out[s.hunk.index] = choice;
    return out;
  }

  it("returns the unchanged input when there are no hunks", () => {
    const segs = computeMergeSegments("foo\nbar", "foo\nbar");
    expect(applyMergeResolutions(segs, {})).toBe("foo\nbar");
  });

  it("produces the left text when every hunk resolves left", () => {
    const left = "a\nB\nc";
    const right = "a\nx\nc";
    const segs = computeMergeSegments(left, right);
    const merged = applyMergeResolutions(segs, resolveAll(segs, "left"));
    expect(merged).toBe(left);
  });

  it("produces the right text when every hunk resolves right", () => {
    const left = "a\nB\nc";
    const right = "a\nx\nc";
    const segs = computeMergeSegments(left, right);
    const merged = applyMergeResolutions(segs, resolveAll(segs, "right"));
    expect(merged).toBe(right);
  });

  it("concatenates left then right for a 'both' resolution", () => {
    const left = "a\nB\nc";
    const right = "a\nx\nc";
    const segs = computeMergeSegments(left, right);
    const merged = applyMergeResolutions(segs, resolveAll(segs, "both"));
    expect(merged).toBe("a\nB\nx\nc");
  });

  it("uses the user-supplied edit text for an edit resolution", () => {
    const left = "a\nB\nc";
    const right = "a\nx\nc";
    const segs = computeMergeSegments(left, right);
    const merged = applyMergeResolutions(segs, {
      0: { kind: "edit", text: "EDITED" },
    });
    expect(merged).toBe("a\nEDITED\nc");
  });

  it("supports multi-line edited text", () => {
    const left = "a\nB\nc";
    const right = "a\nx\nc";
    const segs = computeMergeSegments(left, right);
    const merged = applyMergeResolutions(segs, {
      0: { kind: "edit", text: "line1\nline2\nline3" },
    });
    expect(merged).toBe("a\nline1\nline2\nline3\nc");
  });

  it("mixes resolutions across multiple hunks", () => {
    const left = ["a", "B1", "c", "d", "e", "f", "g", "B2", "h"].join("\n");
    const right = ["a", "X1", "c", "d", "e", "f", "g", "X2", "h"].join("\n");
    const segs = computeMergeSegments(left, right);
    const hunks = segs.filter((s) => s.kind === "hunk");
    expect(hunks).toHaveLength(2);
    const merged = applyMergeResolutions(segs, {
      0: "left",
      1: "right",
    });
    expect(merged).toBe(
      ["a", "B1", "c", "d", "e", "f", "g", "X2", "h"].join("\n"),
    );
  });

  it("throws when a hunk has no resolution", () => {
    const segs = computeMergeSegments("a\nB\nc", "a\nx\nc");
    expect(() => applyMergeResolutions(segs, {})).toThrow(/no resolution/);
  });
});

describe("mergeResolution (end-to-end)", () => {
  it("returns the unchanged base when there are no hunks", () => {
    expect(mergeResolution("hello", "hello", {})).toBe("hello");
  });

  it("a pure addition resolved as 'right' equals the right text", () => {
    expect(mergeResolution("a\nb", "a\nb\nc", { 0: "right" })).toBe("a\nb\nc");
  });

  it("a pure addition resolved as 'left' equals the left text", () => {
    expect(mergeResolution("a\nb", "a\nb\nc", { 0: "left" })).toBe("a\nb");
  });

  it("a pure deletion resolved as 'right' equals the right text", () => {
    expect(mergeResolution("a\nb\nc", "a\nb", { 0: "right" })).toBe("a\nb");
  });

  it("an edit choice swaps the hunk for arbitrary text", () => {
    const merged = mergeResolution("a\nB\nc", "a\nx\nc", {
      0: { kind: "edit", text: "user-typed" },
    });
    expect(merged).toBe("a\nuser-typed\nc");
  });
});
