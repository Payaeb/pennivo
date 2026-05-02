import { describe, it, expect } from "vitest";
import {
  planNormalize,
  extractReferencedFolders,
  decodeImageUrlSpaces,
  encodeImageUrlSpaces,
} from "../assetNormalizer";

describe("planNormalize — coherent state", () => {
  it("is a no-op when nothing exists and nothing is referenced", () => {
    const plan = planNormalize({
      content: "# Notes\n\nNo images here.",
      onDiskFolders: [],
      desiredFolder: "notes-md-images",
    });
    expect(plan.changed).toBe(false);
    expect(plan.newContent).toBe("# Notes\n\nNo images here.");
    expect(plan.promote).toBeNull();
    expect(plan.mergeFrom).toEqual([]);
  });

  it("is a no-op when canonical folder is on disk and content references it", () => {
    const content = "![](./notes-md-images/cat.png)";
    const plan = planNormalize({
      content,
      onDiskFolders: ["notes-md-images"],
      desiredFolder: "notes-md-images",
    });
    expect(plan.changed).toBe(false);
    expect(plan.newContent).toBe(content);
  });
});

describe("planNormalize — simple rename", () => {
  it("plans a promote and rewrites the single reference", () => {
    const plan = planNormalize({
      content: "![](./foo-md-images/cat.png)",
      onDiskFolders: ["foo-md-images"],
      desiredFolder: "bar-md-images",
    });
    expect(plan.promote).toEqual({
      from: "foo-md-images",
      to: "bar-md-images",
    });
    expect(plan.mergeFrom).toEqual([]);
    expect(plan.newContent).toBe("![](./bar-md-images/cat.png)");
  });
});

describe("planNormalize — folder names with spaces (the production bug)", () => {
  // This is the exact shape of the bug the user hit: a folder name with
  // multiple spaces, where the old regex captured only the trailing slug
  // ("say-md-images") and Step 3 prepended the canonical name onto that
  // truncated match — producing the doubled-prefix corruption.

  it("does not corrupt content when the folder name contains spaces", () => {
    const oldFolder = "how I feel about what pro war people say-md-images";
    const newFolder = "how I feel about what pro war people say2-md-images";
    const content = `![](./${oldFolder}/paste.png)`;
    const plan = planNormalize({
      content,
      onDiskFolders: [oldFolder],
      desiredFolder: newFolder,
    });
    expect(plan.promote).toEqual({ from: oldFolder, to: newFolder });
    expect(plan.newContent).toBe(`![](./${newFolder}/paste.png)`);
    // Critical: the new content must NOT contain a doubled prefix.
    expect(plan.newContent).not.toContain(`${newFolder}/${newFolder}`);
    expect(plan.newContent).not.toMatch(/say2-md-images.*say2-md-images/);
  });

  it("does not corrupt when the canonical name is just the old name with one extra char", () => {
    // "say2" added to the basename — the trickiest substring case.
    const oldFolder = "how I feel about what pro war people say-md-images";
    const newFolder = "how I feel about what pro war people say2-md-images";
    const content = [
      `Image one: ![](./${oldFolder}/a.png)`,
      `Image two: ![](./${oldFolder}/b.png)`,
    ].join("\n");
    const plan = planNormalize({
      content,
      onDiskFolders: [oldFolder],
      desiredFolder: newFolder,
    });
    expect(plan.newContent).toBe(
      [
        `Image one: ![](./${newFolder}/a.png)`,
        `Image two: ![](./${newFolder}/b.png)`,
      ].join("\n"),
    );
    expect(plan.newContent).not.toContain("say22-md-images");
  });

  it("handles parens-and-bracket boundaries in markdown image syntax", () => {
    const oldFolder = "abc def-md-images";
    const newFolder = "abc def2-md-images";
    const content = `[link](${oldFolder}/x.png) and ![alt](./${oldFolder}/y.png)`;
    const plan = planNormalize({
      content,
      onDiskFolders: [oldFolder],
      desiredFolder: newFolder,
    });
    expect(plan.newContent).toBe(
      `[link](${newFolder}/x.png) and ![alt](./${newFolder}/y.png)`,
    );
  });
});

describe("planNormalize — substring traps", () => {
  it("does not falsely credit a short folder name that is a suffix of a longer on-disk folder", () => {
    // Both folders exist on disk. Content only references the long one.
    // Discovery must not flag the short one as referenced.
    const long = "abc xy-md-images";
    const short = "xy-md-images";
    const content = `![](./${long}/p.png)`;
    const plan = planNormalize({
      content,
      onDiskFolders: [long, short],
      desiredFolder: long,
    });
    // No work needed — long is canonical and on disk; short is unreferenced.
    expect(plan.changed).toBe(false);
    expect(plan.newContent).toBe(content);
  });

  it("does not match a folder name embedded inside an unrelated word", () => {
    // "myfolder-md-images" appears inside "abcmyfolder-md-images" without a
    // boundary char before it. Boundary anchoring should reject it.
    const content = "abcmyfolder-md-images/x.png is not a real reference";
    const plan = planNormalize({
      content,
      onDiskFolders: ["myfolder-md-images"],
      desiredFolder: "myfolder2-md-images",
    });
    // No promote — content doesn't actually reference "myfolder-md-images"
    // in a way the planner should act on.
    expect(plan.promote).toBeNull();
    expect(plan.changed).toBe(false);
  });
});

describe("planNormalize — merging", () => {
  it("merges multiple non-canonical folders into the canonical one", () => {
    const content = [
      "![](./foo-md-images/a.png)",
      "![](./bar-md-images/b.png)",
      "![](./canonical-md-images/c.png)",
    ].join("\n");
    const plan = planNormalize({
      content,
      onDiskFolders: ["foo-md-images", "bar-md-images", "canonical-md-images"],
      desiredFolder: "canonical-md-images",
    });
    expect(plan.promote).toBeNull();
    expect(plan.mergeFrom.sort()).toEqual(["bar-md-images", "foo-md-images"]);
    expect(plan.newContent).toBe(
      [
        "![](./canonical-md-images/a.png)",
        "![](./canonical-md-images/b.png)",
        "![](./canonical-md-images/c.png)",
      ].join("\n"),
    );
  });
});

describe("planNormalize — recover from already-corrupted content (Step 3b)", () => {
  // The old buggy regex produced content like:
  //   ./prefix prefix folder-md-images/file.png
  // where the real on-disk folder is "prefix folder-md-images". Step 3b
  // should rewrite the doubled reference back to the on-disk name.
  it("heals doubled-prefix corruption when an on-disk folder is a suffix of the broken ref", () => {
    const real = "how I feel about what pro war people say-md-images";
    const broken = `how I feel about what pro war people ${real}`;
    const content = `![](./${broken}/paste.png)`;
    const plan = planNormalize({
      content,
      onDiskFolders: [real],
      desiredFolder: real,
    });
    expect(plan.newContent).toBe(`![](./${real}/paste.png)`);
  });

  it("leaves content alone when the broken ref doesn't suffix-match any real folder", () => {
    const content = `![](./totally-unknown-md-images/x.png)`;
    const plan = planNormalize({
      content,
      onDiskFolders: ["other-md-images"],
      desiredFolder: "other-md-images",
    });
    // No real folder is a suffix of "totally-unknown-md-images" preceded by
    // a space, so we leave the broken ref alone (we don't guess).
    expect(plan.newContent).toBe(content);
  });
});

describe("planNormalize — multi-rename history (the real production bug)", () => {
  // Reproduces the scenario behind "image displays as text" after rename:
  // a file accumulates broken refs from previous renames, the user pastes a
  // new image (one valid ref), then renames again. Old broken refs must not
  // block the rewrite of the valid one.
  it("rewrites the live ref even when content has stale broken refs from previous renames", () => {
    const stale1 = "how I feel about what pro war people say-md-images";
    const stale2 = "how I feel about what pro war people say2-md-images";
    const live = "how I feel about what pro war people say24-md-images";
    const desired = "how I feel about what pro war people say2442-md-images";
    const content = [
      `![](./${stale1}/old1.png)`,
      `![](./${stale2}/old2.png)`,
      `![](./${live}/fresh.png)`,
    ].join("\n");
    const plan = planNormalize({
      content,
      onDiskFolders: [live],
      desiredFolder: desired,
    });
    // Live ref must be rewritten to the desired (canonical) name.
    expect(plan.newContent).toContain(`./${desired}/fresh.png`);
    // Stale refs must be preserved as-is — they were already broken; we
    // don't make them worse, but we also don't second-guess them.
    expect(plan.newContent).toContain(`./${stale1}/old1.png`);
    expect(plan.newContent).toContain(`./${stale2}/old2.png`);
    expect(plan.promote).toEqual({ from: live, to: desired });
  });
});

describe("decode/encodeImageUrlSpaces", () => {
  it("decodes %20 to literal spaces inside image URLs", () => {
    const md = "![](./how%20I%20feel-md-images/x.png)";
    expect(decodeImageUrlSpaces(md)).toBe("![](./how I feel-md-images/x.png)");
  });

  it("encodes literal spaces to %20 inside image URLs", () => {
    const md = "![](./how I feel-md-images/x.png)";
    expect(encodeImageUrlSpaces(md)).toBe(
      "![](./how%20I%20feel-md-images/x.png)",
    );
  });

  it("does not touch spaces in body text — only inside image/link URLs", () => {
    const md = "I think this is good. ![](./folder name/x.png) yes really.";
    const decoded = decodeImageUrlSpaces(md);
    expect(decoded).toBe(md); // no %20 in URL → no change anywhere
    const encoded = encodeImageUrlSpaces(md);
    expect(encoded).toBe(
      "I think this is good. ![](./folder%20name/x.png) yes really.",
    );
    // Body words still have their spaces — we only rewrote inside the URL.
    expect(encoded).toContain("I think this is good");
    expect(encoded).toContain("yes really");
  });

  it("decode then plan then encode survives the round trip on %20-encoded content", () => {
    // The full main.ts pipeline: read %20 → decode → plan → encode → write.
    const stored =
      "![](./how%20I%20feel%20about%20what%20pro%20war%20people%20say-md-images/paste.png)";
    const decoded = decodeImageUrlSpaces(stored);
    const plan = planNormalize({
      content: decoded,
      onDiskFolders: ["how I feel about what pro war people say-md-images"],
      desiredFolder: "how I feel about what pro war people say2-md-images",
    });
    expect(plan.promote).toEqual({
      from: "how I feel about what pro war people say-md-images",
      to: "how I feel about what pro war people say2-md-images",
    });
    const reencoded = encodeImageUrlSpaces(plan.newContent);
    expect(reencoded).toBe(
      "![](./how%20I%20feel%20about%20what%20pro%20war%20people%20say2-md-images/paste.png)",
    );
  });
});

describe("extractReferencedFolders", () => {
  it("picks up folder names with spaces", () => {
    const refs = extractReferencedFolders(
      "![](./how I feel about what pro war people say-md-images/x.png)",
    );
    expect(refs.has("how I feel about what pro war people say-md-images")).toBe(
      true,
    );
  });

  it("picks up folder names without spaces", () => {
    const refs = extractReferencedFolders("![](./foo-md-images/x.png)");
    expect(refs.has("foo-md-images")).toBe(true);
  });

  it("returns an empty set when there are no references", () => {
    const refs = extractReferencedFolders("# Just text");
    expect(refs.size).toBe(0);
  });
});
