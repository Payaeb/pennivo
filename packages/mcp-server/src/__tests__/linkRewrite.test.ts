// Cross-document link integrity on rename_file / move_folder, plus the folder
// create/move tools. These exercise the genuine MCP protocol (via the harness)
// with write tools enabled, and assert on-disk content after each operation.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { makeWorkspace, cleanup, writeFile, makeDir } from "./fixtures.js";

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf-8");
}

describe("rename_file cross-document link rewrite", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("rewrites an inbound link in another file (./target.md -> ./renamed.md)", async () => {
    writeFile(root, "target.md", "# Target\n");
    writeFile(root, "referrer.md", "See [target](./target.md).\n");

    const res = await callTool(h, "rename_file", {
      oldPath: "target.md",
      newPath: "renamed.md",
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(firstText(res)) as { linksRewritten: number };
    expect(data.linksRewritten).toBeGreaterThanOrEqual(1);

    expect(read(root, "referrer.md")).toContain("./renamed.md");
    expect(read(root, "referrer.md")).not.toContain("./target.md");
  });

  it("rewrites an inbound link when moving into a subfolder (../ recompute)", async () => {
    writeFile(root, "target.md", "# Target\n");
    writeFile(root, "referrer.md", "See [target](./target.md).\n");

    const res = await callTool(h, "rename_file", {
      oldPath: "target.md",
      newPath: "sub/target.md",
    });
    expect(res.isError).toBeFalsy();
    expect(existsSync(path.join(root, "sub", "target.md"))).toBe(true);
    expect(read(root, "referrer.md")).toContain("./sub/target.md");
  });

  it("recomputes a moved file's OUTBOUND link to an unmoved sibling", async () => {
    writeFile(root, "sibling.md", "# Sibling\n");
    writeFile(root, "mover.md", "Go to [sibling](./sibling.md).\n");

    const res = await callTool(h, "rename_file", {
      oldPath: "mover.md",
      newPath: "deep/mover.md",
    });
    expect(res.isError).toBeFalsy();
    // From deep/, the unmoved sibling is now one level up.
    expect(read(root, "deep/mover.md")).toContain("../sibling.md");
  });

  it("rewrites a reference-style link", async () => {
    writeFile(root, "target.md", "# Target\n");
    writeFile(root, "referrer.md", "Use [the doc][t].\n\n[t]: ./target.md\n");

    const res = await callTool(h, "rename_file", {
      oldPath: "target.md",
      newPath: "renamed.md",
    });
    expect(res.isError).toBeFalsy();
    expect(read(root, "referrer.md")).toContain("[t]: ./renamed.md");
  });

  it("preserves anchors and leaves external/absolute links untouched", async () => {
    writeFile(root, "target.md", "# Target\n");
    writeFile(
      root,
      "referrer.md",
      [
        "Anchor [a](./target.md#section).",
        "External [b](https://example.com/target.md).",
        "Absolute [c](/target.md).",
      ].join("\n") + "\n",
    );

    const res = await callTool(h, "rename_file", {
      oldPath: "target.md",
      newPath: "renamed.md",
    });
    expect(res.isError).toBeFalsy();
    const content = read(root, "referrer.md");
    expect(content).toContain("./renamed.md#section");
    expect(content).toContain("https://example.com/target.md");
    expect(content).toContain("(/target.md)");
  });

  it("heals the moved file's image SIDECAR AND inbound links in one op (compose, no clobber)", async () => {
    // Moved file owns an image folder and is also linked from a referrer.
    writeFile(root, "doc.md", "# Doc\n\n![a](./doc-md-images/p.png)\n");
    makeDir(root, "doc-md-images");
    writeFileSync(path.join(root, "doc-md-images", "p.png"), "img");
    writeFile(root, "referrer.md", "See [doc](./doc.md).\n");

    const res = await callTool(h, "rename_file", {
      oldPath: "doc.md",
      newPath: "report.md",
    });
    expect(res.isError).toBeFalsy();
    const data = JSON.parse(firstText(res)) as {
      assetsHealed: boolean;
      linksRewritten: number;
    };

    // Inbound link healed.
    expect(read(root, "referrer.md")).toContain("./report.md");
    expect(data.linksRewritten).toBeGreaterThanOrEqual(1);

    // Image sidecar followed and content reference rewritten (asset coherence).
    expect(existsSync(path.join(root, "report-md-images", "p.png"))).toBe(true);
    expect(existsSync(path.join(root, "doc-md-images"))).toBe(false);
    expect(read(root, "report.md")).toContain("report-md-images/p.png");
    expect(data.assetsHealed).toBe(true);
  });

  it("does not abort when an unreadable file is present in the snapshot", async () => {
    writeFile(root, "target.md", "# Target\n");
    writeFile(root, "referrer.md", "See [target](./target.md).\n");
    // A file we cannot read must be skipped during enumeration, not abort.
    const lockedAbs = writeFile(root, "locked.md", "# Locked\n");
    // chmod has no effect on Windows file readability for the owner; the
    // enumeration guard is still exercised by the try/catch around stat/read.
    try {
      chmodSync(lockedAbs, 0o000);
    } catch {
      // best-effort
    }

    const res = await callTool(h, "rename_file", {
      oldPath: "target.md",
      newPath: "renamed.md",
    });
    expect(res.isError).toBeFalsy();
    expect(read(root, "referrer.md")).toContain("./renamed.md");

    try {
      chmodSync(lockedAbs, 0o644);
    } catch {
      // best-effort
    }
  });
});

describe("folder operations", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  describe("create_folder", () => {
    it("creates a new folder", async () => {
      const res = await callTool(h, "create_folder", { path: "fresh" });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as { created: string };
      expect(data.created).toBe("fresh");
      expect(existsSync(path.join(root, "fresh"))).toBe(true);
    });

    it("errors when the path already exists", async () => {
      makeDir(root, "taken");
      const res = await callTool(h, "create_folder", { path: "taken" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/already exists/i);
    });

    it("rejects a path-escape", async () => {
      const res = await callTool(h, "create_folder", { path: "../escape" });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(path.dirname(root), "escape"))).toBe(false);
    });
  });

  describe("move_folder", () => {
    it("moves a folder and a file inside it on disk", async () => {
      writeFile(root, "stuff/inner.md", "# Inner\n");

      const res = await callTool(h, "move_folder", {
        oldPath: "stuff",
        newPath: "archive/stuff",
      });
      expect(res.isError).toBeFalsy();
      expect(existsSync(path.join(root, "stuff"))).toBe(false);
      expect(existsSync(path.join(root, "archive", "stuff", "inner.md"))).toBe(
        true,
      );
    });

    it("rewrites an OUTSIDE file's link to a file INSIDE the moved folder", async () => {
      writeFile(root, "stuff/inner.md", "# Inner\n");
      writeFile(root, "outside.md", "See [inner](./stuff/inner.md).\n");

      const res = await callTool(h, "move_folder", {
        oldPath: "stuff",
        newPath: "archive/stuff",
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as { linksRewritten: number };
      expect(data.linksRewritten).toBeGreaterThanOrEqual(1);
      expect(read(root, "outside.md")).toContain("./archive/stuff/inner.md");
    });

    it("rejects self-into-descendant with NO fs change", async () => {
      writeFile(root, "stuff/inner.md", "# Inner\n");

      const res = await callTool(h, "move_folder", {
        oldPath: "stuff",
        newPath: "stuff/deeper",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/itself or one of its descendants/i);
      // Disk unchanged: original folder + file intact, no new target.
      expect(existsSync(path.join(root, "stuff", "inner.md"))).toBe(true);
      expect(existsSync(path.join(root, "stuff", "deeper"))).toBe(false);
    });

    it("errors when the folder does not exist", async () => {
      const res = await callTool(h, "move_folder", {
        oldPath: "ghost",
        newPath: "archive/ghost",
      });
      expect(res.isError).toBe(true);
    });

    it("rejects a path-escape", async () => {
      makeDir(root, "stuff");
      const res = await callTool(h, "move_folder", {
        oldPath: "stuff",
        newPath: "../escape",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(root, "stuff"))).toBe(true);
    });
  });
});
