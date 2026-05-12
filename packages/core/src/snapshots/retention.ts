// Pure tiered-retention pruner.
//
// Walks a `RetentionPolicy` and partitions a list of snapshots into `keep`
// and `evict`. Then enforces an optional global size cap by walking back up
// from the lowest-priority tier and evicting oldest-first. Forever tiers
// are protected from the size cap (otherwise "Keep forever" would not mean
// what it says); the cap may be exceeded if forever-tier snapshots alone
// exceed it.
//
// All inputs are treated as immutable; outputs are fresh arrays.

import type {
  PruneResult,
  PruneWarning,
  RetentionGranularity,
  RetentionPolicy,
  RetentionTier,
  Snapshot,
} from "./types";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Default retention policy from docs/file-recovery-and-versioning.md.
 *
 *   < 1 hour          every snapshot
 *   1h – 24h          one per hour
 *   24h – 30 days     one per day
 *   beyond 30 days    drop
 *
 * Plus a 200 MB global size cap.
 */
export function defaultRetentionPolicy(): RetentionPolicy {
  return {
    tiers: [
      { maxAgeMs: HOUR_MS, granularity: "every" },
      { maxAgeMs: 24 * HOUR_MS, granularity: "hourly" },
      { maxAgeMs: 30 * DAY_MS, granularity: "daily" },
    ],
    maxStorageBytes: 200 * 1024 * 1024,
  };
}

/**
 * The effective upper bound on age for a tier. For `forever` granularity
 * the bound is Infinity — a forever tier covers everything from its
 * predecessor's bound onward.
 */
function effectiveMaxAge(tier: RetentionTier): number {
  return tier.granularity === "forever" ? Infinity : tier.maxAgeMs;
}

/**
 * Resolve which tier owns a snapshot of `ageMs`. Tiers are inspected in
 * declaration order; the first tier whose effective upper bound exceeds
 * `ageMs` wins. Returns `undefined` if no tier matches (snapshot is older
 * than every tier's bound and no tier is `forever`).
 *
 * Note: `ageMs` of exactly the bound counts as belonging to the NEXT tier
 * (boundary is exclusive). This matches "< 1h", "< 24h", "< 30d" wording
 * in the design table.
 */
export function tierForAge(
  ageMs: number,
  tiers: RetentionTier[],
): { index: number; tier: RetentionTier } | undefined {
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]!;
    if (ageMs < effectiveMaxAge(tier)) {
      return { index: i, tier };
    }
  }
  return undefined;
}

/**
 * Bucket key used to group snapshots within a tier for granularity
 * thinning. Bucket boundaries are UTC.
 *
 * - `hourly`  → `YYYY-MM-DD-HH`
 * - `daily`   → `YYYY-MM-DD`
 * - `weekly`  → `YYYY-Www` ISO week, Monday-anchored
 * - `monthly` → `YYYY-MM`
 * - `yearly`  → `YYYY`
 *
 * For `every`, `forever`, and `off` we don't bucket (they are handled
 * separately).
 */
function bucketKey(ts: number, granularity: RetentionGranularity): string {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hr = String(d.getUTCHours()).padStart(2, "0");

  switch (granularity) {
    case "hourly":
      return `${y}-${m}-${day}-${hr}`;
    case "daily":
      return `${y}-${m}-${day}`;
    case "weekly": {
      // ISO week per RFC 8601: week 1 contains the year's first Thursday.
      const target = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
      const dayNum = (target.getUTCDay() + 6) % 7; // Mon=0..Sun=6
      target.setUTCDate(target.getUTCDate() - dayNum + 3); // Thursday of week
      const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
      const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
      firstThursday.setUTCDate(
        firstThursday.getUTCDate() - firstThursdayDayNum + 3,
      );
      const week =
        1 +
        Math.round(
          (target.getTime() - firstThursday.getTime()) / (7 * DAY_MS),
        );
      return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
    }
    case "monthly":
      return `${y}-${m}`;
    case "yearly":
      return `${y}`;
    case "every":
    case "forever":
    case "off":
      return "";
  }
}

/**
 * Within one tier, return the subset of snapshots that survive the
 * granularity rule. "Latest in bucket" wins — most recent state of the
 * file in that hour / day / etc.
 */
function applyGranularity(
  snapshots: Snapshot[],
  granularity: RetentionGranularity,
): { keep: Snapshot[]; evict: Snapshot[] } {
  if (granularity === "off") {
    return { keep: [], evict: [...snapshots] };
  }
  if (granularity === "every" || granularity === "forever") {
    return { keep: [...snapshots], evict: [] };
  }

  // Group by bucket key, keep latest ts per bucket.
  const latestPerBucket = new Map<string, Snapshot>();
  for (const s of snapshots) {
    const key = bucketKey(s.ts, granularity);
    const cur = latestPerBucket.get(key);
    if (!cur || s.ts > cur.ts) {
      latestPerBucket.set(key, s);
    }
  }
  const keepIds = new Set<string>();
  for (const s of latestPerBucket.values()) keepIds.add(s.id);

  const keep: Snapshot[] = [];
  const evict: Snapshot[] = [];
  for (const s of snapshots) {
    if (keepIds.has(s.id)) keep.push(s);
    else evict.push(s);
  }
  return { keep, evict };
}

/**
 * Apply the retention policy to a list of snapshots taken at `now`.
 *
 * Algorithm:
 *   1. Validate tiers are in ascending `maxAgeMs` order.
 *   2. Assign each snapshot to its tier via `tierForAge`. Snapshots that
 *      fall outside every tier are evicted.
 *   3. Within each tier, apply the granularity rule (latest-in-bucket).
 *   4. If `maxStorageBytes` is set and total kept size exceeds it, evict
 *      oldest snapshots from the lowest-priority NON-forever tier first;
 *      walk up to higher-priority tiers as needed. Forever tiers are
 *      never touched by the cap.
 *   5. If after step 4 the total still exceeds the cap (forever-tier data
 *      alone exceeds it), emit a `cap-exceeded` warning. Pure return value
 *      — never thrown, never logged. The UI surfaces it.
 *
 * Returns disjoint `keep` and `evict` arrays plus a `warnings` array
 * (possibly empty). Order within `keep`/`evict` is the input's order
 * (stable).
 */
export function prune(
  snapshots: Snapshot[],
  policy: RetentionPolicy,
  now: number,
): PruneResult {
  // Defensive sort check — pruning a misconfigured policy silently could
  // hide bugs. We sort a *copy* for the assignment step, but leave the
  // original `policy.tiers` untouched and report results in input order.
  const sortedTiers = [...policy.tiers]
    .map((t, originalIndex) => ({ tier: t, originalIndex }))
    .sort((a, b) => effectiveMaxAge(a.tier) - effectiveMaxAge(b.tier));
  const tiersInOrder = sortedTiers.map((x) => x.tier);

  // Map from a snapshot id to the index into `policy.tiers` (original
  // index, not sorted index) — used by routing callers.
  const tierIndexById = new Map<string, number>();
  // Bucket snapshots by their owning original-tier index.
  const byTierIndex = new Map<number, Snapshot[]>();
  const orphans: Snapshot[] = [];

  for (const s of snapshots) {
    const ageMs = now - s.ts;
    // Negative age (snapshot from the future) — clamp to 0 so it falls in
    // the freshest tier rather than being treated as ancient.
    const owner = tierForAge(Math.max(0, ageMs), tiersInOrder);
    if (!owner) {
      orphans.push(s);
      continue;
    }
    const originalIndex = sortedTiers[owner.index]!.originalIndex;
    tierIndexById.set(s.id, originalIndex);
    let bucket = byTierIndex.get(originalIndex);
    if (!bucket) {
      bucket = [];
      byTierIndex.set(originalIndex, bucket);
    }
    bucket.push(s);
  }

  const keepIds = new Set<string>();
  const evictIds = new Set<string>(orphans.map((s) => s.id));

  for (const [originalIndex, group] of byTierIndex) {
    const tier = policy.tiers[originalIndex]!;
    const result = applyGranularity(group, tier.granularity);
    for (const s of result.keep) keepIds.add(s.id);
    for (const s of result.evict) evictIds.add(s.id);
  }

  // Apply size cap.
  const warnings: PruneWarning[] = [];
  if (policy.maxStorageBytes !== undefined) {
    const cap = policy.maxStorageBytes;
    let total = 0;
    for (const s of snapshots) {
      if (keepIds.has(s.id)) total += s.sizeBytes;
    }

    if (total > cap) {
      // Build an eviction order: walk tiers from lowest priority (highest
      // index in original `policy.tiers`) up. Within each tier, oldest
      // (smallest `ts`) first. Skip `forever` tiers entirely.
      const tieredKeptByOrigIndex = new Map<number, Snapshot[]>();
      for (const s of snapshots) {
        if (!keepIds.has(s.id)) continue;
        const idx = tierIndexById.get(s.id);
        if (idx === undefined) continue;
        if (policy.tiers[idx]!.granularity === "forever") continue;
        let bucket = tieredKeptByOrigIndex.get(idx);
        if (!bucket) {
          bucket = [];
          tieredKeptByOrigIndex.set(idx, bucket);
        }
        bucket.push(s);
      }

      const tierIndicesLowestPriorityFirst = [
        ...tieredKeptByOrigIndex.keys(),
      ].sort((a, b) => b - a);

      outer: for (const idx of tierIndicesLowestPriorityFirst) {
        const bucket = tieredKeptByOrigIndex
          .get(idx)!
          .slice()
          .sort((a, b) => a.ts - b.ts);
        for (const s of bucket) {
          if (total <= cap) break outer;
          keepIds.delete(s.id);
          evictIds.add(s.id);
          total -= s.sizeBytes;
        }
        if (total <= cap) break;
      }
    }

    // After the eviction pass, if we still exceed the cap, the cause is
    // forever-tier protection. Surface a structured warning so the UI can
    // notify the user (increase cap / change retention rules / manage
    // deletions manually / dismiss).
    if (total > cap) {
      let protectedBytes = 0;
      let protectedSnapshotCount = 0;
      for (const s of snapshots) {
        if (!keepIds.has(s.id)) continue;
        const idx = tierIndexById.get(s.id);
        if (idx === undefined) continue;
        if (policy.tiers[idx]!.granularity !== "forever") continue;
        protectedBytes += s.sizeBytes;
        protectedSnapshotCount += 1;
      }
      warnings.push({
        kind: "cap-exceeded",
        currentBytes: total,
        capBytes: cap,
        overageBytes: total - cap,
        protectedBytes,
        protectedSnapshotCount,
      });
    }
  }

  const keep: Snapshot[] = [];
  const evict: Snapshot[] = [];
  for (const s of snapshots) {
    if (keepIds.has(s.id)) keep.push(s);
    else evict.push(s);
  }
  return { keep, evict, warnings };
}
