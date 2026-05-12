import { describe, it, expect } from "vitest";
import { trashEntryDirName } from "../path";
import { sha1Hex, normalizeAbsolutePath } from "../../snapshots";

describe("trashEntryDirName", () => {
  const ts = 1714941022123;

  it("returns `<sha1>-<deletedAtMs>` shaped string", () => {
    const name = trashEntryDirName("/Users/foo/bar.md", ts);
    expect(name).toMatch(/^[0-9a-f]{40}-\d+$/);
    expect(name.endsWith(`-${ts}`)).toBe(true);
  });

  it("is deterministic for the same input", () => {
    const a = trashEntryDirName("/Users/foo/bar.md", ts);
    const b = trashEntryDirName("/Users/foo/bar.md", ts);
    expect(a).toBe(b);
  });

  it("treats backslash and forward slash the same (cross-OS stable)", () => {
    const fwd = trashEntryDirName("/foo/bar.md", ts);
    const back = trashEntryDirName("\\foo\\bar.md", ts);
    expect(fwd).toBe(back);
  });

  it("normalizes Windows drive-letter case", () => {
    const lower = trashEntryDirName("c:\\Users\\foo\\bar.md", ts);
    const upper = trashEntryDirName("C:\\Users\\foo\\bar.md", ts);
    expect(lower).toBe(upper);
  });

  it("hash piece matches sha1 of normalized path", () => {
    const raw = "C:\\Users\\foo\\bar.md";
    const hash = sha1Hex(normalizeAbsolutePath(raw));
    expect(trashEntryDirName(raw, ts)).toBe(`${hash}-${ts}`);
  });

  it("uses a different prefix per absolute path", () => {
    const a = trashEntryDirName("/foo/a.md", ts);
    const b = trashEntryDirName("/foo/b.md", ts);
    expect(a).not.toBe(b);
  });

  it("uses a different suffix per timestamp (same path, two deletes)", () => {
    const a = trashEntryDirName("/foo/a.md", 1);
    const b = trashEntryDirName("/foo/a.md", 2);
    expect(a).not.toBe(b);
    // Hash piece should still match — it's a function of the path alone.
    expect(a.split("-")[0]).toBe(b.split("-")[0]);
  });
});
