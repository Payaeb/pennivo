import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import {
  connect,
  callTool,
  firstText,
  ALL_ENABLED,
  type Harness,
} from "./harness.js";
import { makeWorkspace, cleanup } from "./fixtures.js";
import { DEFAULT_PERMISSIONS } from "../config.js";

interface WorkspaceEntry {
  id: string;
  name: string;
  rootPath: string;
}
interface ListWorkspacesData {
  active: string | null;
  workspaces: WorkspaceEntry[];
}

describe("list_workspaces", () => {
  let root: string;
  let h: Harness;

  beforeEach(async () => {
    root = makeWorkspace();
    h = await connect(root);
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("exposes the tool", async () => {
    const { tools } = await h.client.listTools();
    expect(tools.map((t) => t.name)).toContain("list_workspaces");
  });

  it("synthesizes a single entry from root when no workspaces are injected", async () => {
    const res = await callTool(h, "list_workspaces");
    const data = JSON.parse(firstText(res)) as ListWorkspacesData;
    expect(data.active).toBe("default");
    expect(data.workspaces).toEqual([
      { id: "default", name: path.basename(root), rootPath: root },
    ]);
  });

  it("returns the injected list and active id", async () => {
    await h.close();
    const injected: WorkspaceEntry[] = [
      { id: "w1", name: "Notes", rootPath: "/home/alice/notes" },
      { id: "w2", name: "Blog", rootPath: "/home/alice/blog" },
    ];
    h = await connect(root, {
      workspaces: async () => injected,
      activeWorkspaceId: "w2",
    });
    const res = await callTool(h, "list_workspaces");
    const data = JSON.parse(firstText(res)) as ListWorkspacesData;
    expect(data.active).toBe("w2");
    expect(data.workspaces).toEqual(injected);
  });

  it("falls back to the first workspace id when activeWorkspaceId is absent", async () => {
    await h.close();
    const injected: WorkspaceEntry[] = [
      { id: "first", name: "First", rootPath: "/a" },
      { id: "second", name: "Second", rootPath: "/b" },
    ];
    h = await connect(root, { workspaces: async () => injected });
    const res = await callTool(h, "list_workspaces");
    const data = JSON.parse(firstText(res)) as ListWorkspacesData;
    expect(data.active).toBe("first");
  });

  it("yields null active when an injected list is empty", async () => {
    await h.close();
    h = await connect(root, { workspaces: async () => [] });
    const res = await callTool(h, "list_workspaces");
    const data = JSON.parse(firstText(res)) as ListWorkspacesData;
    expect(data.active).toBeNull();
    expect(data.workspaces).toEqual([]);
  });

  it("is allowed by default (read tool, default on)", async () => {
    await h.close();
    h = await connect(root, { config: ALL_ENABLED });
    const res = await callTool(h, "list_workspaces");
    expect(res.isError).toBeFalsy();
  });

  it("is denied when that tool is disabled", async () => {
    await h.close();
    h = await connect(root, {
      config: {
        enabled: true,
        tools: { ...DEFAULT_PERMISSIONS.tools, list_workspaces: false },
      },
    });
    const res = await callTool(h, "list_workspaces");
    expect(res.isError).toBe(true);
    expect(firstText(res)).toMatch(/disabled/i);
  });

  it("is denied when the master switch is off", async () => {
    await h.close();
    h = await connect(root, {
      config: { enabled: false, tools: { ...DEFAULT_PERMISSIONS.tools } },
    });
    const res = await callTool(h, "list_workspaces");
    expect(res.isError).toBe(true);
    expect(h.audit.recent(10)[0]?.outcome).toBe("denied");
  });
});
