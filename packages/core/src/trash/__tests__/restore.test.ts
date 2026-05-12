import { describe, it, expect } from "vitest";
import { pickRestorePath } from "../restore";

describe("pickRestorePath", () => {
  it("returns originalPath when there's no collision", () => {
    expect(pickRestorePath("/foo/bar.md", false)).toBe("/foo/bar.md");
  });

  it("inserts ` (restored)` before the extension on a single collision", () => {
    expect(pickRestorePath("/foo/bar.md", true)).toBe("/foo/bar (restored).md");
  });

  it("walks the counter when (restored).md also collides", () => {
    const taken = new Set([
      "/foo/bar.md",
      "/foo/bar (restored).md",
      "/foo/bar (restored 2).md",
    ]);
    const result = pickRestorePath("/foo/bar.md", true, {
      pathExistsOnDisk: (p) => taken.has(p),
    });
    expect(result).toBe("/foo/bar (restored 3).md");
  });

  it("counter increments past 3 when more collisions exist", () => {
    const taken = new Set([
      "/foo/bar.md",
      "/foo/bar (restored).md",
      "/foo/bar (restored 2).md",
      "/foo/bar (restored 3).md",
      "/foo/bar (restored 4).md",
    ]);
    const result = pickRestorePath("/foo/bar.md", true, {
      pathExistsOnDisk: (p) => taken.has(p),
    });
    expect(result).toBe("/foo/bar (restored 5).md");
  });

  it("works with Windows-style separators", () => {
    expect(pickRestorePath("C:\\Users\\foo\\bar.md", true)).toBe(
      "C:\\Users\\foo\\bar (restored).md",
    );
  });

  it("works for files without an extension", () => {
    expect(pickRestorePath("/foo/README", true)).toBe("/foo/README (restored)");
  });

  it("treats a leading-dot file as having no extension (sane fallback)", () => {
    // ".gitignore" — dotIdx === 0, so stem = ".gitignore", ext = "".
    expect(pickRestorePath("/foo/.gitignore", true)).toBe(
      "/foo/.gitignore (restored)",
    );
  });

  it("handles already-named (restored) files without infinite recursion", () => {
    const taken = new Set([
      "/foo/bar (restored).md",
      "/foo/bar (restored) (restored).md",
    ]);
    // Original path is "/foo/bar (restored).md" — collides — the function
    // should produce "/foo/bar (restored) (restored).md" first, then walk
    // the counter when that also collides.
    const result = pickRestorePath("/foo/bar (restored).md", true, {
      pathExistsOnDisk: (p) => taken.has(p),
    });
    expect(result).toBe("/foo/bar (restored) (restored 2).md");
  });

  it("returns original when no collision even with predicate provided", () => {
    expect(
      pickRestorePath("/foo/bar.md", false, {
        pathExistsOnDisk: () => true,
      }),
    ).toBe("/foo/bar.md");
  });

  it("falls back to a path with a numeric suffix at all times (never returns colliding)", () => {
    // Defensive: even if the predicate said EVERY candidate collides up to 1000,
    // we should still return SOMETHING that's not in the taken set.
    const result = pickRestorePath("/foo/bar.md", true, {
      pathExistsOnDisk: () => true,
    });
    // The fallback uses a timestamp suffix.
    expect(result).toMatch(/^\/foo\/bar \(restored \d+\)\.md$/);
  });
});
