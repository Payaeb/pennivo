import { describe, it, expect } from "vitest";
import { shouldDedupe } from "../dedupe";
import type { Snapshot } from "../types";

function fixture(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "id1",
    ts: 0,
    sizeBytes: 0,
    contentHash: "hash-a",
    author: "user",
    deviceId: "dev1",
    ...overrides,
  };
}

describe("shouldDedupe", () => {
  it("returns true when hashes match", () => {
    expect(shouldDedupe("hash-a", fixture({ contentHash: "hash-a" }))).toBe(
      true,
    );
  });

  it("returns false when hashes differ", () => {
    expect(shouldDedupe("hash-b", fixture({ contentHash: "hash-a" }))).toBe(
      false,
    );
  });

  it("returns false when there is no prior snapshot", () => {
    expect(shouldDedupe("hash-a", undefined)).toBe(false);
  });
});
