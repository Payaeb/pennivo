// History tools (list_snapshots / restore_snapshot / list_trash /
// restore_from_trash). These are the only tools that delegate OUT of the
// server process to a host capability (the desktop loopback bridge). Here we
// inject STUB SnapshotHost / TrashHost via the harness and assert:
//   - all four appear in tools/list and work when the stubs are present
//   - restore_snapshot defaults to the SAFE `as-new-file` mode
//   - list_trash filters out entries whose originalPath is outside the root
//   - restore_from_trash rejects a restored path outside the root
//   - WITHOUT the stubs, tools/list OMITS all four
//   - a host method that throws -> the tool returns the "app not running"
//     errorResult (not a thrown error across MCP)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";
import type {
  SnapshotHost,
  TrashHost,
  SnapshotSummary,
  TrashEntrySummary,
} from "../deps.js";

const HISTORY_TOOLS = [
  "list_snapshots",
  "restore_snapshot",
  "list_trash",
  "restore_from_trash",
];

describe("history tools", () => {
  let root: string;

  beforeEach(() => {
    root = seedWorkspace();
  });

  afterEach(() => {
    cleanup(root);
  });

  describe("with host stubs present", () => {
    let h: Harness;
    let lastRestoreMode: string | undefined;

    beforeEach(async () => {
      lastRestoreMode = undefined;
      const snapshots: SnapshotHost = {
        async list(absPath): Promise<SnapshotSummary[]> {
          expect(path.isAbsolute(absPath)).toBe(true);
          return [
            {
              id: "2026-01-01T00-00-00-000Z",
              ts: 1_767_225_600_000,
              sizeBytes: 42,
              author: "user",
              agentName: "claude",
              source: "local",
            },
          ];
        },
        async restore(absPath, _id, mode) {
          lastRestoreMode = mode;
          return {
            newPath: path.join(absPath, "..", "notes (restored).md"),
          };
        },
      };
      const trash: TrashHost = {
        async list(): Promise<TrashEntrySummary[]> {
          return [
            {
              trashId: "abc-1",
              originalPath: path.join(root, "deleted.md"),
              deletedAtMs: 1_700_000_000_000,
              expiresAtMs: 1_800_000_000_000,
            },
            {
              // OUTSIDE the workspace root — must be filtered out of list_trash.
              trashId: "other-2",
              originalPath: path.join(root, "..", "elsewhere", "x.md"),
              deletedAtMs: 1_700_000_000_001,
              expiresAtMs: null,
            },
          ];
        },
        async restore(trashId) {
          if (trashId === "abc-1") {
            return { newPath: path.join(root, "deleted.md") };
          }
          // Restored path OUTSIDE root — the tool must reject it.
          return { newPath: path.join(root, "..", "escape.md") };
        },
      };
      h = await connect(root, { config: ALL_ENABLED, snapshots, trash });
    });

    afterEach(async () => {
      await h.close();
    });

    it("registers all four history tools", async () => {
      const { tools } = await h.client.listTools();
      const names = tools.map((t) => t.name);
      for (const tool of HISTORY_TOOLS) {
        expect(names).toContain(tool);
      }
    });

    it("list_snapshots returns the stub data and a workspace-relative path", async () => {
      const res = await callTool(h, "list_snapshots", { path: "notes.md" });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        path: string;
        snapshots: SnapshotSummary[];
      };
      expect(data.path).toBe("notes.md");
      expect(data.snapshots).toHaveLength(1);
      expect(data.snapshots[0].id).toBe("2026-01-01T00-00-00-000Z");
      expect(data.snapshots[0].source).toBe("local");
    });

    it("restore_snapshot defaults to as-new-file and reports restoredTo", async () => {
      const res = await callTool(h, "restore_snapshot", {
        path: "notes.md",
        snapshotId: "2026-01-01T00-00-00-000Z",
      });
      expect(res.isError).toBeFalsy();
      expect(lastRestoreMode).toBe("as-new-file");
      const data = JSON.parse(firstText(res)) as { restoredTo: string };
      expect(data.restoredTo).toBe("notes (restored).md");
    });

    it("restore_snapshot honours an explicit overwrite mode", async () => {
      await callTool(h, "restore_snapshot", {
        path: "notes.md",
        snapshotId: "x",
        mode: "overwrite",
      });
      expect(lastRestoreMode).toBe("overwrite");
    });

    it("list_trash filters out entries outside the workspace root", async () => {
      const res = await callTool(h, "list_trash", {});
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as {
        entries: { trashId: string; originalPath: string }[];
      };
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].trashId).toBe("abc-1");
      expect(data.entries[0].originalPath).toBe("deleted.md");
    });

    it("restore_from_trash reports restoredTo for an in-root entry", async () => {
      const res = await callTool(h, "restore_from_trash", {
        trashId: "abc-1",
      });
      expect(res.isError).toBeFalsy();
      const data = JSON.parse(firstText(res)) as { restoredTo: string };
      expect(data.restoredTo).toBe("deleted.md");
    });

    it("restore_from_trash rejects a restored path outside the root", async () => {
      const res = await callTool(h, "restore_from_trash", {
        trashId: "other-2",
      });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/outside the workspace/i);
    });
  });

  describe("when a host method throws (app not running)", () => {
    it("returns the 'app is not running' errorResult, not a thrown error", async () => {
      const throwing: SnapshotHost = {
        async list() {
          throw new Error("ECONNREFUSED");
        },
        async restore() {
          throw new Error("ECONNREFUSED");
        },
      };
      const throwingTrash: TrashHost = {
        async list() {
          throw new Error("ECONNREFUSED");
        },
        async restore() {
          throw new Error("ECONNREFUSED");
        },
      };
      const h = await connect(root, {
        config: ALL_ENABLED,
        snapshots: throwing,
        trash: throwingTrash,
      });
      try {
        const list = await callTool(h, "list_snapshots", { path: "notes.md" });
        expect(list.isError).toBe(true);
        expect(firstText(list)).toMatch(/app is not running/i);

        const restore = await callTool(h, "restore_snapshot", {
          path: "notes.md",
          snapshotId: "x",
        });
        expect(restore.isError).toBe(true);
        expect(firstText(restore)).toMatch(/app is not running/i);

        const tlist = await callTool(h, "list_trash", {});
        expect(tlist.isError).toBe(true);
        expect(firstText(tlist)).toMatch(/app is not running/i);

        const trestore = await callTool(h, "restore_from_trash", {
          trashId: "x",
        });
        expect(trestore.isError).toBe(true);
        expect(firstText(trestore)).toMatch(/app is not running/i);
      } finally {
        await h.close();
      }
    });
  });

  describe("without host stubs (standalone server)", () => {
    it("omits all four history tools from tools/list", async () => {
      const h = await connect(root, { config: ALL_ENABLED });
      try {
        const { tools } = await h.client.listTools();
        const names = tools.map((t) => t.name);
        for (const tool of HISTORY_TOOLS) {
          expect(names).not.toContain(tool);
        }
      } finally {
        await h.close();
      }
    });
  });
});
