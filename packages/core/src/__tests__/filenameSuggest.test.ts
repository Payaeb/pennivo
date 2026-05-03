import { describe, it, expect } from "vitest";
import { suggestFilenameFromContent } from "../filenameSuggest";

describe("suggestFilenameFromContent", () => {
  it("returns 'Untitled' for empty input", () => {
    expect(suggestFilenameFromContent("")).toBe("Untitled");
  });

  it("returns 'Untitled' for whitespace-only input", () => {
    expect(suggestFilenameFromContent("   \n\n   \n")).toBe("Untitled");
  });

  it("strips an H1 heading", () => {
    expect(suggestFilenameFromContent("# Project Plan\n\nbody")).toBe(
      "Project Plan",
    );
  });

  it("strips H2-H6 headings", () => {
    expect(suggestFilenameFromContent("## Subsection\n")).toBe("Subsection");
    expect(suggestFilenameFromContent("### Deep heading\n")).toBe(
      "Deep heading",
    );
    expect(suggestFilenameFromContent("###### Six-level\n")).toBe("Six-level");
  });

  it("uses plain first line when not a heading", () => {
    expect(suggestFilenameFromContent("Just plain text\nfoo bar")).toBe(
      "Just plain text",
    );
  });

  it("skips leading blank lines", () => {
    expect(suggestFilenameFromContent("\n\n   \n\n# Hello\n")).toBe("Hello");
  });

  it("skips empty heading and uses next non-empty line", () => {
    // `#` with no text after the space is a malformed heading; we still
    // strip the marks and the whole candidate is empty, so we move on.
    expect(suggestFilenameFromContent("# \n\nReal content here\n")).toBe(
      "Real content here",
    );
  });

  it("strips filesystem-unsafe characters cross-platform", () => {
    // /, \, :, *, ?, ", <, >, | are illegal on Windows
    expect(suggestFilenameFromContent("# Project / Phase 1")).toBe(
      "Project  Phase 1".replace(/\s+/g, " "),
    );
    expect(suggestFilenameFromContent("# Hello: World")).toBe("Hello World");
    expect(suggestFilenameFromContent("# foo/bar\\baz")).toBe("foobarbaz");
    expect(suggestFilenameFromContent('# What "is" this?')).toBe(
      "What is this",
    );
  });

  it("strips control characters", () => {
    expect(suggestFilenameFromContent("# HelloWorld")).toBe("HelloWorld");
  });

  it("trims trailing dots and leading whitespace/dots", () => {
    // Windows rejects trailing dots; leading dots make POSIX files hidden.
    expect(suggestFilenameFromContent("# .Hidden")).toBe("Hidden");
    expect(suggestFilenameFromContent("# Trailing...")).toBe("Trailing");
    expect(suggestFilenameFromContent("#    Leading whitespace")).toBe(
      "Leading whitespace",
    );
  });

  it("collapses internal whitespace runs", () => {
    expect(suggestFilenameFromContent("# Lots   of    space")).toBe(
      "Lots of space",
    );
  });

  it("truncates very long headings to 60 chars", () => {
    const long = "x".repeat(120);
    const result = suggestFilenameFromContent("# " + long);
    expect(result.length).toBe(60);
  });

  it("truncate doesn't leave trailing whitespace", () => {
    const padded = "Hello world ".repeat(20);
    const result = suggestFilenameFromContent("# " + padded);
    expect(result).not.toMatch(/\s$/);
  });

  it("falls back to 'Untitled' when sanitization removes everything", () => {
    // First line is just illegal chars
    expect(suggestFilenameFromContent("# ////")).toBe("Untitled");
    expect(suggestFilenameFromContent("# ...")).toBe("Untitled");
  });

  it("handles CRLF line endings", () => {
    expect(suggestFilenameFromContent("# Windows file\r\n\r\nbody")).toBe(
      "Windows file",
    );
  });

  it("ignores indentation before a heading", () => {
    // Markdown allows up to 3 spaces of indent before a heading; we trim, so
    // it still works even without strict spec adherence.
    expect(suggestFilenameFromContent("   # Indented heading\n")).toBe(
      "Indented heading",
    );
  });

  it("does not treat 7+ # as a heading", () => {
    // ATX headings are 1-6 levels; #######  is plain text in markdown.
    expect(suggestFilenameFromContent("####### Not a heading")).toBe(
      "####### Not a heading",
    );
  });
});
