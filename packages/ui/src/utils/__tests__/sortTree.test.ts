import { describe, it, expect } from "vitest";
import {
  sortTree,
  isSidebarSortKey,
  DEFAULT_SORT,
  SORT_OPTIONS,
} from "../sortTree";

const file = (
  name: string,
  opts: { mtimeMs?: number; size?: number; lastOpenedMs?: number } = {},
): FileTreeEntry => ({
  name,
  path: `/r/${name}`,
  type: "file",
  ...opts,
});

const folder = (
  name: string,
  children: FileTreeEntry[] = [],
): FileTreeEntry => ({
  name,
  path: `/r/${name}`,
  type: "folder",
  children,
});

const names = (tree: FileTreeEntry[]): string[] => tree.map((e) => e.name);

describe("sortTree", () => {
  describe("name-asc (default)", () => {
    it("sorts files alphabetically, case-insensitive", () => {
      const tree = [file("Charlie.md"), file("alpha.md"), file("Bravo.md")];
      expect(names(sortTree(tree, "name-asc"))).toEqual([
        "alpha.md",
        "Bravo.md",
        "Charlie.md",
      ]);
    });

    it("groups folders first, both alphabetical", () => {
      const tree = [
        file("zebra.md"),
        folder("notes"),
        file("alpha.md"),
        folder("archive"),
      ];
      expect(names(sortTree(tree, "name-asc"))).toEqual([
        "archive",
        "notes",
        "alpha.md",
        "zebra.md",
      ]);
    });

    it("DEFAULT_SORT is name-asc", () => {
      expect(DEFAULT_SORT).toBe("name-asc");
    });
  });

  describe("name-desc", () => {
    it("reverses both folders and files", () => {
      const tree = [
        file("alpha.md"),
        folder("archive"),
        file("zebra.md"),
        folder("notes"),
      ];
      expect(names(sortTree(tree, "name-desc"))).toEqual([
        "notes",
        "archive",
        "zebra.md",
        "alpha.md",
      ]);
    });
  });

  describe("modified-desc / modified-asc", () => {
    it("sorts files by mtime desc (newest first)", () => {
      const tree = [
        file("old.md", { mtimeMs: 100 }),
        file("new.md", { mtimeMs: 300 }),
        file("mid.md", { mtimeMs: 200 }),
      ];
      expect(names(sortTree(tree, "modified-desc"))).toEqual([
        "new.md",
        "mid.md",
        "old.md",
      ]);
    });

    it("sorts files by mtime asc (oldest first)", () => {
      const tree = [
        file("a.md", { mtimeMs: 300 }),
        file("b.md", { mtimeMs: 100 }),
        file("c.md", { mtimeMs: 200 }),
      ];
      expect(names(sortTree(tree, "modified-asc"))).toEqual([
        "b.md",
        "c.md",
        "a.md",
      ]);
    });

    it("missing mtime sorts as 0 (oldest), but stable by name as tiebreak", () => {
      const tree = [
        file("withMtime.md", { mtimeMs: 100 }),
        file("noMtimeA.md"),
        file("noMtimeB.md"),
      ];
      // modified-desc: real mtime first, then alphabetical for the two zeros
      expect(names(sortTree(tree, "modified-desc"))).toEqual([
        "withMtime.md",
        "noMtimeA.md",
        "noMtimeB.md",
      ]);
    });

    it("folders still sort alphabetically regardless of modified key", () => {
      const tree = [
        folder("zoo"),
        folder("apple"),
        file("recent.md", { mtimeMs: 999 }),
      ];
      expect(names(sortTree(tree, "modified-desc"))).toEqual([
        "apple",
        "zoo",
        "recent.md",
      ]);
    });
  });

  describe("size-desc / size-asc", () => {
    it("sorts files by size desc (largest first)", () => {
      const tree = [
        file("small.md", { size: 100 }),
        file("big.md", { size: 5000 }),
        file("mid.md", { size: 1000 }),
      ];
      expect(names(sortTree(tree, "size-desc"))).toEqual([
        "big.md",
        "mid.md",
        "small.md",
      ]);
    });

    it("sorts files by size asc (smallest first)", () => {
      const tree = [
        file("a.md", { size: 5000 }),
        file("b.md", { size: 100 }),
        file("c.md", { size: 1000 }),
      ];
      expect(names(sortTree(tree, "size-asc"))).toEqual([
        "b.md",
        "c.md",
        "a.md",
      ]);
    });

    it("missing size treated as 0", () => {
      const tree = [file("known.md", { size: 500 }), file("unknown.md")];
      expect(names(sortTree(tree, "size-desc"))).toEqual([
        "known.md",
        "unknown.md",
      ]);
    });
  });

  describe("recent-desc", () => {
    it("sorts files by lastOpenedMs desc (most recent first)", () => {
      const tree = [
        file("never.md"),
        file("yesterday.md", { lastOpenedMs: 1000 }),
        file("today.md", { lastOpenedMs: 5000 }),
        file("lastWeek.md", { lastOpenedMs: 500 }),
      ];
      expect(names(sortTree(tree, "recent-desc"))).toEqual([
        "today.md",
        "yesterday.md",
        "lastWeek.md",
        "never.md",
      ]);
    });

    it("never-opened files (missing lastOpenedMs) fall to the bottom", () => {
      const tree = [
        file("a.md"),
        file("b.md", { lastOpenedMs: 100 }),
        file("c.md"),
      ];
      // b is recent, a/c never opened — both fall to bottom alphabetically
      expect(names(sortTree(tree, "recent-desc"))).toEqual([
        "b.md",
        "a.md",
        "c.md",
      ]);
    });

    it("folders still sort alphabetically when recent-desc is chosen", () => {
      const tree = [
        folder("zoo"),
        folder("apple"),
        file("opened.md", { lastOpenedMs: 999 }),
      ];
      expect(names(sortTree(tree, "recent-desc"))).toEqual([
        "apple",
        "zoo",
        "opened.md",
      ]);
    });

    it("equal lastOpenedMs falls back to name asc", () => {
      const tree = [
        file("zebra.md", { lastOpenedMs: 500 }),
        file("alpha.md", { lastOpenedMs: 500 }),
      ];
      expect(names(sortTree(tree, "recent-desc"))).toEqual([
        "alpha.md",
        "zebra.md",
      ]);
    });
  });

  describe("nested folders", () => {
    it("recursively sorts children", () => {
      const tree = [
        folder("notes", [
          file("zebra.md"),
          file("alpha.md"),
          folder("inner", [file("z.md"), file("a.md")]),
        ]),
      ];
      const sorted = sortTree(tree, "name-asc");
      const notes = sorted[0];
      expect(names(notes.children!)).toEqual(["inner", "alpha.md", "zebra.md"]);
      const inner = notes.children![0];
      expect(names(inner.children!)).toEqual(["a.md", "z.md"]);
    });

    it("does not mutate input tree", () => {
      const tree = [file("z.md"), file("a.md")];
      const original = [...tree];
      sortTree(tree, "name-asc");
      expect(tree).toEqual(original);
    });
  });

  describe("edge cases", () => {
    it("empty array returns empty array", () => {
      expect(sortTree([], "name-asc")).toEqual([]);
    });

    it("single entry returned as-is", () => {
      const tree = [file("only.md")];
      expect(sortTree(tree, "name-desc")).toEqual(tree);
    });

    it("only folders", () => {
      const tree = [folder("z"), folder("a"), folder("m")];
      expect(names(sortTree(tree, "name-asc"))).toEqual(["a", "m", "z"]);
    });

    it("only files", () => {
      const tree = [file("z.md"), file("a.md"), file("m.md")];
      expect(names(sortTree(tree, "name-asc"))).toEqual([
        "a.md",
        "m.md",
        "z.md",
      ]);
    });

    it("equal mtime falls back to name asc", () => {
      const tree = [
        file("zebra.md", { mtimeMs: 500 }),
        file("alpha.md", { mtimeMs: 500 }),
      ];
      expect(names(sortTree(tree, "modified-desc"))).toEqual([
        "alpha.md",
        "zebra.md",
      ]);
    });
  });
});

describe("isSidebarSortKey", () => {
  it("accepts every key in SORT_OPTIONS", () => {
    for (const opt of SORT_OPTIONS) {
      expect(isSidebarSortKey(opt.key)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isSidebarSortKey("created-asc")).toBe(false);
    expect(isSidebarSortKey("")).toBe(false);
    expect(isSidebarSortKey(null)).toBe(false);
    expect(isSidebarSortKey(undefined)).toBe(false);
    expect(isSidebarSortKey(42)).toBe(false);
    expect(isSidebarSortKey({ key: "name-asc" })).toBe(false);
  });
});
