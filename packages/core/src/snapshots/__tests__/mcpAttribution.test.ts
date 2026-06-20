import { describe, it, expect } from "vitest";
import {
  matchMcpWrite,
  parseAuditLines,
  MCP_WRITE_TOOLS,
  type McpAuditEvent,
} from "../mcpAttribution";

function ev(over: Partial<McpAuditEvent>): McpAuditEvent {
  return {
    ts: 1000,
    agent: "Claude",
    tool: "write_file",
    path: "notes/a.md",
    outcome: "ok",
    ...over,
  };
}

const NOW = 1_000_000;
const WINDOW = 5 * 60 * 1000; // 5 minutes

describe("matchMcpWrite", () => {
  it("matches the most recent ok write for the path within the window", () => {
    const events = [
      ev({ ts: NOW - 1000, agent: "Claude", path: "notes/a.md" }),
    ];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toEqual({
      agentName: "Claude",
    });
  });

  it("picks the most-recent qualifying event when multiple match", () => {
    const events = [
      ev({ ts: NOW - 4000, agent: "Older" }),
      ev({ ts: NOW - 1000, agent: "Newest" }),
      ev({ ts: NOW - 2500, agent: "Middle" }),
    ];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)?.agentName).toBe(
      "Newest",
    );
  });

  it("ignores events outside (older than) the recency window", () => {
    const events = [ev({ ts: NOW - WINDOW - 1, agent: "TooOld" })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("ignores events in the future relative to now", () => {
    const events = [ev({ ts: NOW + 5000, agent: "Future" })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("ignores non-write tools (e.g. read_file)", () => {
    const events = [ev({ ts: NOW - 1000, tool: "read_file" })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("ignores events whose outcome is not 'ok'", () => {
    const events = [
      ev({ ts: NOW - 1000, outcome: "error" }),
      ev({ ts: NOW - 1500, outcome: "denied" }),
    ];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("ignores events for a different path", () => {
    const events = [ev({ ts: NOW - 1000, path: "notes/b.md" })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("returns null when there are no events at all", () => {
    expect(matchMcpWrite([], "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("compares paths case-insensitively and slash-agnostically", () => {
    const events = [ev({ ts: NOW - 1000, path: "Notes\\A.md" })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)?.agentName).toBe(
      "Claude",
    );
  });

  it("normalizes a leading './' on either side", () => {
    const events = [ev({ ts: NOW - 1000, path: "./notes/a.md" })];
    expect(matchMcpWrite(events, "./notes/a.md", WINDOW, NOW)?.agentName).toBe(
      "Claude",
    );
  });

  it("skips events missing a path", () => {
    const events = [ev({ ts: NOW - 1000, path: undefined })];
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)).toBeNull();
  });

  it("honors a custom writeTools set", () => {
    const tools = new Set(["custom_write"]);
    const events = [ev({ ts: NOW - 1000, tool: "custom_write" })];
    expect(
      matchMcpWrite(events, "notes/a.md", WINDOW, NOW, tools)?.agentName,
    ).toBe("Claude");
    // write_file is not in the custom set -> no match
    const wf = [ev({ ts: NOW - 1000, tool: "write_file" })];
    expect(matchMcpWrite(wf, "notes/a.md", WINDOW, NOW, tools)).toBeNull();
  });

  it("recognizes the documented MCP write tool names by default", () => {
    for (const tool of MCP_WRITE_TOOLS) {
      const events = [ev({ ts: NOW - 1000, tool, agent: tool })];
      expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)?.agentName).toBe(
        tool,
      );
    }
  });
});

describe("parseAuditLines", () => {
  it("parses well-formed JSONL lines into events", () => {
    const text =
      JSON.stringify({
        ts: 1,
        agent: "A",
        tool: "write_file",
        path: "a.md",
        outcome: "ok",
      }) +
      "\n" +
      JSON.stringify({ ts: 2, agent: "B", tool: "read_file", outcome: "ok" });
    const events = parseAuditLines(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({
      ts: 1,
      agent: "A",
      tool: "write_file",
      path: "a.md",
      outcome: "ok",
    });
    expect(events[1].path).toBeUndefined();
  });

  it("skips blank lines and a truncated leading line from a tail read", () => {
    const partial = '{"ts":1,"agent":"A","tool":"wr';
    const good = JSON.stringify({
      ts: 2,
      agent: "B",
      tool: "write_file",
      path: "b.md",
      outcome: "ok",
    });
    const events = parseAuditLines(partial + "\n\n" + good + "\n");
    expect(events).toHaveLength(1);
    expect(events[0].agent).toBe("B");
  });

  it("drops objects missing required fields or with wrong types", () => {
    const lines = [
      JSON.stringify({ agent: "A", tool: "write_file", outcome: "ok" }), // no ts
      JSON.stringify({ ts: "x", agent: "A", tool: "t", outcome: "ok" }), // ts wrong type
      JSON.stringify({ ts: 1, tool: "t", outcome: "ok" }), // no agent
      JSON.stringify([1, 2, 3]), // not an object
      "not json at all",
    ].join("\n");
    expect(parseAuditLines(lines)).toEqual([]);
  });

  it("feeds matchMcpWrite end-to-end", () => {
    const text = JSON.stringify({
      ts: NOW - 1000,
      agent: "Claude",
      tool: "edit_file",
      path: "notes/a.md",
      outcome: "ok",
    });
    const events = parseAuditLines(text);
    expect(matchMcpWrite(events, "notes/a.md", WINDOW, NOW)?.agentName).toBe(
      "Claude",
    );
  });
});
