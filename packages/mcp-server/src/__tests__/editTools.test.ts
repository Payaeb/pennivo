import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";
import { DEFAULT_PERMISSIONS } from "../config.js";

/** Assert no `.pennivo-tmp-*` staging file leaked into a directory. */
function noTmpLeftover(dir: string): void {
  const leftovers = readdirSync(dir).filter((n) => n.includes(".pennivo-tmp-"));
  expect(leftovers).toEqual([]);
}

describe("edit tools", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = seedWorkspace();
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  describe("replace_in_file", () => {
    it("replaces a unique match and writes atomically", async () => {
      const res = await callTool(h, "replace_in_file", {
        path: "notes.md",
        oldText: "quick brown fox",
        newText: "lazy dog",
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        path: string;
        edits: { oldText: string; replacements: number }[];
        bytesBefore: number;
        bytesAfter: number;
      };
      expect(data.path).toBe("notes.md");
      expect(data.edits).toEqual([
        { oldText: "quick brown fox", replacements: 1 },
      ]);
      const content = readFileSync(path.join(root, "notes.md"), "utf-8");
      expect(content).toContain("lazy dog");
      expect(content).not.toContain("quick brown fox");
      expect(data.bytesBefore).toBe(
        Buffer.byteLength("# Notes\n\nThe quick brown fox.\n"),
      );
      expect(data.bytesAfter).toBe(Buffer.byteLength(content));
      noTmpLeftover(root);
    });

    it("errors and leaves the file unchanged when oldText is not found", async () => {
      const before = readFileSync(path.join(root, "notes.md"), "utf-8");
      const res = await callTool(h, "replace_in_file", {
        path: "notes.md",
        oldText: "nonexistent text",
        newText: "x",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/oldText not found/i);
      expect(readFileSync(path.join(root, "notes.md"), "utf-8")).toBe(before);
      noTmpLeftover(root);
    });

    it("errors and leaves the file unchanged when oldText is ambiguous", async () => {
      await callTool(h, "write_file", {
        path: "dup.md",
        content: "# Dup\n\nfoo and foo again.\n",
      });
      const res = await callTool(h, "replace_in_file", {
        path: "dup.md",
        oldText: "foo",
        newText: "bar",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/ambiguous \(2 matches\)/i);
      expect(readFileSync(path.join(root, "dup.md"), "utf-8")).toContain(
        "foo and foo again.",
      );
      noTmpLeftover(root);
    });

    it("replaces all occurrences when replaceAll is set", async () => {
      await callTool(h, "write_file", {
        path: "dup.md",
        content: "# Dup\n\nfoo and foo again.\n",
      });
      const res = await callTool(h, "replace_in_file", {
        path: "dup.md",
        oldText: "foo",
        newText: "bar",
        replaceAll: true,
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        edits: { replacements: number }[];
      };
      expect(data.edits[0].replacements).toBe(2);
      const content = readFileSync(path.join(root, "dup.md"), "utf-8");
      expect(content).toContain("bar and bar again.");
      expect(content).not.toContain("foo");
    });

    it("treats regex metacharacters as literal text", async () => {
      await callTool(h, "write_file", {
        path: "meta.md",
        content: "# Meta\n\nprice is $5.00 (final).\n",
      });
      const res = await callTool(h, "replace_in_file", {
        path: "meta.md",
        oldText: "$5.00",
        newText: "$6.00",
      });
      expect(res.isError).toBeFalsy();
      const content = readFileSync(path.join(root, "meta.md"), "utf-8");
      expect(content).toContain("price is $6.00 (final).");
      // A regex-interpreted "$5.00" would have matched "$5X00"; confirm literal.
      await callTool(h, "write_file", {
        path: "meta2.md",
        content: "# Meta2\n\nliteral dot a.b here.\n",
      });
      const res2 = await callTool(h, "replace_in_file", {
        path: "meta2.md",
        oldText: "a.b",
        newText: "a_b",
      });
      expect(res2.isError).toBeFalsy();
      expect(readFileSync(path.join(root, "meta2.md"), "utf-8")).toContain(
        "literal dot a_b here.",
      );
    });

    it("matches a literal space against an on-disk %20 and re-encodes", async () => {
      // image-doc.md is seeded with ./image-doc-md-images/my%20pic.png on disk.
      const onDisk = readFileSync(path.join(root, "image-doc.md"), "utf-8");
      expect(onDisk).toContain("my%20pic.png");

      const res = await callTool(h, "replace_in_file", {
        path: "image-doc.md",
        // Agent matches against the decoded view (literal space).
        oldText: "./image-doc-md-images/my pic.png",
        newText: "./image-doc-md-images/renamed pic.png",
      });
      expect(res.isError).toBeFalsy();
      const after = readFileSync(path.join(root, "image-doc.md"), "utf-8");
      // Re-encoded on write.
      expect(after).toContain("renamed%20pic.png");
      expect(after).not.toContain("my%20pic.png");
      expect(after).not.toContain("renamed pic.png");
    });
  });

  describe("edit_file", () => {
    it("applies multiple sequential edits", async () => {
      await callTool(h, "write_file", {
        path: "multi.md",
        content: "# Title\n\nalpha beta gamma\n",
      });
      const res = await callTool(h, "edit_file", {
        path: "multi.md",
        edits: [
          { oldText: "alpha", newText: "one" },
          { oldText: "beta", newText: "two" },
          { oldText: "gamma", newText: "three" },
        ],
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        edits: { replacements: number }[];
      };
      expect(data.edits).toHaveLength(3);
      expect(readFileSync(path.join(root, "multi.md"), "utf-8")).toContain(
        "one two three",
      );
    });

    it("aborts ALL edits (file unchanged) if one edit fails", async () => {
      await callTool(h, "write_file", {
        path: "atomic.md",
        content: "# A\n\nkeep this and that\n",
      });
      const before = readFileSync(path.join(root, "atomic.md"), "utf-8");
      const res = await callTool(h, "edit_file", {
        path: "atomic.md",
        edits: [
          { oldText: "keep this", newText: "changed this" },
          { oldText: "MISSING", newText: "x" },
        ],
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/oldText not found/i);
      // The first (valid) edit must NOT have been written.
      expect(readFileSync(path.join(root, "atomic.md"), "utf-8")).toBe(before);
      noTmpLeftover(root);
    });

    it("applies edits in order against evolving content", async () => {
      await callTool(h, "write_file", {
        path: "evolve.md",
        content: "# E\n\nstart\n",
      });
      const res = await callTool(h, "edit_file", {
        path: "evolve.md",
        edits: [
          // First edit produces "middle"; second edit targets it.
          { oldText: "start", newText: "middle" },
          { oldText: "middle", newText: "end" },
        ],
      });
      expect(res.isError).toBeFalsy();
      const content = readFileSync(path.join(root, "evolve.md"), "utf-8");
      expect(content).toContain("end");
      expect(content).not.toContain("start");
      expect(content).not.toContain("middle");
    });
  });

  describe("output + gating", () => {
    it("reports replacements counts and byte sizes", async () => {
      await callTool(h, "write_file", {
        path: "shape.md",
        content: "# S\n\nfoo foo bar\n",
      });
      const res = await callTool(h, "edit_file", {
        path: "shape.md",
        edits: [
          { oldText: "foo", newText: "qux", replaceAll: true },
          { oldText: "bar", newText: "baz" },
        ],
      });
      const data = JSON.parse(firstText(res)) as {
        path: string;
        edits: { oldText: string; replacements: number }[];
        bytesBefore: number;
        bytesAfter: number;
      };
      expect(data.path).toBe("shape.md");
      expect(data.edits).toEqual([
        { oldText: "foo", replacements: 2 },
        { oldText: "bar", replacements: 1 },
      ]);
      expect(data.bytesBefore).toBe(Buffer.byteLength("# S\n\nfoo foo bar\n"));
      const content = readFileSync(path.join(root, "shape.md"), "utf-8");
      expect(data.bytesAfter).toBe(Buffer.byteLength(content));
    });

    it("denies both edit tools under read-only defaults", async () => {
      const ro = await connect(root, { config: DEFAULT_PERMISSIONS });
      try {
        for (const [name, args] of [
          [
            "replace_in_file",
            { path: "notes.md", oldText: "fox", newText: "cat" },
          ],
          [
            "edit_file",
            { path: "notes.md", edits: [{ oldText: "fox", newText: "cat" }] },
          ],
        ] as const) {
          const res = await callTool(
            ro,
            name,
            args as Record<string, unknown>,
          );
          expect(res.isError, `${name} should be denied`).toBe(true);
          expect(firstText(res)).toMatch(/disabled in Pennivo settings/i);
        }
        // Nothing written.
        expect(readFileSync(path.join(root, "notes.md"), "utf-8")).toContain(
          "quick brown fox",
        );
      } finally {
        await ro.close();
      }
    });

    it("rejects a traversal path", async () => {
      const res = await callTool(h, "replace_in_file", {
        path: "../escape.md",
        oldText: "a",
        newText: "b",
      });
      expect(res.isError).toBe(true);
    });

    it("errors when the target file does not exist", async () => {
      const res = await callTool(h, "replace_in_file", {
        path: "missing.md",
        oldText: "a",
        newText: "b",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/does not exist/i);
      expect(existsSync(path.join(root, "missing.md"))).toBe(false);
    });
  });
});
