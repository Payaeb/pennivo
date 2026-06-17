import { describe, it, expect } from "vitest";
import {
  DEFAULT_PERMISSIONS,
  READ_TOOLS,
  WRITE_TOOLS,
  mergeAndValidate,
  staticPermissionProvider,
} from "../config.js";

describe("DEFAULT_PERMISSIONS", () => {
  it("enables every read tool", () => {
    for (const tool of READ_TOOLS) {
      expect(DEFAULT_PERMISSIONS.tools[tool]).toBe(true);
    }
  });

  it("disables every write tool", () => {
    for (const tool of WRITE_TOOLS) {
      expect(DEFAULT_PERMISSIONS.tools[tool]).toBe(false);
    }
  });
});

describe("mergeAndValidate", () => {
  it("returns read-only defaults for non-object input", () => {
    expect(mergeAndValidate(null).tools).toEqual(DEFAULT_PERMISSIONS.tools);
    expect(mergeAndValidate(undefined).tools).toEqual(
      DEFAULT_PERMISSIONS.tools,
    );
    expect(mergeAndValidate("garbage").tools).toEqual(
      DEFAULT_PERMISSIONS.tools,
    );
    expect(mergeAndValidate(42).tools).toEqual(DEFAULT_PERMISSIONS.tools);
  });

  it("degrades a corrupt tools field to read-only defaults", () => {
    const result = mergeAndValidate({ enabled: true, tools: "nope" });
    expect(result.tools).toEqual(DEFAULT_PERMISSIONS.tools);
  });

  it("only flips a write tool on when it is explicitly boolean true", () => {
    const result = mergeAndValidate({
      tools: { write_file: true, delete_file: "yes" },
    });
    expect(result.tools.write_file).toBe(true);
    expect(result.tools.delete_file).toBe(false); // non-boolean ignored
  });

  it("ignores unknown tool keys", () => {
    const result = mergeAndValidate({ tools: { not_a_tool: true } });
    expect(result.tools).toEqual(DEFAULT_PERMISSIONS.tools);
  });

  it("respects an explicit disabled master switch", () => {
    expect(mergeAndValidate({ enabled: false }).enabled).toBe(false);
  });

  it("never produces an all-on config from garbage", () => {
    const result = mergeAndValidate({ tools: 12345, enabled: "true" });
    expect(result.enabled).toBe(true); // "true" string is not boolean -> default true
    for (const tool of WRITE_TOOLS) {
      expect(result.tools[tool]).toBe(false);
    }
  });
});

describe("staticPermissionProvider", () => {
  it("allows enabled tools and denies disabled ones", () => {
    const provider = staticPermissionProvider(DEFAULT_PERMISSIONS);
    expect(provider.isAllowed("read_file")).toBe(true);
    expect(provider.isAllowed("write_file")).toBe(false);
    expect(provider.isEnabled()).toBe(true);
  });

  it("denies all tools when the master switch is off", () => {
    const provider = staticPermissionProvider({
      enabled: false,
      tools: { ...DEFAULT_PERMISSIONS.tools, write_file: true },
    });
    expect(provider.isAllowed("read_file")).toBe(false);
    expect(provider.isAllowed("write_file")).toBe(false);
    expect(provider.isEnabled()).toBe(false);
  });
});
