import { describe, it, expect } from "vitest";
import {
  snapshotPathSegments,
  snapshotFileBasename,
  normalizeAbsolutePath,
} from "../path";
import { sha1Hex } from "../sha1";

describe("snapshotPathSegments", () => {
  it("returns a 40-char lowercase hex sha1 directory name", () => {
    const seg = snapshotPathSegments("/Users/foo/bar.md");
    expect(seg.dir).toMatch(/^[0-9a-f]{40}$/);
  });

  it("is stable across repeated calls (POSIX path)", () => {
    const a = snapshotPathSegments("/Users/foo/bar.md").dir;
    const b = snapshotPathSegments("/Users/foo/bar.md").dir;
    expect(a).toBe(b);
  });

  it("is stable across repeated calls (Windows path)", () => {
    const a = snapshotPathSegments("C:\\Users\\foo\\bar.md").dir;
    const b = snapshotPathSegments("C:\\Users\\foo\\bar.md").dir;
    expect(a).toBe(b);
  });

  it("treats backslash and forward slash as equivalent", () => {
    const fwd = snapshotPathSegments("/foo/bar.md").dir;
    const back = snapshotPathSegments("\\foo\\bar.md").dir;
    expect(fwd).toBe(back);
  });

  it("produces the same hash for windows drive case variants", () => {
    const lower = snapshotPathSegments("c:\\Users\\foo\\bar.md").dir;
    const upper = snapshotPathSegments("C:\\Users\\foo\\bar.md").dir;
    expect(lower).toBe(upper);
  });

  it("preserves case beyond the windows drive letter", () => {
    // POSIX is case-sensitive — different cases must produce different dirs.
    const a = snapshotPathSegments("/Users/Foo/bar.md").dir;
    const b = snapshotPathSegments("/Users/foo/bar.md").dir;
    expect(a).not.toBe(b);
  });

  it("collapses repeated slashes", () => {
    const a = snapshotPathSegments("/foo//bar.md").dir;
    const b = snapshotPathSegments("/foo/bar.md").dir;
    expect(a).toBe(b);
  });

  it("ignores trailing slashes", () => {
    const a = snapshotPathSegments("/foo/bar/").dir;
    const b = snapshotPathSegments("/foo/bar").dir;
    expect(a).toBe(b);
  });

  it("produces different dirs for different POSIX paths", () => {
    const a = snapshotPathSegments("/Users/foo/bar.md").dir;
    const b = snapshotPathSegments("/Users/foo/baz.md").dir;
    expect(a).not.toBe(b);
  });

  it("dir hash matches sha1Hex of the normalized path", () => {
    const raw = "C:\\Users\\foo\\bar.md";
    const expected = sha1Hex(normalizeAbsolutePath(raw));
    expect(snapshotPathSegments(raw).dir).toBe(expected);
  });
});

describe("snapshotFileBasename", () => {
  it("formats epoch zero deterministically with .md extension", () => {
    expect(snapshotFileBasename(0)).toBe("1970-01-01T00-00-00-000Z.md");
  });

  it("replaces : and . with - so filenames are valid on Windows", () => {
    const name = snapshotFileBasename(Date.UTC(2026, 4, 7, 14, 30, 22) + 123);
    expect(name).not.toContain(":");
    // Only the dot before the extension may be a dot.
    expect(name.match(/\./g)).toHaveLength(1);
    expect(name).toMatch(/\.md$/);
  });

  it("formats a known timestamp correctly", () => {
    const ts = Date.UTC(2026, 4, 7, 14, 30, 22) + 123;
    expect(snapshotFileBasename(ts)).toBe("2026-05-07T14-30-22-123Z.md");
  });

  it("respects a custom extension", () => {
    expect(snapshotFileBasename(0, "txt")).toBe(
      "1970-01-01T00-00-00-000Z.txt",
    );
  });
});

describe("snapshotPathSegments.fileBasename", () => {
  it("delegates to snapshotFileBasename", () => {
    const ts = Date.UTC(2026, 4, 7, 14, 30, 22) + 123;
    const seg = snapshotPathSegments("/Users/foo/bar.md");
    expect(seg.fileBasename(ts)).toBe("2026-05-07T14-30-22-123Z.md");
    expect(seg.fileBasename(ts, "txt")).toBe("2026-05-07T14-30-22-123Z.txt");
  });
});
