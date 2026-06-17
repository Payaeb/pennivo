import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { connect, callTool, firstText } from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";
import { DEFAULT_PERMISSIONS } from "../config.js";

describe("permission gating", () => {
  let root: string;

  beforeEach(() => {
    root = seedWorkspace();
  });

  afterEach(() => cleanup(root));

  it("denies a read tool when that tool is disabled", async () => {
    const h = await connect(root, {
      config: {
        enabled: true,
        tools: { ...DEFAULT_PERMISSIONS.tools, read_file: false },
      },
    });
    try {
      const res = await callTool(h, "read_file", { path: "notes.md" });
      expect(res.isError).toBe(true);
      expect(firstText(res)).toMatch(/disabled in Pennivo settings/i);

      const denied = h.audit.recent(10).find((e) => e.tool === "read_file");
      expect(denied?.outcome).toBe("denied");
      expect(denied?.path).toBe("notes.md");
    } finally {
      await h.close();
    }
  });

  it("denies every tool when the master switch is off", async () => {
    const h = await connect(root, {
      config: { enabled: false, tools: { ...DEFAULT_PERMISSIONS.tools } },
    });
    try {
      const res = await callTool(h, "search", { query: "fox" });
      expect(res.isError).toBe(true);
      expect(h.audit.recent(10)[0]?.outcome).toBe("denied");
    } finally {
      await h.close();
    }
  });

  it("allows a read tool that is enabled by default", async () => {
    const h = await connect(root);
    try {
      const res = await callTool(h, "search", { query: "fox" });
      expect(res.isError).toBeFalsy();
    } finally {
      await h.close();
    }
  });
});
