import { describe, it, expect } from "vitest";
import {
  defaultRetentionPolicy,
  prune,
  tierForAge,
} from "../retention";
import type {
  RetentionPolicy,
  RetentionTier,
  Snapshot,
} from "../types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// `now` reference used everywhere — picked so that day/hour boundaries
// align cleanly without DST wobble (UTC throughout). 2026-06-15T12:00:00Z.
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

function snap(overrides: Partial<Snapshot> & { id: string; ts: number }): Snapshot {
  return {
    sizeBytes: 1024,
    contentHash: `hash-${overrides.id}`,
    author: "user",
    deviceId: "dev1",
    ...overrides,
  };
}

function ids(arr: Snapshot[]): string[] {
  return arr.map((s) => s.id);
}

// ─────────────────────────────────────────────────────────────────────────
// defaultRetentionPolicy
// ─────────────────────────────────────────────────────────────────────────

describe("defaultRetentionPolicy", () => {
  it("matches the documented defaults", () => {
    const policy = defaultRetentionPolicy();
    expect(policy.tiers).toEqual([
      { maxAgeMs: HOUR_MS, granularity: "every" },
      { maxAgeMs: 24 * HOUR_MS, granularity: "hourly" },
      { maxAgeMs: 30 * DAY_MS, granularity: "daily" },
    ]);
    expect(policy.maxStorageBytes).toBe(200 * 1024 * 1024);
  });

  it("returns a fresh object on each call", () => {
    const a = defaultRetentionPolicy();
    const b = defaultRetentionPolicy();
    expect(a).not.toBe(b);
    expect(a.tiers).not.toBe(b.tiers);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// tierForAge
// ─────────────────────────────────────────────────────────────────────────

describe("tierForAge", () => {
  const tiers: RetentionTier[] = [
    { maxAgeMs: HOUR_MS, granularity: "every" },
    { maxAgeMs: 24 * HOUR_MS, granularity: "hourly" },
    { maxAgeMs: 30 * DAY_MS, granularity: "daily" },
  ];

  it("returns the freshest tier for age 0", () => {
    expect(tierForAge(0, tiers)).toEqual({ index: 0, tier: tiers[0] });
  });

  it("returns the second tier exactly at the first boundary (exclusive)", () => {
    // The boundary is exclusive: age == maxAgeMs falls into the NEXT tier.
    expect(tierForAge(HOUR_MS, tiers)).toEqual({ index: 1, tier: tiers[1] });
  });

  it("returns the second tier just before the next boundary", () => {
    expect(tierForAge(24 * HOUR_MS - 1, tiers)).toEqual({
      index: 1,
      tier: tiers[1],
    });
  });

  it("returns the third tier at the second boundary", () => {
    expect(tierForAge(24 * HOUR_MS, tiers)).toEqual({
      index: 2,
      tier: tiers[2],
    });
  });

  it("returns undefined past the final boundary", () => {
    expect(tierForAge(30 * DAY_MS, tiers)).toBeUndefined();
    expect(tierForAge(365 * DAY_MS, tiers)).toBeUndefined();
  });

  it("treats 'forever' as an infinite upper bound", () => {
    const tiersWithForever: RetentionTier[] = [
      ...tiers,
      { maxAgeMs: 365 * DAY_MS, granularity: "forever" },
    ];
    expect(tierForAge(10 * 365 * DAY_MS, tiersWithForever)).toEqual({
      index: 3,
      tier: tiersWithForever[3],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — single tier behaviours
// ─────────────────────────────────────────────────────────────────────────

describe("prune — single tier", () => {
  it("'every' keeps all snapshots within the tier's age range", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "every" }],
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1 }),
      snap({ id: "b", ts: NOW - 60_000 }),
      snap({ id: "c", ts: NOW - 30 * 60_000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep)).toEqual(["a", "b", "c"]);
    expect(result.evict).toEqual([]);
  });

  it("'hourly' keeps the latest snapshot per hour bucket", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: 10 * DAY_MS, granularity: "hourly" }],
    };
    // Three snapshots in hour bucket A, two in hour bucket B.
    const hourA = Date.UTC(2026, 5, 14, 10, 0, 0);
    const hourB = Date.UTC(2026, 5, 14, 11, 0, 0);
    const snapshots = [
      snap({ id: "a1", ts: hourA + 1000 }),
      snap({ id: "a2", ts: hourA + 2000 }),
      snap({ id: "a3", ts: hourA + 3000 }), // latest in A
      snap({ id: "b1", ts: hourB + 500 }),
      snap({ id: "b2", ts: hourB + 1500 }), // latest in B
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["a3", "b2"]);
    expect(ids(result.evict).sort()).toEqual(["a1", "a2", "b1"]);
  });

  it("'daily' keeps the latest snapshot per UTC day", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: 60 * DAY_MS, granularity: "daily" }],
    };
    const day1 = Date.UTC(2026, 5, 10, 0, 0, 0);
    const day2 = Date.UTC(2026, 5, 11, 0, 0, 0);
    const snapshots = [
      snap({ id: "d1-a", ts: day1 + 1000 }),
      snap({ id: "d1-b", ts: day1 + 23 * HOUR_MS }), // latest in day1
      snap({ id: "d2-a", ts: day2 + 1000 }),
      snap({ id: "d2-b", ts: day2 + 5 * HOUR_MS }), // latest in day2
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["d1-b", "d2-b"]);
  });

  it("'weekly' keeps the latest snapshot per ISO week (Mon-anchored UTC)", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: 365 * DAY_MS, granularity: "weekly" }],
    };
    // 2026-06-08 is a Monday (start of ISO week).
    const monday = Date.UTC(2026, 5, 8, 0, 0, 0);
    const sunday = monday + 6 * DAY_MS + 23 * HOUR_MS; // same week, Sunday
    const nextMonday = monday + 7 * DAY_MS;
    const snapshots = [
      snap({ id: "w1-a", ts: monday + 1000 }),
      snap({ id: "w1-b", ts: sunday }), // latest in week 1
      snap({ id: "w2-a", ts: nextMonday + 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["w1-b", "w2-a"]);
  });

  it("'monthly' keeps the latest snapshot per UTC year+month", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: 5 * 365 * DAY_MS, granularity: "monthly" }],
    };
    const may = Date.UTC(2026, 4, 15, 0, 0, 0);
    const june = Date.UTC(2026, 5, 1, 0, 0, 0);
    const snapshots = [
      snap({ id: "m-may-1", ts: may }),
      snap({ id: "m-may-2", ts: may + 5 * DAY_MS }), // latest in May
      snap({ id: "m-jun-1", ts: june }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["m-jun-1", "m-may-2"]);
  });

  it("'yearly' keeps the latest snapshot per UTC year", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: 50 * 365 * DAY_MS, granularity: "yearly" }],
    };
    const y2025 = Date.UTC(2025, 5, 15, 0, 0, 0);
    const y2026 = Date.UTC(2026, 0, 1, 0, 0, 0);
    const snapshots = [
      snap({ id: "2025-jan", ts: Date.UTC(2025, 0, 1) }),
      snap({ id: "2025-jun", ts: y2025 }), // latest in 2025
      snap({ id: "2026-jan", ts: y2026 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["2025-jun", "2026-jan"]);
  });

  it("'forever' keeps every snapshot regardless of age", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "forever" }],
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1 }),
      snap({ id: "b", ts: NOW - 100 * 365 * DAY_MS }), // ancient
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["a", "b"]);
    expect(result.evict).toEqual([]);
  });

  it("'off' evicts every snapshot in the tier", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "off" }],
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1 }),
      snap({ id: "b", ts: NOW - 60_000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(result.keep).toEqual([]);
    expect(ids(result.evict).sort()).toEqual(["a", "b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — multi-tier composition
// ─────────────────────────────────────────────────────────────────────────

describe("prune — multi-tier composition", () => {
  it("evicts snapshots beyond the last tier when the last tier is not forever", () => {
    const policy = defaultRetentionPolicy();
    const ancient = snap({ id: "ancient", ts: NOW - 100 * DAY_MS });
    const recent = snap({ id: "recent", ts: NOW - 10 });
    const result = prune([ancient, recent], policy, NOW);
    expect(ids(result.keep)).toEqual(["recent"]);
    expect(ids(result.evict)).toEqual(["ancient"]);
  });

  it("keeps snapshots beyond the documented tiers when last tier is 'forever'", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "daily" },
        { maxAgeMs: 365 * DAY_MS, granularity: "forever" },
      ],
    };
    const ancient = snap({ id: "ancient", ts: NOW - 10 * 365 * DAY_MS });
    const result = prune([ancient], policy, NOW);
    expect(ids(result.keep)).toEqual(["ancient"]);
  });

  it("applies the right granularity to each tier independently", () => {
    const policy = defaultRetentionPolicy();
    // Tier 0 (< 1h, every): two snapshots — both kept.
    const t0a = snap({ id: "t0a", ts: NOW - 1000 });
    const t0b = snap({ id: "t0b", ts: NOW - 30 * 60_000 });
    // Tier 1 (1h–24h, hourly): three snapshots in same hour — only latest.
    const hour = Date.UTC(2026, 5, 15, 6, 0, 0); // 6 hours before NOW
    const t1a = snap({ id: "t1a", ts: hour + 1000 });
    const t1b = snap({ id: "t1b", ts: hour + 2000 });
    const t1c = snap({ id: "t1c", ts: hour + 3000 }); // latest
    // Tier 2 (24h–30d, daily): two snapshots in same day — only latest.
    const day = Date.UTC(2026, 5, 1, 0, 0, 0); // 14 days before NOW
    const t2a = snap({ id: "t2a", ts: day + 1000 });
    const t2b = snap({ id: "t2b", ts: day + 5 * HOUR_MS }); // latest

    const result = prune(
      [t0a, t0b, t1a, t1b, t1c, t2a, t2b],
      policy,
      NOW,
    );
    expect(ids(result.keep).sort()).toEqual(["t0a", "t0b", "t1c", "t2b"]);
    expect(ids(result.evict).sort()).toEqual(["t1a", "t1b", "t2a"]);
  });

  it("supports custom user-edited tier tables (extra rows, novel granularities)", () => {
    // 5-tier policy a power user might build.
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 24 * HOUR_MS, granularity: "hourly" },
        { maxAgeMs: 30 * DAY_MS, granularity: "daily" },
        { maxAgeMs: 365 * DAY_MS, granularity: "weekly" },
        { maxAgeMs: 7 * 365 * DAY_MS, granularity: "monthly" },
      ],
    };
    // One snapshot in each tier.
    const t0 = snap({ id: "t0", ts: NOW - 60_000 });
    const t1 = snap({ id: "t1", ts: NOW - 5 * HOUR_MS });
    const t2 = snap({ id: "t2", ts: NOW - 5 * DAY_MS });
    const t3 = snap({ id: "t3", ts: NOW - 60 * DAY_MS });
    const t4 = snap({ id: "t4", ts: NOW - 2 * 365 * DAY_MS });
    const ancient = snap({ id: "ancient", ts: NOW - 10 * 365 * DAY_MS });

    const result = prune([t0, t1, t2, t3, t4, ancient], policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["t0", "t1", "t2", "t3", "t4"]);
    expect(ids(result.evict)).toEqual(["ancient"]);
  });

  it("handles future-dated snapshots (clock skew) by treating them as fresh", () => {
    const policy = defaultRetentionPolicy();
    const future = snap({ id: "future", ts: NOW + 60_000 });
    const result = prune([future], policy, NOW);
    expect(ids(result.keep)).toEqual(["future"]);
  });

  it("returns input order in both keep and evict arrays", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "off" }],
    };
    const a = snap({ id: "a", ts: NOW - 1 });
    const b = snap({ id: "b", ts: NOW - 2 });
    const c = snap({ id: "c", ts: NOW - 3 });
    const result = prune([a, b, c], policy, NOW);
    expect(ids(result.evict)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate input arrays", () => {
    const policy = defaultRetentionPolicy();
    const snapshots = [snap({ id: "a", ts: NOW - 1 })];
    const original = [...snapshots];
    prune(snapshots, policy, NOW);
    expect(snapshots).toEqual(original);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — global size cap
// ─────────────────────────────────────────────────────────────────────────

describe("prune — size cap", () => {
  it("does not evict beyond the tiered policy when total is under cap", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "every" }],
      maxStorageBytes: 10_000,
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "b", ts: NOW - 2, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["a", "b"]);
  });

  it("evicts oldest first from the lowest-priority tier when over cap", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" }, // priority 0 (highest)
        { maxAgeMs: 24 * HOUR_MS, granularity: "every" }, // priority 1
        { maxAgeMs: 30 * DAY_MS, granularity: "every" }, // priority 2 (lowest)
      ],
      maxStorageBytes: 3000,
    };
    // 6 snapshots, 1000 bytes each, 2 per tier.
    const snapshots = [
      snap({ id: "t0-old", ts: NOW - 30 * 60_000, sizeBytes: 1000 }),
      snap({ id: "t0-new", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "t1-old", ts: NOW - 10 * HOUR_MS, sizeBytes: 1000 }),
      snap({ id: "t1-new", ts: NOW - 2 * HOUR_MS, sizeBytes: 1000 }),
      snap({ id: "t2-old", ts: NOW - 20 * DAY_MS, sizeBytes: 1000 }),
      snap({ id: "t2-new", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    // 6000 bytes, cap 3000 → must evict 3000 bytes worth.
    // Lowest-priority tier (t2) first, oldest first → t2-old, then t2-new.
    // Still 4000 > 3000 → walk up to tier 1, oldest first → t1-old.
    // Now 3000 ≤ 3000 → stop.
    expect(ids(result.keep).sort()).toEqual(["t0-new", "t0-old", "t1-new"]);
    expect(ids(result.evict).sort()).toEqual(["t1-old", "t2-new", "t2-old"]);
  });

  it("walks up to higher-priority tiers when lowest tier alone is not enough", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "every" },
      ],
      maxStorageBytes: 1500,
    };
    const snapshots = [
      snap({ id: "t0-a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "t0-b", ts: NOW - 2, sizeBytes: 1000 }),
      snap({ id: "t1-a", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    // 3000 bytes, cap 1500 → evict t1-a (lowest-priority), then t0-b (oldest in t0).
    expect(ids(result.keep)).toEqual(["t0-a"]);
  });

  it("size cap protects forever tiers; cap can be exceeded if forever tiers alone exceed it", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "forever" },
      ],
      maxStorageBytes: 500,
    };
    const snapshots = [
      snap({ id: "t0-a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "forever-a", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
      snap({ id: "forever-b", ts: NOW - 10 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    // Cap (500) < forever total (2000). We must keep both forever snapshots
    // — so the cap is necessarily exceeded — but t0-a in the non-forever
    // tier must be evicted before we give up trying to satisfy the cap.
    expect(ids(result.keep).sort()).toEqual(["forever-a", "forever-b"]);
    expect(ids(result.evict)).toEqual(["t0-a"]);
  });

  it("undefined maxStorageBytes means unlimited", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "every" }],
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1, sizeBytes: 10_000_000 }),
      snap({ id: "b", ts: NOW - 2, sizeBytes: 10_000_000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["a", "b"]);
  });

  it("cap evicts nothing when total kept already equals the cap exactly", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "every" }],
      maxStorageBytes: 2000,
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "b", ts: NOW - 2, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(ids(result.keep).sort()).toEqual(["a", "b"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — empty / degenerate inputs
// ─────────────────────────────────────────────────────────────────────────

describe("prune — degenerate inputs", () => {
  it("returns empty arrays for empty snapshot input", () => {
    const result = prune([], defaultRetentionPolicy(), NOW);
    expect(result.keep).toEqual([]);
    expect(result.evict).toEqual([]);
  });

  it("evicts everything when policy has zero tiers", () => {
    const policy: RetentionPolicy = { tiers: [] };
    const result = prune(
      [snap({ id: "a", ts: NOW - 1 })],
      policy,
      NOW,
    );
    expect(result.keep).toEqual([]);
    expect(ids(result.evict)).toEqual(["a"]);
  });

  it("handles a single snapshot equal to its hash bucket boundary", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "every" }],
    };
    const result = prune(
      [snap({ id: "boundary", ts: NOW - HOUR_MS + 1 })],
      policy,
      NOW,
    );
    expect(ids(result.keep)).toEqual(["boundary"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — cap-exceeded warning
// ─────────────────────────────────────────────────────────────────────────

describe("prune — cap-exceeded warning", () => {
  it("emits a cap-exceeded warning when forever-tier protection forces the cap to be exceeded", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "forever" },
      ],
      maxStorageBytes: 500,
    };
    const snapshots = [
      snap({ id: "t0-a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "forever-a", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
      snap({ id: "forever-b", ts: NOW - 10 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);

    // Pruner evicted the only non-forever snapshot but is still 1500 over.
    expect(ids(result.keep).sort()).toEqual(["forever-a", "forever-b"]);
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0]!;
    expect(w.kind).toBe("cap-exceeded");
    if (w.kind === "cap-exceeded") {
      expect(w.currentBytes).toBe(2000);
      expect(w.capBytes).toBe(500);
      expect(w.overageBytes).toBe(1500);
      expect(w.protectedBytes).toBe(2000);
      expect(w.protectedSnapshotCount).toBe(2);
      // Sanity: an actionable warning must point the user at protected data.
      expect(w.protectedSnapshotCount).toBeGreaterThan(0);
      expect(w.overageBytes).toBeGreaterThan(0);
    }
  });

  it("emits no warning when maxStorageBytes is undefined, even with huge storage", () => {
    const policy: RetentionPolicy = {
      tiers: [{ maxAgeMs: HOUR_MS, granularity: "forever" }],
    };
    const snapshots = [
      snap({ id: "huge-a", ts: NOW - 1, sizeBytes: 1_000_000_000 }),
      snap({ id: "huge-b", ts: NOW - 2, sizeBytes: 1_000_000_000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    expect(result.warnings).toEqual([]);
    expect(ids(result.keep).sort()).toEqual(["huge-a", "huge-b"]);
  });

  it("emits no warning when the cap is honored after eviction", () => {
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "every" },
      ],
      maxStorageBytes: 1500,
    };
    const snapshots = [
      snap({ id: "t0-a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "t0-b", ts: NOW - 2, sizeBytes: 1000 }),
      snap({ id: "t1-a", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    // Eviction brings total to 1000, comfortably under the 1500 cap.
    expect(result.warnings).toEqual([]);
    expect(ids(result.keep)).toEqual(["t0-a"]);
  });

  it("never warns when no forever tiers exist (defensive: pruner can always honor the cap)", () => {
    // If every tier is non-forever the pruner can always evict its way under
    // the cap; this test guards against a regression where a future code
    // path leaks a warning despite the cap actually being honored.
    const policy: RetentionPolicy = {
      tiers: [
        { maxAgeMs: HOUR_MS, granularity: "every" },
        { maxAgeMs: 30 * DAY_MS, granularity: "every" },
      ],
      maxStorageBytes: 100,
    };
    const snapshots = [
      snap({ id: "a", ts: NOW - 1, sizeBytes: 1000 }),
      snap({ id: "b", ts: NOW - 2, sizeBytes: 1000 }),
      snap({ id: "c", ts: NOW - 5 * DAY_MS, sizeBytes: 1000 }),
    ];
    const result = prune(snapshots, policy, NOW);
    const totalKept = result.keep.reduce((sum, s) => sum + s.sizeBytes, 0);
    expect(totalKept).toBeLessThanOrEqual(100);
    expect(result.warnings).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// prune — return shape stability
// ─────────────────────────────────────────────────────────────────────────

describe("prune — return shape", () => {
  it("always returns a warnings array (empty when nothing is wrong)", () => {
    const result = prune([], defaultRetentionPolicy(), NOW);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
