import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, symlinkSync } from "node:fs";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import {
  seedWorkspace,
  cleanup,
  makeWorkspace,
  writeFile,
} from "./fixtures.js";
import { DEFAULT_PERMISSIONS } from "../config.js";

// Security boundary. Every tool that takes a path must reject anything that
// resolves outside the configured workspace root, and a rejection must leave
// the filesystem untouched outside the root. Run with ALL tools enabled so a
// rejection is the path gate, never the permission gate.
describe("security — workspace boundary", () => {
  let root: string;
  let outsideDir: string;
  let h: Harness;

  beforeEach(async () => {
    root = seedWorkspace();
    // A sibling directory that must remain unreachable + untouched.
    outsideDir = makeWorkspace();
    writeFileSync(
      path.join(outsideDir, "secret.md"),
      "# Secret\n\ndo not touch.\n",
    );
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
    cleanup(outsideDir);
  });

  describe("read_file", () => {
    it("rejects relative parent traversal", async () => {
      const res = await callTool(h, "read_file", { path: "../secret.md" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/outside the workspace/i);
    });

    it("rejects deep traversal that climbs out then back", async () => {
      const res = await callTool(h, "read_file", {
        path: "sub/../../../etc/passwd",
      });
      expect(res.isError).toBe(true);
    });

    it("rejects an absolute path outside the workspace", async () => {
      const res = await callTool(h, "read_file", {
        path: path.join(outsideDir, "secret.md"),
      });
      expect(res.isError).toBe(true);
    });

    it("rejects a NUL byte in the path", async () => {
      const res = await callTool(h, "read_file", { path: "notes\0.md" });
      expect(res.isError).toBe(true);
    });

    it("rejects an empty path", async () => {
      const res = await callTool(h, "read_file", { path: "" });
      expect(res.isError).toBe(true);
    });

    it("rejects a non-markdown extension inside the workspace", async () => {
      writeFileSync(path.join(root, "data.json"), "{}");
      const res = await callTool(h, "read_file", { path: "data.json" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/not a markdown file/i);
    });

    it("rejects an oversize file (>5 MB)", async () => {
      writeFileSync(
        path.join(root, "huge.md"),
        "x".repeat(5 * 1024 * 1024 + 10),
      );
      const res = await callTool(h, "read_file", { path: "huge.md" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/too large/i);
    });

    if (process.platform === "win32") {
      it("rejects backslash traversal on Windows", async () => {
        const res = await callTool(h, "read_file", {
          path: "..\\..\\Windows\\win.ini",
        });
        expect(res.isError).toBe(true);
      });
    }

    it("rejects reading through an in-workspace symlink pointing out", async () => {
      const linkPath = path.join(root, "escape");
      try {
        symlinkSync(outsideDir, linkPath, "junction");
      } catch {
        return; // environment forbids link creation — other cases still cover it
      }
      const res = await callTool(h, "read_file", { path: "escape/secret.md" });
      expect(res.isError).toBe(true);
    });
  });

  describe("write tools leave the filesystem outside the root untouched", () => {
    it("write_file to a traversal path is rejected and creates nothing outside", async () => {
      const target = path.join(outsideDir, "injected.md");
      const res = await callTool(h, "write_file", {
        path: "../injected.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(target)).toBe(false);
    });

    it("write_file to an absolute outside path is rejected and creates nothing", async () => {
      const target = path.join(outsideDir, "injected2.md");
      const res = await callTool(h, "write_file", {
        path: target,
        content: "x",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(target)).toBe(false);
    });

    it("create_file with a traversal path is rejected", async () => {
      const res = await callTool(h, "create_file", {
        path: "../new.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(outsideDir, "new.md"))).toBe(false);
    });

    it("append_to_file with a traversal path is rejected", async () => {
      const res = await callTool(h, "append_to_file", {
        path: "../secret.md",
        content: "x",
      });
      expect(res.isError).toBe(true);
      // The outside file is unchanged.
      expect(existsSync(path.join(outsideDir, "secret.md"))).toBe(true);
    });

    it("delete_file with a traversal path is rejected and deletes nothing outside", async () => {
      const res = await callTool(h, "delete_file", { path: "../secret.md" });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(outsideDir, "secret.md"))).toBe(true);
    });

    it("rename_file with a traversal SOURCE is rejected", async () => {
      const res = await callTool(h, "rename_file", {
        oldPath: "../secret.md",
        newPath: "stolen.md",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(root, "stolen.md"))).toBe(false);
    });

    it("rename_file with a traversal TARGET is rejected and leaves the source", async () => {
      const res = await callTool(h, "rename_file", {
        oldPath: "notes.md",
        newPath: "../escaped.md",
      });
      expect(res.isError).toBe(true);
      expect(existsSync(path.join(root, "notes.md"))).toBe(true);
      expect(existsSync(path.join(outsideDir, "escaped.md"))).toBe(false);
    });
  });

  describe("pennivo://file resource", () => {
    it("rejects a traversal path", async () => {
      await expect(
        h.client.readResource({ uri: "pennivo://file/../../etc/hosts" }),
      ).rejects.toThrow();
    });

    it("rejects a URL-encoded traversal path", async () => {
      await expect(
        h.client.readResource({ uri: "pennivo://file/..%2F..%2Fetc%2Fhosts" }),
      ).rejects.toThrow();
    });
  });
});

describe("security — permission gate", () => {
  let root: string;

  beforeEach(() => {
    root = seedWorkspace();
  });

  afterEach(() => cleanup(root));

  it("denies every write tool under read-only defaults, even with valid paths", async () => {
    const h = await connect(root, { config: DEFAULT_PERMISSIONS });
    try {
      const calls: [string, Record<string, unknown>][] = [
        ["write_file", { path: "notes.md", content: "x" }],
        ["create_file", { path: "fresh.md", content: "x" }],
        ["append_to_file", { path: "notes.md", content: "x" }],
        ["delete_file", { path: "notes.md" }],
        ["rename_file", { oldPath: "notes.md", newPath: "y.md" }],
      ];
      for (const [name, args] of calls) {
        const res = await callTool(h, name, args);
        expect(res.isError, `${name} should be denied`).toBe(true);
        expect(firstText(res)).toMatch(/disabled in Pennivo settings/i);
      }
      // Read-only default never mutates anything.
      expect(existsSync(path.join(root, "notes.md"))).toBe(true);
      expect(existsSync(path.join(root, "fresh.md"))).toBe(false);
      // Every denial was audited.
      const denied = h.audit.recent(20).filter((e) => e.outcome === "denied");
      expect(denied.length).toBe(calls.length);
    } finally {
      await h.close();
    }
  });

  it("denies ALL tools (including reads) when the master switch is off", async () => {
    const h = await connect(root, {
      config: { enabled: false, tools: { ...ALL_ENABLED.tools } },
    });
    try {
      for (const name of ["list_files", "read_file", "search"]) {
        const res = await callTool(
          h,
          name,
          name === "search" ? { query: "x" } : {},
        );
        expect(res.isError, `${name} should be denied`).toBe(true);
      }
    } finally {
      await h.close();
    }
  });
});

describe("security — error messages never reveal the workspace location", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    writeFile(root, "notes.md", "# Notes\n");
    h = await connect(root, { config: ALL_ENABLED });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("a traversal rejection does not echo the resolved absolute path", async () => {
    const res = await callTool(h, "read_file", { path: "../../secret.md" });
    const text = firstText(res);
    expect(res.isError).toBe(true);
    expect(text).not.toContain(root);
    // No drive letter / posix abs leakage either.
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});
