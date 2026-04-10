import { describe, it, expect } from "vitest";
import { extractFilename } from "../paths";

describe("extractFilename", () => {
  it("extracts filename from forward-slash path", () => {
    expect(extractFilename("C:/Users/doc/note.md")).toBe("note.md");
  });

  it("extracts filename from backslash path", () => {
    expect(extractFilename("C:\\Users\\doc\\note.md")).toBe("note.md");
  });

  it("returns filename when no directory", () => {
    expect(extractFilename("note.md")).toBe("note.md");
  });

  it("returns fallback for empty string", () => {
    // pop() on [''] returns '', so the || fallback triggers
    expect(extractFilename("")).toBe("untitled.md");
  });
});
