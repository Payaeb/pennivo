import { describe, it, expect } from "vitest";
import {
  defaultWorkspacePrefs,
  workspaceNameFromPath,
  findWorkspaceForPath,
  migrateWorkspaces,
} from "../migrate";
import type { WorkspacesState } from "../types";

// Deterministic id generator for migration tests.
function makeIdGen(prefix = "ws"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe("defaultWorkspacePrefs", () => {
  it("returns null last file, name-asc sort, empty timestamps", () => {
    const p = defaultWorkspacePrefs();
    expect(p.lastOpenFile).toBeNull();
    expect(p.sortKey).toBe("name-asc");
    expect(p.fileOpenTimestamps).toEqual({});
  });

  it("returns a fresh timestamp object each call", () => {
    const a = defaultWorkspacePrefs();
    const b = defaultWorkspacePrefs();
    expect(a.fileOpenTimestamps).not.toBe(b.fileOpenTimestamps);
  });
});

describe("workspaceNameFromPath", () => {
  it("takes the basename for a forward-slash path", () => {
    expect(workspaceNameFromPath("/home/paya/notes")).toBe("notes");
  });

  it("takes the basename for a backslash path", () => {
    expect(workspaceNameFromPath("C:\\Users\\Paya\\Notes")).toBe("Notes");
  });

  it("ignores a trailing forward slash", () => {
    expect(workspaceNameFromPath("/home/paya/notes/")).toBe("notes");
  });

  it("ignores a trailing backslash", () => {
    expect(workspaceNameFromPath("C:\\Users\\Paya\\Notes\\")).toBe("Notes");
  });

  it("ignores multiple trailing separators", () => {
    expect(workspaceNameFromPath("/home/paya/notes///")).toBe("notes");
  });

  it("falls back to 'Workspace' for an empty string", () => {
    expect(workspaceNameFromPath("")).toBe("Workspace");
  });

  it("falls back to 'Workspace' for a separators-only path", () => {
    expect(workspaceNameFromPath("///")).toBe("Workspace");
  });
});

describe("findWorkspaceForPath", () => {
  function state(...roots: string[]): WorkspacesState {
    return {
      workspaces: roots.map((rootPath, i) => ({
        id: `id-${i}`,
        name: workspaceNameFromPath(rootPath),
        rootPath,
      })),
      activeWorkspaceId: null,
      prefs: {},
    };
  }

  it("returns the workspace containing the file", () => {
    const s = state("/foo/bar");
    const ws = findWorkspaceForPath(s, "/foo/bar/baz.md");
    expect(ws?.rootPath).toBe("/foo/bar");
  });

  it("matches the root path itself", () => {
    const s = state("/foo/bar");
    expect(findWorkspaceForPath(s, "/foo/bar")?.rootPath).toBe("/foo/bar");
  });

  it("requires a segment boundary (no partial-segment match)", () => {
    // Root "/foo/ba" must NOT match "/foo/bar".
    const s = state("/foo/ba");
    expect(findWorkspaceForPath(s, "/foo/bar/x.md")).toBeNull();
  });

  it("returns null when no workspace contains the path", () => {
    const s = state("/foo/bar");
    expect(findWorkspaceForPath(s, "/other/place.md")).toBeNull();
  });

  it("picks the longest matching prefix for nested roots", () => {
    const s = state("/foo", "/foo/bar");
    expect(findWorkspaceForPath(s, "/foo/bar/baz.md")?.rootPath).toBe(
      "/foo/bar",
    );
    expect(findWorkspaceForPath(s, "/foo/other.md")?.rootPath).toBe("/foo");
  });

  it("normalizes backslashes and case", () => {
    const s = state("C:\\Users\\Paya\\Notes");
    const ws = findWorkspaceForPath(s, "c:/users/paya/notes/todo.md");
    expect(ws?.rootPath).toBe("C:\\Users\\Paya\\Notes");
  });

  it("ignores a trailing slash on the stored root", () => {
    const s = state("/foo/bar/");
    expect(findWorkspaceForPath(s, "/foo/bar/baz.md")?.rootPath).toBe(
      "/foo/bar/",
    );
  });
});

describe("migrateWorkspaces — idempotency", () => {
  it("passes an already-migrated well-formed state through unchanged", () => {
    const already: WorkspacesState = {
      workspaces: [{ id: "w1", name: "Notes", rootPath: "/home/notes" }],
      activeWorkspaceId: "w1",
      prefs: { w1: defaultWorkspacePrefs() },
    };
    const out = migrateWorkspaces(
      { workspaces: already },
      "/some/other/folder",
      makeIdGen(),
    );
    expect(out).toBe(already);
  });

  it("treats a missing activeWorkspaceId key as not well-formed", () => {
    const malformed = { workspaces: [], prefs: {} };
    const out = migrateWorkspaces({ workspaces: malformed }, null, makeIdGen());
    // Falls through to empty state since the key is absent.
    expect(out).toEqual({
      workspaces: [],
      activeWorkspaceId: null,
      prefs: {},
    });
  });
});

describe("migrateWorkspaces — legacy folder", () => {
  it("creates one workspace and seeds prefs from global keys", () => {
    const raw = {
      sidebarSort: "modified-desc",
      fileOpenTimestamps: { "/home/notes/a.md": 1700 },
    };
    const out = migrateWorkspaces(raw, "/home/notes", makeIdGen());

    expect(out.workspaces).toHaveLength(1);
    const ws = out.workspaces[0];
    expect(ws.id).toBe("ws-1");
    expect(ws.name).toBe("notes");
    expect(ws.rootPath).toBe("/home/notes");
    expect(out.activeWorkspaceId).toBe("ws-1");

    const prefs = out.prefs["ws-1"];
    expect(prefs.lastOpenFile).toBeNull();
    expect(prefs.sortKey).toBe("modified-desc");
    expect(prefs.fileOpenTimestamps).toEqual({ "/home/notes/a.md": 1700 });
  });

  it("falls back to the default sort key when sidebarSort is missing", () => {
    const out = migrateWorkspaces({}, "/home/notes", makeIdGen());
    expect(out.prefs["ws-1"].sortKey).toBe("name-asc");
  });

  it("falls back to an empty timestamp map when none is stored", () => {
    const out = migrateWorkspaces(
      { sidebarSort: "name-asc" },
      "/home/notes",
      makeIdGen(),
    );
    expect(out.prefs["ws-1"].fileOpenTimestamps).toEqual({});
  });
});

describe("migrateWorkspaces — empty state", () => {
  it("returns empty state for a null legacy folder and no prior state", () => {
    expect(migrateWorkspaces({}, null, makeIdGen())).toEqual({
      workspaces: [],
      activeWorkspaceId: null,
      prefs: {},
    });
  });

  it("returns empty state for an empty-string legacy folder", () => {
    expect(migrateWorkspaces({}, "", makeIdGen())).toEqual({
      workspaces: [],
      activeWorkspaceId: null,
      prefs: {},
    });
  });
});
