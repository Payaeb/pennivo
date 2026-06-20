import { describe, it, expect } from "vitest";
import { isAgentAuthored, shouldStream } from "../streamingGate";

// Baseline "clean WYSIWYG small file" input; individual tests override fields.
const clean = {
  author: "user" as const,
  agentName: undefined as string | undefined,
  dirty: false,
  sourceMode: false,
  sizeOver: false,
  userOverride: undefined as boolean | undefined,
};

describe("isAgentAuthored", () => {
  it("treats mcp author as agent-written", () => {
    expect(isAgentAuthored("mcp")).toBe(true);
    expect(isAgentAuthored("mcp", undefined)).toBe(true);
  });

  it("treats external author WITH an agent name as agent-written", () => {
    expect(isAgentAuthored("external", "Claude")).toBe(true);
  });

  it("treats external author WITHOUT an agent name as NOT agent-written", () => {
    expect(isAgentAuthored("external")).toBe(false);
    expect(isAgentAuthored("external", "")).toBe(false);
  });

  it("treats user author as NOT agent-written", () => {
    expect(isAgentAuthored("user")).toBe(false);
    expect(isAgentAuthored("user", "Claude")).toBe(false);
  });
});

describe("shouldStream — attribution defaults", () => {
  it("defaults ON for an mcp-authored clean WYSIWYG small file", () => {
    expect(shouldStream({ ...clean, author: "mcp" })).toBe(true);
  });

  it("defaults ON for an external+agentName clean file", () => {
    expect(
      shouldStream({ ...clean, author: "external", agentName: "Claude" }),
    ).toBe(true);
  });

  it("defaults OFF for a normal user save (no agent attribution)", () => {
    expect(shouldStream({ ...clean, author: "user" })).toBe(false);
  });

  it("defaults OFF for an external save with no agent name", () => {
    expect(shouldStream({ ...clean, author: "external" })).toBe(false);
  });
});

describe("shouldStream — user override wins over attribution default", () => {
  it("override true forces streaming on a normal user save", () => {
    expect(shouldStream({ ...clean, author: "user", userOverride: true })).toBe(
      true,
    );
  });

  it("override false forces full reload on an agent write", () => {
    expect(shouldStream({ ...clean, author: "mcp", userOverride: false })).toBe(
      false,
    );
  });

  it("undefined override falls back to the attribution default", () => {
    expect(
      shouldStream({ ...clean, author: "mcp", userOverride: undefined }),
    ).toBe(true);
    expect(
      shouldStream({ ...clean, author: "user", userOverride: undefined }),
    ).toBe(false);
  });
});

describe("shouldStream — hard gates override everything", () => {
  it("never streams in source mode even for an agent write with override on", () => {
    expect(
      shouldStream({
        ...clean,
        author: "mcp",
        sourceMode: true,
        userOverride: true,
      }),
    ).toBe(false);
  });

  it("never streams when the doc is dirty", () => {
    expect(
      shouldStream({
        ...clean,
        author: "mcp",
        dirty: true,
        userOverride: true,
      }),
    ).toBe(false);
  });

  it("never streams when the file is over the size limit", () => {
    expect(
      shouldStream({
        ...clean,
        author: "mcp",
        sizeOver: true,
        userOverride: true,
      }),
    ).toBe(false);
  });
});
