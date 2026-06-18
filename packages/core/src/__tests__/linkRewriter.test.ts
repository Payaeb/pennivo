import { describe, it, expect } from "vitest";
import { planLinkRewrite, type WorkspaceFile } from "../linkRewriter";

/** Pull a single file's new content out of a result, or undefined. */
function updateFor(
  result: ReturnType<typeof planLinkRewrite>,
  path: string,
): string | undefined {
  return result.updates.find((u) => u.path === path)?.newContent;
}

describe("planLinkRewrite — sibling file move (root -> notes/)", () => {
  const files: WorkspaceFile[] = [
    {
      path: "index.md",
      content:
        "Inline [A](./a.md) and image ![pic](./a.png).\n\n[ref]: ./a.md\n",
    },
    { path: "a.md", content: "# A\n" },
  ];

  it("rewrites an inbound inline link from a root sibling", () => {
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    expect(result.changed).toBe(true);
    const out = updateFor(result, "index.md");
    expect(out).toContain("[A](./notes/a.md)");
  });

  it("rewrites a reference-style definition", () => {
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    const out = updateFor(result, "index.md");
    expect(out).toContain("[ref]: ./notes/a.md");
  });

  it("rewrites an inbound image ref pointing at the moved file's path", () => {
    // The image a.png moves alongside a.md? No — only a.md moves here. This
    // case checks a DIFFERENT thing: an image whose path equals nothing moved.
    // We move a.png explicitly instead to assert image rewriting works.
    const result = planLinkRewrite({
      files,
      oldPath: "a.png",
      newPath: "notes/a.png",
      isDirectory: false,
    });
    const out = updateFor(result, "index.md");
    expect(out).toContain("![pic](./notes/a.png)");
    // The .md link must be untouched in this move.
    expect(out).toContain("[A](./a.md)");
  });

  it("does not list a.md in updates (its own content has no links)", () => {
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    expect(updateFor(result, "notes/a.md")).toBeUndefined();
  });
});

describe("planLinkRewrite — into-subdir and out-of-subdir recompute `../`", () => {
  it("recomputes `../` when the target moves into a subdir", () => {
    const files: WorkspaceFile[] = [
      { path: "deep/nested/here.md", content: "See [T](../../target.md).\n" },
      { path: "target.md", content: "# T\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "target.md",
      newPath: "deep/target.md",
      isDirectory: false,
    });
    const out = updateFor(result, "deep/nested/here.md");
    // here.md is at deep/nested/, target now at deep/ → one `../`.
    expect(out).toContain("[T](../target.md)");
  });

  it("recomputes when the target moves out of a subdir", () => {
    const files: WorkspaceFile[] = [
      { path: "here.md", content: "See [T](./sub/target.md).\n" },
      { path: "sub/target.md", content: "# T\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "sub/target.md",
      newPath: "target.md",
      isDirectory: false,
    });
    const out = updateFor(result, "here.md");
    expect(out).toContain("[T](./target.md)");
  });
});

describe("planLinkRewrite — outbound links recomputed from new location", () => {
  it("recomputes a moved file's link to an unmoved sibling", () => {
    const files: WorkspaceFile[] = [
      { path: "a.md", content: "Link to [B](./b.md).\n" },
      { path: "b.md", content: "# B\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    // a.md moved to notes/; b.md stayed at root → link becomes ../b.md.
    const out = updateFor(result, "notes/a.md");
    expect(out).toContain("[B](../b.md)");
  });

  it("recomputes a moved file's outbound link when moving up and out", () => {
    const files: WorkspaceFile[] = [
      { path: "sub/a.md", content: "Up to [B](../b.md).\n" },
      { path: "b.md", content: "# B\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "sub/a.md",
      newPath: "a.md",
      isDirectory: false,
    });
    const out = updateFor(result, "a.md");
    expect(out).toContain("[B](./b.md)");
  });
});

describe("planLinkRewrite — folder move", () => {
  it("updates inbound, outbound, and intra-subtree links on a folder move", () => {
    const files: WorkspaceFile[] = [
      // Outside referrer pointing INTO the subtree.
      { path: "index.md", content: "Open [page](./docs/guide.md).\n" },
      // File inside the subtree linking OUT to an unmoved file.
      { path: "docs/guide.md", content: "Back to [home](../index.md).\n" },
      // File inside the subtree linking to a sibling INSIDE the subtree.
      {
        path: "docs/intro.md",
        content: "Next: [guide](./guide.md).\n",
      },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "docs",
      newPath: "manual/docs",
      isDirectory: true,
    });

    // Inbound: index.md now points one level deeper.
    expect(updateFor(result, "index.md")).toContain(
      "[page](./manual/docs/guide.md)",
    );
    // Outbound: guide.md (now at manual/docs/) to root index.md → ../../.
    expect(updateFor(result, "manual/docs/guide.md")).toContain(
      "[home](../../index.md)",
    );
    // Intra-subtree: intro -> guide stays a co-moving `./guide.md`, unchanged,
    // so intro.md should NOT appear in updates.
    expect(updateFor(result, "manual/docs/intro.md")).toBeUndefined();
  });

  it("respects segment boundaries — moving 'docs' does not touch 'docs-archive'", () => {
    const files: WorkspaceFile[] = [
      {
        path: "index.md",
        content:
          "[a](./docs/a.md) and [b](./docs-archive/b.md)\n",
      },
      { path: "docs/a.md", content: "# A\n" },
      { path: "docs-archive/b.md", content: "# B\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "docs",
      newPath: "moved-docs",
      isDirectory: true,
    });
    const out = updateFor(result, "index.md");
    expect(out).toContain("[a](./moved-docs/a.md)");
    // docs-archive must be left completely alone.
    expect(out).toContain("[b](./docs-archive/b.md)");
  });
});

describe("planLinkRewrite — anchors preserved", () => {
  it("keeps the #fragment while rewriting only the path", () => {
    const files: WorkspaceFile[] = [
      { path: "index.md", content: "Jump [here](./a.md#intro).\n" },
      { path: "a.md", content: "# A\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    const out = updateFor(result, "index.md");
    expect(out).toContain("[here](./notes/a.md#intro)");
  });
});

describe("planLinkRewrite — non-relative links untouched", () => {
  it("leaves http(s), mailto, protocol-relative, and absolute links alone", () => {
    const content = [
      "[ext](https://example.com/a.md)",
      "[http](http://example.com/a.md)",
      "[mail](mailto:foo@example.com)",
      "[proto](//cdn.example.com/a.md)",
      "[abs](/a.md)",
      "[anchor](#section)",
    ].join("\n");
    const files: WorkspaceFile[] = [
      { path: "index.md", content },
      { path: "a.md", content: "# A\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    // Nothing relative points at a.md, so no change at all.
    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
  });
});

describe("planLinkRewrite — URL-encoded spaces round-trip", () => {
  it("preserves %20 encoding across a rewrite", () => {
    const files: WorkspaceFile[] = [
      { path: "index.md", content: "[doc](./my%20file.md)\n" },
      { path: "my file.md", content: "# Doc\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "my file.md",
      newPath: "notes/my file.md",
      isDirectory: false,
    });
    const out = updateFor(result, "index.md");
    expect(out).toContain("[doc](./notes/my%20file.md)");
  });
});

describe("planLinkRewrite — self-into-descendant guard", () => {
  it("returns the error and no updates when moving a folder into itself", () => {
    const files: WorkspaceFile[] = [
      { path: "docs/a.md", content: "[x](./b.md)\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "docs",
      newPath: "docs/sub",
      isDirectory: true,
    });
    expect(result.error).toBe("self-into-descendant");
    expect(result.updates).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("returns the error when newPath equals oldPath for a folder", () => {
    const result = planLinkRewrite({
      files: [{ path: "docs/a.md", content: "# A\n" }],
      oldPath: "docs",
      newPath: "docs",
      isDirectory: true,
    });
    expect(result.error).toBe("self-into-descendant");
  });
});

describe("planLinkRewrite — no-op cases", () => {
  it("returns changed=false when nothing references the moved path", () => {
    const files: WorkspaceFile[] = [
      { path: "index.md", content: "# Index\n\nNo links here.\n" },
      { path: "a.md", content: "# A\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    expect(result.changed).toBe(false);
    expect(result.updates).toEqual([]);
  });
});

describe("planLinkRewrite — co-moving own sidecar image ref", () => {
  it("leaves a moved file's own `*-md-images` image ref unchanged", () => {
    const files: WorkspaceFile[] = [
      {
        path: "a.md",
        content: "# A\n\n![pic](./a-md-images/cat.png)\n",
      },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    // The sidecar co-moves; the relative ./a-md-images/cat.png stays valid, so
    // a.md's content is unchanged and it is not in updates.
    expect(updateFor(result, "notes/a.md")).toBeUndefined();
    expect(result.changed).toBe(false);
  });

  it("rewrites the sidecar stem when the file is also renamed", () => {
    const files: WorkspaceFile[] = [
      {
        path: "a.md",
        content: "![pic](./a-md-images/cat.png)\n",
      },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "b.md",
      isDirectory: false,
    });
    // a.md -> b.md: its sidecar a-md-images -> b-md-images co-moves, so the
    // ref must be rewritten to the new stem.
    const out = updateFor(result, "b.md");
    expect(out).toContain("![pic](./b-md-images/cat.png)");
  });

  it("rewrites an INBOUND image ref from another file into the moved file's sidecar", () => {
    const files: WorkspaceFile[] = [
      {
        path: "index.md",
        content: "![pic](./a-md-images/cat.png)\n",
      },
      { path: "a.md", content: "# A\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "a.md",
      newPath: "notes/a.md",
      isDirectory: false,
    });
    // index.md did not move; its ref into a's sidecar must now reach the
    // sidecar's new home alongside notes/a.md.
    const out = updateFor(result, "index.md");
    expect(out).toContain("![pic](./notes/a-md-images/cat.png)");
  });
});

describe("planLinkRewrite — multiple referrers, per-file recompute", () => {
  it("computes a distinct relative path for each referrer location", () => {
    const files: WorkspaceFile[] = [
      { path: "top.md", content: "[t](./target.md)\n" },
      { path: "deep/mid.md", content: "[t](../target.md)\n" },
      { path: "target.md", content: "# T\n" },
    ];
    const result = planLinkRewrite({
      files,
      oldPath: "target.md",
      newPath: "shared/target.md",
      isDirectory: false,
    });
    expect(updateFor(result, "top.md")).toContain("[t](./shared/target.md)");
    expect(updateFor(result, "deep/mid.md")).toContain(
      "[t](../shared/target.md)",
    );
  });
});
