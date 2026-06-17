import { describe, it, expect } from "vitest";
import { mergeServerIntoConfig, buildConfigSnippet } from "../clientConfig.js";

describe("mergeServerIntoConfig", () => {
  it("adds the server under mcpServers in an empty config", () => {
    const result = mergeServerIntoConfig({}, "pennivo", {
      command: "npx",
      args: ["-y", "@pennivo/mcp-server", "--workspace", "/notes"],
    });
    expect(result).toEqual({
      mcpServers: {
        pennivo: {
          command: "npx",
          args: ["-y", "@pennivo/mcp-server", "--workspace", "/notes"],
        },
      },
    });
  });

  it("preserves other servers and top-level keys", () => {
    const existing = {
      someTopLevel: true,
      mcpServers: { other: { command: "other-bin" } },
    };
    const result = mergeServerIntoConfig(existing, "pennivo", {
      command: "pennivo.exe",
      args: ["--mcp"],
    });
    expect(result.someTopLevel).toBe(true);
    expect((result.mcpServers as Record<string, unknown>).other).toEqual({
      command: "other-bin",
    });
    expect((result.mcpServers as Record<string, unknown>).pennivo).toEqual({
      command: "pennivo.exe",
      args: ["--mcp"],
    });
  });

  it("overwrites only the named server on re-merge", () => {
    const first = mergeServerIntoConfig({}, "pennivo", { command: "old" });
    const second = mergeServerIntoConfig(first, "pennivo", {
      command: "new",
      args: ["--mcp"],
    });
    expect((second.mcpServers as Record<string, unknown>).pennivo).toEqual({
      command: "new",
      args: ["--mcp"],
    });
  });

  it("tolerates malformed existing config / mcpServers", () => {
    expect(
      mergeServerIntoConfig(null, "pennivo", { command: "x" }).mcpServers,
    ).toBeDefined();
    expect(
      mergeServerIntoConfig("garbage", "pennivo", { command: "x" }).mcpServers,
    ).toBeDefined();
    expect(
      mergeServerIntoConfig({ mcpServers: "nope" }, "pennivo", { command: "x" })
        .mcpServers,
    ).toEqual({ pennivo: { command: "x" } });
  });

  it("omits empty args/env", () => {
    const result = mergeServerIntoConfig({}, "pennivo", {
      command: "x",
      args: [],
      env: {},
    });
    expect((result.mcpServers as Record<string, unknown>).pennivo).toEqual({
      command: "x",
    });
  });
});

describe("buildConfigSnippet", () => {
  it("produces pretty JSON for just the named server", () => {
    const snippet = buildConfigSnippet("pennivo", {
      command: "npx",
      args: ["-y", "@pennivo/mcp-server"],
    });
    expect(snippet).toContain('"mcpServers"');
    expect(snippet).toContain('"pennivo"');
    expect(JSON.parse(snippet)).toHaveProperty(
      "mcpServers.pennivo.command",
      "npx",
    );
  });
});
