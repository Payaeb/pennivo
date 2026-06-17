import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  imagesDirName,
  findAssetFoldersForFile,
  normalizeAssetsForFile,
} from "../fs/assetCoherence.js";
import { makeWorkspace, cleanup } from "./fixtures.js";

describe("imagesDirName", () => {
  it("derives the convention folder name", () => {
    expect(imagesDirName("/x/notes.md")).toBe("notes-md-images");
    expect(imagesDirName("/x/my report.markdown")).toBe(
      "my report-markdown-images",
    );
  });
});

describe("findAssetFoldersForFile", () => {
  let root: string;
  beforeEach(() => (root = makeWorkspace()));
  afterEach(() => cleanup(root));

  it("returns convention + content-referenced folders that exist on disk", () => {
    const file = path.join(root, "doc.md");
    writeFileSync(file, "# Doc\n\n![a](./legacy-md-images/p.png)\n", "utf-8");
    mkdirSync(path.join(root, "doc-md-images"), { recursive: true });
    mkdirSync(path.join(root, "legacy-md-images"), { recursive: true });
    mkdirSync(path.join(root, "unrelated-md-images"), { recursive: true });

    return findAssetFoldersForFile(file).then((folders) => {
      expect(folders.sort()).toEqual(["doc-md-images", "legacy-md-images"]);
      expect(folders).not.toContain("unrelated-md-images");
    });
  });
});

describe("normalizeAssetsForFile", () => {
  let root: string;
  beforeEach(() => (root = makeWorkspace()));
  afterEach(() => cleanup(root));

  it("promotes a stale asset folder to the canonical name and rewrites content", async () => {
    // Simulate a file renamed outside the canonical convention: content still
    // points at the old folder name.
    const file = path.join(root, "report.md");
    writeFileSync(file, "# Report\n\n![a](./draft-md-images/p.png)\n", "utf-8");
    mkdirSync(path.join(root, "draft-md-images"), { recursive: true });
    writeFileSync(path.join(root, "draft-md-images", "p.png"), "img");

    const result = await normalizeAssetsForFile(file);
    expect(result.healed).toBe(true);
    expect(existsSync(path.join(root, "report-md-images", "p.png"))).toBe(true);
    expect(existsSync(path.join(root, "draft-md-images"))).toBe(false);
    expect(readFileSync(file, "utf-8")).toContain("report-md-images/p.png");
  });

  it("is a no-op when the file is already coherent", async () => {
    const file = path.join(root, "ok.md");
    writeFileSync(file, "# OK\n\n![a](./ok-md-images/p.png)\n", "utf-8");
    mkdirSync(path.join(root, "ok-md-images"), { recursive: true });
    writeFileSync(path.join(root, "ok-md-images", "p.png"), "img");

    const result = await normalizeAssetsForFile(file);
    expect(result.healed).toBe(false);
  });

  it("preserves %20 encoding for spaced image names on rewrite", async () => {
    const file = path.join(root, "pics.md");
    writeFileSync(
      file,
      "# Pics\n\n![a](./old-md-images/my%20pic.png)\n",
      "utf-8",
    );
    mkdirSync(path.join(root, "old-md-images"), { recursive: true });
    writeFileSync(path.join(root, "old-md-images", "my pic.png"), "img");

    const result = await normalizeAssetsForFile(file);
    expect(result.healed).toBe(true);
    expect(existsSync(path.join(root, "pics-md-images", "my pic.png"))).toBe(
      true,
    );
    expect(readFileSync(file, "utf-8")).toContain(
      "pics-md-images/my%20pic.png",
    );
  });
});
