import { describe, it, expect } from "vitest";
import {
  formatTierAgeRange,
  insertTier,
  msToTierAge,
  removeTier,
  setTierGranularity,
  tierAgeToMs,
} from "../retentionEditor";
import type { RetentionPolicy, TierDestinationConfig } from "../types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function policyOf(): RetentionPolicy {
  return {
    tiers: [
      { maxAgeMs: HOUR, granularity: "every" },
      { maxAgeMs: 24 * HOUR, granularity: "hourly" },
      { maxAgeMs: 30 * DAY, granularity: "daily" },
    ],
  };
}

function destOf(): TierDestinationConfig[] {
  return [
    { tierIndex: 0, destinations: ["local"] },
    { tierIndex: 1, destinations: ["local"] },
    { tierIndex: 2, destinations: ["local", "archive"] },
  ];
}

describe("tierAgeToMs / msToTierAge round-trip", () => {
  it("converts whole-unit values exactly", () => {
    expect(tierAgeToMs(2, "hours")).toBe(2 * HOUR);
    expect(tierAgeToMs(7, "days")).toBe(7 * DAY);
    expect(tierAgeToMs(1, "weeks")).toBe(7 * DAY);
  });

  it("clamps non-positive counts to a 1-unit floor", () => {
    expect(tierAgeToMs(0, "days")).toBe(DAY);
    expect(tierAgeToMs(-3, "hours")).toBe(HOUR);
    expect(tierAgeToMs(Number.NaN, "hours")).toBe(HOUR);
  });

  it("msToTierAge picks the largest evenly-divisible unit", () => {
    expect(msToTierAge(DAY)).toEqual({ count: 1, unit: "days" });
    expect(msToTierAge(7 * DAY)).toEqual({ count: 1, unit: "weeks" });
    expect(msToTierAge(2 * HOUR)).toEqual({ count: 2, unit: "hours" });
  });
});

describe("formatTierAgeRange", () => {
  it("renders the first tier as `< X`", () => {
    expect(formatTierAgeRange({ maxAgeMs: HOUR, granularity: "every" }, 0, false))
      .toBe("< 1 hour");
  });

  it("renders mid tiers as `prev – upper`", () => {
    expect(
      formatTierAgeRange(
        { maxAgeMs: 24 * HOUR, granularity: "hourly" },
        HOUR,
        false,
      ),
    ).toBe("1 hour – 1 day");
  });

  it("renders the last tier as `> prev`", () => {
    expect(
      formatTierAgeRange(
        { maxAgeMs: 30 * DAY, granularity: "daily" },
        24 * HOUR,
        true,
      ),
    ).toBe("> 1 day");
  });
});

describe("insertTier", () => {
  it("places a new tier in age order and pads destinations", () => {
    const { policy: nextPolicy, destinations: nextDest } = insertTier(
      policyOf(),
      destOf(),
      { maxAgeMs: 12 * HOUR, granularity: "hourly" },
    );
    expect(nextPolicy.tiers.map((t) => t.maxAgeMs)).toEqual([
      HOUR,
      12 * HOUR,
      24 * HOUR,
      30 * DAY,
    ]);
    expect(nextDest.map((d) => d.tierIndex)).toEqual([0, 1, 2, 3]);
    // New tier inherits ['local']; existing tiers' destinations follow them
    // by maxAgeMs order.
    const insertedIdx = nextPolicy.tiers.findIndex((t) => t.maxAgeMs === 12 * HOUR);
    expect(nextDest[insertedIdx].destinations).toEqual(["local"]);
    const oldestIdx = nextPolicy.tiers.findIndex((t) => t.maxAgeMs === 30 * DAY);
    expect(nextDest[oldestIdx].destinations).toEqual(["local", "archive"]);
  });

  it("dedupes when the new tier's maxAgeMs matches an existing one (new wins)", () => {
    const { policy: nextPolicy } = insertTier(policyOf(), destOf(), {
      maxAgeMs: HOUR,
      granularity: "off",
    });
    expect(nextPolicy.tiers).toHaveLength(3);
    expect(nextPolicy.tiers[0].granularity).toBe("off");
  });
});

describe("removeTier", () => {
  it("removes the tier at the given index and realigns destinations", () => {
    const { policy: nextPolicy, destinations: nextDest } = removeTier(
      policyOf(),
      destOf(),
      1,
    );
    expect(nextPolicy.tiers.map((t) => t.maxAgeMs)).toEqual([HOUR, 30 * DAY]);
    expect(nextDest).toEqual([
      { tierIndex: 0, destinations: ["local"] },
      { tierIndex: 1, destinations: ["local", "archive"] },
    ]);
  });

  it("returns input verbatim for out-of-range index", () => {
    const policy = policyOf();
    const dest = destOf();
    const { policy: same, destinations: sameDest } = removeTier(policy, dest, 99);
    expect(same).toBe(policy);
    expect(sameDest).toBe(dest);
  });
});

describe("setTierGranularity", () => {
  it("replaces the granularity of one tier", () => {
    const next = setTierGranularity(policyOf(), 1, "off");
    expect(next.tiers[1].granularity).toBe("off");
    expect(next.tiers[0].granularity).toBe("every");
  });

  it("returns input verbatim for out-of-range index", () => {
    const policy = policyOf();
    expect(setTierGranularity(policy, -1, "daily")).toBe(policy);
    expect(setTierGranularity(policy, 99, "daily")).toBe(policy);
  });
});
