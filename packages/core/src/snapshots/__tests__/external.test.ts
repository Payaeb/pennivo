import { describe, it, expect } from "vitest";
import { detectExternalChange } from "../external";
import type { Snapshot } from "../types";

function snap(contentHash: string): Snapshot {
  return {
    id: "id1",
    ts: 0,
    sizeBytes: 0,
    contentHash,
    author: "user",
    deviceId: "dev1",
  };
}

describe("detectExternalChange", () => {
  it("returns 'first-seen' when there is no prior snapshot", () => {
    expect(detectExternalChange("h1", undefined)).toBe("first-seen");
  });

  it("returns 'unchanged' when disk hash matches the most recent snapshot", () => {
    expect(detectExternalChange("h1", snap("h1"))).toBe("unchanged");
  });

  it("returns 'external' when disk hash differs from the most recent snapshot", () => {
    expect(detectExternalChange("h2", snap("h1"))).toBe("external");
  });

  it("treats empty disk hash as a real value (still detects external)", () => {
    expect(detectExternalChange("", snap("h1"))).toBe("external");
  });
});
