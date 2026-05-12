import { describe, it, expect } from "vitest";
import { computeExpiresAtMs, findExpired } from "../expiry";
import type { TrashEntry } from "../types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T = Date.UTC(2026, 4, 7, 12, 0, 0); // 2026-05-07 12:00:00 UTC

describe("computeExpiresAtMs", () => {
  it("30-day default adds 30 * 86_400_000 ms", () => {
    expect(computeExpiresAtMs(T, 30)).toBe(T + 30 * MS_PER_DAY);
  });

  it("7-day retention", () => {
    expect(computeExpiresAtMs(T, 7)).toBe(T + 7 * MS_PER_DAY);
  });

  it("90-day retention", () => {
    expect(computeExpiresAtMs(T, 90)).toBe(T + 90 * MS_PER_DAY);
  });

  it("365-day retention", () => {
    expect(computeExpiresAtMs(T, 365)).toBe(T + 365 * MS_PER_DAY);
  });

  it("Forever sentinel (-1) returns null", () => {
    expect(computeExpiresAtMs(T, -1)).toBeNull();
  });

  it("non-positive values (incl 0 and negative) all map to Forever", () => {
    expect(computeExpiresAtMs(T, 0)).toBeNull();
    expect(computeExpiresAtMs(T, -7)).toBeNull();
  });

  it("Infinity maps to Forever", () => {
    expect(computeExpiresAtMs(T, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("NaN maps to Forever (defensive)", () => {
    expect(computeExpiresAtMs(T, Number.NaN)).toBeNull();
  });

  it("fractional retention is allowed (caller's call)", () => {
    expect(computeExpiresAtMs(T, 1.5)).toBe(T + 1.5 * MS_PER_DAY);
  });
});

function makeEntry(deletedAtMs: number, expiresAtMs: number | null): TrashEntry {
  return {
    id: `dummy-${deletedAtMs}`,
    absolutePath: "/foo/bar.md",
    fileBasename: "bar.md",
    deletedAtMs,
    expiresAtMs,
    hasAssets: false,
    assetFolderNames: [],
  };
}

describe("findExpired", () => {
  it("returns entries whose expiresAtMs is on or before now", () => {
    const entries = [
      makeEntry(T - 40 * MS_PER_DAY, T - 10 * MS_PER_DAY), // expired
      makeEntry(T - 20 * MS_PER_DAY, T + 10 * MS_PER_DAY), // not yet
      makeEntry(T - 50 * MS_PER_DAY, T - 20 * MS_PER_DAY), // expired
    ];
    const out = findExpired(entries, T);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.deletedAtMs)).toEqual([
      T - 40 * MS_PER_DAY,
      T - 50 * MS_PER_DAY,
    ]);
  });

  it("treats expiresAtMs === now as expired (boundary)", () => {
    const entries = [makeEntry(T - 10 * MS_PER_DAY, T)];
    expect(findExpired(entries, T)).toHaveLength(1);
  });

  it("excludes Forever entries (expiresAtMs === null)", () => {
    const entries = [
      makeEntry(T - 10 * MS_PER_DAY, null),
      makeEntry(T - 10 * MS_PER_DAY, T - 1),
    ];
    const out = findExpired(entries, T);
    expect(out).toHaveLength(1);
    expect(out[0]!.expiresAtMs).toBe(T - 1);
  });

  it("returns empty when nothing has expired", () => {
    const entries = [makeEntry(T, T + MS_PER_DAY), makeEntry(T, null)];
    expect(findExpired(entries, T)).toEqual([]);
  });

  it("returns empty for empty input", () => {
    expect(findExpired([], T)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const entries = [
      makeEntry(T - 10 * MS_PER_DAY, T - 1),
      makeEntry(T, T + 1),
    ];
    const before = entries.slice();
    findExpired(entries, T);
    expect(entries).toEqual(before);
  });
});
