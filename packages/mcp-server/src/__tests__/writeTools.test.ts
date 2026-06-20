import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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

describe("write tools", () => {
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

  it("exposes the write + edit tools (in addition to the read tools)", async () => {
    // The history tools (list_snapshots / restore_snapshot / list_trash /
    // restore_from_trash) are deliberately ABSENT here: they register only when
    // the host injects `deps.snapshots` / `deps.trash` (the desktop bridge),
    // which this harness does not. Their presence is asserted in history.test.ts.
    const { tools } = await h.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "append_to_file",
      "create_file",
      "create_folder",
      "delete_file",
      "edit_file",
      "find_backlinks",
      "get_outline",
      "list_files",
      "list_workspaces",
      "move_folder",
      "read_file",
      "rename_file",
      "replace_in_file",
      "search",
      "stream_into_file",
      "write_file",
    ]);
  });

  describe("write_file", () => {
    it("overwrites an existing file", async () => {
      const res = await callTool(h, "write_file", {
        path: "notes.md",
        content: "# New\n\nreplaced.\n",
      });
      expect(res.isError).toBeFalsy();
      expect(readFileSync(path.join(root, "notes.md"), "utf-8")).toContain(
        "replaced.",
      );
    });

    it("creates parent folders as needed", async () => {
      await callTool(h, "write_file", {
        path: "a/b/c.md",
        content: "# Deep\n",
      });
      expect(existsSync(path.join(root, "a", "b", "c.md"))).toBe(true);
    });

    it("encodes spaces in image URLs to the on-disk %20 form", async () => {
      await callTool(h, "write_file", {
        path: "pic.md",
        content: "# Pic\n\n![a](./pic-md-images/my photo.png)\n",
      });
      expect(readFileSync(path.join(root, "pic.md"), "utf-8")).toContain(
        "my%20photo.png",
      );
    });

    it("rejects a traversal path", async () => {
      const res = await callTool(h, "write_file", {
        path: "../escape.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
    });
  });

  describe("create_file", () => {
    it("creates a new file", async () => {
      const res = await callTool(h, "create_file", {
        path: "fresh.md",
        content: "# Fresh\n",
      });
      expect(res.isError).toBeFalsy();
      expect(existsSync(path.join(root, "fresh.md"))).toBe(true);
    });

    it("derives a filename from the first line when path is omitted", async () => {
      const res = await callTool(h, "create_file", {
        content: "# Meeting Notes\n\nbody\n",
      });
      const data = JSON.parse(firstText(res)) as { created: string };
      expect(data.created).toBe("Meeting Notes.md");
      expect(existsSync(path.join(root, "Meeting Notes.md"))).toBe(true);
    });

    it("refuses to overwrite an existing file", async () => {
      const res = await callTool(h, "create_file", {
        path: "notes.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/already exists/i);
    });
  });

  describe("append_to_file", () => {
    it("appends to an existing file", async () => {
      await callTool(h, "append_to_file", {
        path: "notes.md",
        content: "\nappended line\n",
      });
      expect(readFileSync(path.join(root, "notes.md"), "utf-8")).toContain(
        "appended line",
      );
    });

    it("errors when the file does not exist", async () => {
      const res = await callTool(h, "append_to_file", {
        path: "missing.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
    });
  });

  describe("stream_into_file", () => {
    it("creates the file when absent, then appends the chunk", async () => {
      const res = await callTool(h, "stream_into_file", {
        path: "stream.md",
        chunk: "# Streamed\n\nfirst chunk\n",
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        path: string;
        bytesAppended: number;
        done: boolean;
      };
      expect(data.path).toBe("stream.md");
      expect(data.done).toBe(false);
      expect(data.bytesAppended).toBeGreaterThan(0);
      expect(readFileSync(path.join(root, "stream.md"), "utf-8")).toContain(
        "first chunk",
      );
    });

    it("appends to an existing file", async () => {
      await callTool(h, "stream_into_file", {
        path: "notes.md",
        chunk: "\nstreamed onto notes\n",
      });
      expect(readFileSync(path.join(root, "notes.md"), "utf-8")).toContain(
        "streamed onto notes",
      );
    });

    it("accumulates across multiple sequential calls", async () => {
      await callTool(h, "stream_into_file", { path: "acc.md", chunk: "one " });
      await callTool(h, "stream_into_file", { path: "acc.md", chunk: "two " });
      await callTool(h, "stream_into_file", { path: "acc.md", chunk: "three" });
      expect(readFileSync(path.join(root, "acc.md"), "utf-8")).toBe(
        "one two three",
      );
    });

    it("reflects the done flag in the output", async () => {
      const res = await callTool(h, "stream_into_file", {
        path: "fin.md",
        chunk: "last\n",
        done: true,
      });
      const data = JSON.parse(firstText(res)) as { done: boolean };
      expect(data.done).toBe(true);
    });

    it("encodes spaces in image URLs to the on-disk %20 form", async () => {
      await callTool(h, "stream_into_file", {
        path: "pic-stream.md",
        chunk: "![a](./pic-stream-md-images/my photo.png)\n",
      });
      expect(
        readFileSync(path.join(root, "pic-stream.md"), "utf-8"),
      ).toContain("my%20photo.png");
    });

    it("rejects a traversal path", async () => {
      const res = await callTool(h, "stream_into_file", {
        path: "../escape.md",
        chunk: "x",
      });
      expect(res.isError).toBe(true);
    });

    it("rejects a non-markdown target", async () => {
      const res = await callTool(h, "stream_into_file", {
        path: "image.png",
        chunk: "x",
      });
      expect(res.isError).toBe(true);
    });
  });

  describe("delete_file", () => {
    it("permanently deletes by default (no injected deleter)", async () => {
      const res = await callTool(h, "delete_file", { path: "notes.md" });
      expect(res.isError).toBeFalsy();
      expect(existsSync(path.join(root, "notes.md"))).toBe(false);
    });

    it("removes the asset folder when includeAssets is set", async () => {
      mkdirSync(path.join(root, "image-doc-md-images"), { recursive: true });
      writeFileSync(
        path.join(root, "image-doc-md-images", "my pic.png"),
        "binary",
      );
      const res = await callTool(h, "delete_file", {
        path: "image-doc.md",
        includeAssets: true,
      });
      const data = JSON.parse(firstText(res)) as {
        assetFoldersRemoved: string[];
      };
      expect(data.assetFoldersRemoved).toContain("image-doc-md-images");
      expect(existsSync(path.join(root, "image-doc-md-images"))).toBe(false);
    });

    it("routes through an injected deleter (e.g. trash) instead of fs.rm", async () => {
      const calls: { absolutePath: string; includeAssets: boolean }[] = [];
      const h2 = await connect(root, {
        config: ALL_ENABLED,
        deleteFile: async (req) => {
          calls.push({
            absolutePath: req.absolutePath,
            includeAssets: req.includeAssets,
          });
        },
      });
      try {
        await callTool(h2, "delete_file", { path: "notes.md" });
        expect(calls).toHaveLength(1);
        expect(calls[0].absolutePath.endsWith("notes.md")).toBe(true);
        // Injected deleter is a no-op here, so the file is untouched on disk.
        expect(existsSync(path.join(root, "notes.md"))).toBe(true);
      } finally {
        await h2.close();
      }
    });
  });

  describe("rename_file", () => {
    it("renames a file and reports asset healing", async () => {
      const res = await callTool(h, "rename_file", {
        oldPath: "notes.md",
        newPath: "renamed.md",
      });
      expect(res.isError).toBeFalsy();
      expect(existsSync(path.join(root, "notes.md"))).toBe(false);
      expect(existsSync(path.join(root, "renamed.md"))).toBe(true);
    });

    it("moves the per-file image folder with the file and rewrites references", async () => {
      // A doc with an image in its convention folder.
      writeFileSync(
        path.join(root, "doc.md"),
        "# Doc\n\n![a](./doc-md-images/p.png)\n",
        "utf-8",
      );
      mkdirSync(path.join(root, "doc-md-images"), { recursive: true });
      writeFileSync(path.join(root, "doc-md-images", "p.png"), "img");

      const res = await callTool(h, "rename_file", {
        oldPath: "doc.md",
        newPath: "report.md",
      });
      expect(res.isError).toBeFalsy();
      // The asset folder is promoted to the new canonical name and content rewritten.
      expect(existsSync(path.join(root, "report-md-images", "p.png"))).toBe(
        true,
      );
      expect(existsSync(path.join(root, "doc-md-images"))).toBe(false);
      expect(readFileSync(path.join(root, "report.md"), "utf-8")).toContain(
        "report-md-images/p.png",
      );
    });

    it("refuses to overwrite an existing target", async () => {
      const res = await callTool(h, "rename_file", {
        oldPath: "notes.md",
        newPath: "todo.txt",
      });
      expect(res.isError).toBe(true);
    });

    it("rejects a traversal target", async () => {
      const res = await callTool(h, "rename_file", {
        oldPath: "notes.md",
        newPath: "../escape.md",
      });
      expect(res.isError).toBe(true);
    });
  });

  it("denies every write tool under read-only defaults", async () => {
    const ro = await connect(root, { config: DEFAULT_PERMISSIONS });
    try {
      for (const [name, args] of [
        ["write_file", { path: "notes.md", content: "x" }],
        ["create_file", { path: "x.md", content: "x" }],
        ["append_to_file", { path: "notes.md", content: "x" }],
        ["stream_into_file", { path: "notes.md", chunk: "x" }],
        ["delete_file", { path: "notes.md" }],
        ["rename_file", { oldPath: "notes.md", newPath: "y.md" }],
      ] as const) {
        const res = await callTool(ro, name, args as Record<string, unknown>);
        expect(res.isError, `${name} should be denied`).toBe(true);
        expect(firstText(res)).toMatch(/disabled in Pennivo settings/i);
      }
      // Nothing was written.
      expect(existsSync(path.join(root, "notes.md"))).toBe(true);
    } finally {
      await ro.close();
    }
  });
});
