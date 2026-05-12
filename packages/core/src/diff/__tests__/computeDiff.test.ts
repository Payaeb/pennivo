import { describe, it, expect } from "vitest";
import { computeDiff } from "../computeDiff";

describe("computeDiff", () => {
  it("returns unchanged=true with empty hunks for byte-identical input", () => {
    const r = computeDiff("hello\nworld\n", "hello\nworld\n");
    expect(r.unchanged).toBe(true);
    expect(r.hunks).toEqual([]);
    expect(r.addedLines).toBe(0);
    expect(r.removedLines).toBe(0);
  });

  it("treats CRLF and LF as equivalent (no spurious diff)", () => {
    const r = computeDiff("a\r\nb\r\nc", "a\nb\nc");
    expect(r.unchanged).toBe(true);
  });

  it("flags every line as `add` when oldText is empty", () => {
    const r = computeDiff("", "one\ntwo\nthree");
    expect(r.unchanged).toBe(false);
    expect(r.removedLines).toBe(0);
    expect(r.addedLines).toBeGreaterThanOrEqual(3);
    const allLines = r.hunks.flatMap((h) => h.lines);
    expect(allLines.find((l) => l.kind === "add" && l.text === "one")).toBeTruthy();
    expect(allLines.find((l) => l.kind === "add" && l.text === "two")).toBeTruthy();
    expect(allLines.find((l) => l.kind === "add" && l.text === "three")).toBeTruthy();
  });

  it("flags every line as `remove` when newText is empty", () => {
    const r = computeDiff("one\ntwo\nthree", "");
    expect(r.unchanged).toBe(false);
    expect(r.addedLines).toBe(0);
    expect(r.removedLines).toBeGreaterThanOrEqual(3);
    const allLines = r.hunks.flatMap((h) => h.lines);
    expect(allLines.find((l) => l.kind === "remove" && l.text === "one")).toBeTruthy();
    expect(allLines.find((l) => l.kind === "remove" && l.text === "three")).toBeTruthy();
  });

  it("returns unchanged=true when both inputs are empty", () => {
    const r = computeDiff("", "");
    expect(r.unchanged).toBe(true);
    expect(r.hunks).toEqual([]);
  });

  it("emits a single replace hunk with one remove + one add", () => {
    const r = computeDiff(
      "context-a\nold-line\ncontext-b\n",
      "context-a\nnew-line\ncontext-b\n",
    );
    expect(r.unchanged).toBe(false);
    expect(r.addedLines).toBe(1);
    expect(r.removedLines).toBe(1);
    expect(r.hunks.length).toBe(1);
    const lines = r.hunks[0].lines;
    expect(lines.some((l) => l.kind === "remove" && l.text === "old-line")).toBe(
      true,
    );
    expect(lines.some((l) => l.kind === "add" && l.text === "new-line")).toBe(
      true,
    );
  });

  it("preserves correct line numbers on context/add/remove", () => {
    const r = computeDiff("a\nb\nc", "a\nB\nc");
    const flat = r.hunks.flatMap((h) => h.lines);
    const a = flat.find((l) => l.text === "a")!;
    const removed = flat.find((l) => l.kind === "remove" && l.text === "b")!;
    const added = flat.find((l) => l.kind === "add" && l.text === "B")!;
    const c = flat.find((l) => l.text === "c")!;
    expect(a.kind).toBe("context");
    expect(a.oldLineNumber).toBe(1);
    expect(a.newLineNumber).toBe(1);
    expect(removed.oldLineNumber).toBe(2);
    expect(removed.newLineNumber).toBeNull();
    expect(added.oldLineNumber).toBeNull();
    expect(added.newLineNumber).toBe(2);
    expect(c.oldLineNumber).toBe(3);
    expect(c.newLineNumber).toBe(3);
  });

  it("collapses long unchanged stretches into multiple hunks", () => {
    // 30 lines of context, change at the end -> expect a separator before
    // the trailing hunk (non-zero collapsedBefore).
    const oldLines = Array.from({ length: 30 }, (_, i) => `line-${i}`).join(
      "\n",
    );
    const newLines = oldLines + "\nappended";
    const r = computeDiff(oldLines, newLines);
    expect(r.unchanged).toBe(false);
    expect(r.addedLines).toBe(1);
    expect(r.hunks.length).toBe(1);
    expect(r.hunks[0].collapsedBefore).toBeGreaterThan(0);
  });

  it("merges adjacent changes into one hunk when within 2*context", () => {
    // Two single-line changes separated by 4 unchanged lines (< 2*3=6) -> one hunk.
    const oldText = ["x", "a", "1", "2", "3", "4", "b", "y"].join("\n");
    const newText = ["x", "A", "1", "2", "3", "4", "B", "y"].join("\n");
    const r = computeDiff(oldText, newText);
    expect(r.hunks.length).toBe(1);
  });

  it("separates distant changes into multiple hunks", () => {
    const oldText = [
      "x",
      "a",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "b",
      "y",
    ].join("\n");
    const newText = [
      "x",
      "A",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "B",
      "y",
    ].join("\n");
    const r = computeDiff(oldText, newText);
    expect(r.hunks.length).toBe(2);
  });

  it("tags lines inside fenced code blocks as inCodeBlock", () => {
    // Modify the code line so the hunk's context window covers the
    // intro/fence/outro lines on either side and we can assert their tags.
    const oldText = ["intro", "```js", "let x = 1;", "```", "outro"].join(
      "\n",
    );
    const newText = ["intro", "```js", "let x = 2;", "```", "outro"].join(
      "\n",
    );
    const r = computeDiff(oldText, newText);
    const flat = r.hunks.flatMap((h) => h.lines);
    const intro = flat.find((l) => l.text === "intro");
    const codeLine = flat.find((l) => l.text === "let x = 2;");
    const fenceOpen = flat.find((l) => l.text === "```js");
    const fenceClose = flat.find((l) => l.text === "```");
    const outro = flat.find((l) => l.text === "outro");
    expect(intro?.inCodeBlock).toBe(false);
    expect(fenceOpen?.inCodeBlock).toBe(true);
    expect(codeLine?.inCodeBlock).toBe(true);
    expect(fenceClose?.inCodeBlock).toBe(true);
    expect(outro?.inCodeBlock).toBe(false);
  });

  it("treats indented fence as a fence", () => {
    // Modify a line inside the fence so the hunk includes the code-block
    // lines and we can assert their tags directly.
    const oldText = ["a", "  ```", "code", "  ```", "z"].join("\n");
    const newText = ["a", "  ```", "CODE", "  ```", "z"].join("\n");
    const r = computeDiff(oldText, newText);
    const flat = r.hunks.flatMap((h) => h.lines);
    expect(flat.find((l) => l.text === "code")?.inCodeBlock).toBe(true);
    expect(flat.find((l) => l.text === "CODE")?.inCodeBlock).toBe(true);
    // Fences themselves are tagged inside the block too.
    expect(flat.find((l) => l.text === "  ```")?.inCodeBlock).toBe(true);
  });

  it("falls back to line mode when 'word' is requested in v1", () => {
    const lineR = computeDiff("hello world", "hello there", "line");
    const wordR = computeDiff("hello world", "hello there", "word");
    // Same number of additions / removals — word mode is currently a
    // line-mode passthrough.
    expect(wordR.addedLines).toBe(lineR.addedLines);
    expect(wordR.removedLines).toBe(lineR.removedLines);
  });
});
