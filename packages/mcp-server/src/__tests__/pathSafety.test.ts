import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { symlinkSync } from "node:fs";
import path from "node:path";
import {
  resolveInWorkspace,
  toWorkspaceRelative,
  WorkspacePathError,
} from "../fs/pathSafety.js";
import { makeWorkspace, cleanup, writeFile, makeDir } from "./fixtures.js";

describe("resolveInWorkspace", () => {
  let root: string;

  beforeEach(() => {
    root = makeWorkspace();
    writeFile(root, "a.md", "x");
    makeDir(root, "sub");
    writeFile(root, "sub/b.md", "y");
  });

  afterEach(() => cleanup(root));

  it("resolves a relative path inside the root", () => {
    const resolved = resolveInWorkspace(root, "a.md");
    expect(toWorkspaceRelative(root, resolved)).toBe("a.md");
  });

  it("resolves a nested relative path inside the root", () => {
    const resolved = resolveInWorkspace(root, "sub/b.md");
    expect(toWorkspaceRelative(root, resolved)).toBe("sub/b.md");
  });

  it("accepts an absolute path that is inside the root", () => {
    const abs = path.join(root, "sub", "b.md");
    expect(() => resolveInWorkspace(root, abs)).not.toThrow();
  });

  it("accepts the root itself", () => {
    expect(() => resolveInWorkspace(root, ".")).not.toThrow();
    expect(toWorkspaceRelative(root, resolveInWorkspace(root, "."))).toBe(".");
  });

  it("rejects a parent-traversal escape", () => {
    expect(() => resolveInWorkspace(root, "../evil.md")).toThrow(
      WorkspacePathError,
    );
    try {
      resolveInWorkspace(root, "../evil.md");
    } catch (e) {
      expect((e as WorkspacePathError).code).toBe("OUTSIDE_WORKSPACE");
    }
  });

  it("rejects a deep parent-traversal escape", () => {
    expect(() => resolveInWorkspace(root, "sub/../../../etc/passwd")).toThrow(
      WorkspacePathError,
    );
  });

  it("rejects an absolute path outside the root", () => {
    const outside = path.resolve(root, "..", "outside.md");
    expect(() => resolveInWorkspace(root, outside)).toThrow(WorkspacePathError);
  });

  it("rejects an empty path", () => {
    expect(() => resolveInWorkspace(root, "")).toThrow(WorkspacePathError);
    try {
      resolveInWorkspace(root, "");
    } catch (e) {
      expect((e as WorkspacePathError).code).toBe("INVALID_PATH");
    }
  });

  it("rejects a path with a null byte", () => {
    expect(() => resolveInWorkspace(root, "a\0.md")).toThrow(
      WorkspacePathError,
    );
    try {
      resolveInWorkspace(root, "a\0.md");
    } catch (e) {
      expect((e as WorkspacePathError).code).toBe("INVALID_PATH");
    }
  });

  it("rejects an in-workspace symlink pointing outside the root", () => {
    const outsideDir = path.resolve(
      root,
      "..",
      `outside-${path.basename(root)}`,
    );
    makeDir(outsideDir, "");
    writeFile(outsideDir, "leak.md", "secret");
    const linkPath = path.join(root, "escape");
    try {
      // 'junction' works for directories on Windows without elevation and is
      // ignored (treated as a dir symlink) on POSIX.
      symlinkSync(outsideDir, linkPath, "junction");
    } catch {
      // Some environments forbid symlink creation entirely; the lexical and
      // realpath guards are still covered by the other cases above.
      return;
    }
    try {
      expect(() => resolveInWorkspace(root, "escape/leak.md")).toThrow(
        WorkspacePathError,
      );
    } finally {
      cleanup(outsideDir);
    }
  });

  if (process.platform === "win32") {
    it("rejects a path on a different Windows drive", () => {
      const otherDrive = root.toLowerCase().startsWith("c:")
        ? "D:\\x.md"
        : "C:\\x.md";
      expect(() => resolveInWorkspace(root, otherDrive)).toThrow(
        WorkspacePathError,
      );
    });
  }
});

describe("toWorkspaceRelative", () => {
  it("returns '.' for the root itself", () => {
    const root = makeWorkspace();
    try {
      expect(toWorkspaceRelative(root, root)).toBe(".");
    } finally {
      cleanup(root);
    }
  });

  it("returns forward-slash relative paths", () => {
    const root = makeWorkspace();
    try {
      const abs = path.join(root, "a", "b", "c.md");
      expect(toWorkspaceRelative(root, abs)).toBe("a/b/c.md");
    } finally {
      cleanup(root);
    }
  });
});
