// Pure helpers for the Settings → Recovery retention-tier editor.
//
// Lives in @pennivo/core so the SettingsPanel renderer can stay a thin shell:
// the conversion between the persisted `RetentionTier[]` shape and the
// "rows + max-age form" the editor renders is a pure transformation.

import type {
  RetentionGranularity,
  RetentionPolicy,
  RetentionTier,
  TierDestinationConfig,
} from "./types";

/** Time units the inline "Add tier" form lets the user pick. */
export type TierAgeUnit = "hours" | "days" | "weeks" | "months" | "years";

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
// Calendar-month and calendar-year are not constants, but the retention
// editor is a coarse-grained UI — these bucket sizes are the ones the
// existing engine uses (see retention.ts: `tierForAge` uses ms math too).
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;

/**
 * Convert a (count, unit) pair from the inline form into a millisecond
 * upper-bound suitable for `RetentionTier.maxAgeMs`. Negative or non-finite
 * counts clamp to a 1-unit minimum.
 */
export function tierAgeToMs(count: number, unit: TierAgeUnit): number {
  const safe = Number.isFinite(count) && count > 0 ? count : 1;
  switch (unit) {
    case "hours":
      return Math.round(safe * MS_PER_HOUR);
    case "days":
      return Math.round(safe * MS_PER_DAY);
    case "weeks":
      return Math.round(safe * MS_PER_WEEK);
    case "months":
      return Math.round(safe * MS_PER_MONTH);
    case "years":
      return Math.round(safe * MS_PER_YEAR);
  }
}

/**
 * Inverse of `tierAgeToMs` for default display in the "Add tier" form when
 * editing an existing tier in v1.1; not currently used by the v1 editor but
 * kept here so the round-trip is symmetric and tested.
 */
export function msToTierAge(maxAgeMs: number): {
  count: number;
  unit: TierAgeUnit;
} {
  if (maxAgeMs >= MS_PER_YEAR && maxAgeMs % MS_PER_YEAR === 0)
    return { count: maxAgeMs / MS_PER_YEAR, unit: "years" };
  if (maxAgeMs >= MS_PER_MONTH && maxAgeMs % MS_PER_MONTH === 0)
    return { count: maxAgeMs / MS_PER_MONTH, unit: "months" };
  if (maxAgeMs >= MS_PER_WEEK && maxAgeMs % MS_PER_WEEK === 0)
    return { count: maxAgeMs / MS_PER_WEEK, unit: "weeks" };
  if (maxAgeMs >= MS_PER_DAY && maxAgeMs % MS_PER_DAY === 0)
    return { count: maxAgeMs / MS_PER_DAY, unit: "days" };
  return {
    count: Math.max(1, Math.round(maxAgeMs / MS_PER_HOUR)),
    unit: "hours",
  };
}

/**
 * Format a tier's age range as a human-readable pill. The "lower bound" is
 * the previous tier's `maxAgeMs` (or 0 for the first tier).
 *
 * Examples:
 *   `< 1 hour`
 *   `1h – 24h`
 *   `24h – 30 days`
 *   `30d – 1 year`
 *   `> 1 year`     (last tier, unbounded upper)
 */
export function formatTierAgeRange(
  tier: RetentionTier,
  prevMaxAgeMs: number,
  isLast: boolean,
): string {
  const upper = humanizeMs(tier.maxAgeMs);
  if (prevMaxAgeMs === 0) {
    return `< ${upper}`;
  }
  const lower = humanizeMs(prevMaxAgeMs);
  if (isLast) {
    // Last tier shows as `> <prev>` per the design spec.
    return `> ${lower}`;
  }
  return `${lower} – ${upper}`;
}

function humanizeMs(ms: number): string {
  if (ms >= MS_PER_YEAR) {
    const years = Math.round(ms / MS_PER_YEAR);
    return years === 1 ? "1 year" : `${years} years`;
  }
  if (ms >= MS_PER_MONTH) {
    const months = Math.round(ms / MS_PER_MONTH);
    return months === 1 ? "1 month" : `${months} months`;
  }
  if (ms >= MS_PER_WEEK) {
    const weeks = Math.round(ms / MS_PER_WEEK);
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  if (ms >= MS_PER_DAY) {
    const days = Math.round(ms / MS_PER_DAY);
    return days === 1 ? "1 day" : `${days} days`;
  }
  if (ms >= MS_PER_HOUR) {
    const hours = Math.round(ms / MS_PER_HOUR);
    return hours === 1 ? "1 hour" : `${hours}h`;
  }
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

/**
 * Insert a new tier in age order; if a tier with the exact same `maxAgeMs`
 * already exists, the new one's granularity wins. Returns a new array; the
 * input policy is not mutated.
 *
 * The accompanying `tierDestinations` is realigned: the new tier inherits
 * `['local']` (the safe default) at its inserted index; existing tiers'
 * destinations follow them by tierIndex.
 */
export function insertTier(
  policy: RetentionPolicy,
  destinations: TierDestinationConfig[],
  newTier: RetentionTier,
): { policy: RetentionPolicy; destinations: TierDestinationConfig[] } {
  const existingTiers = [...policy.tiers];
  const existingDestByMaxAge = new Map<number, TierDestinationConfig>();
  for (let i = 0; i < existingTiers.length; i++) {
    existingDestByMaxAge.set(
      existingTiers[i].maxAgeMs,
      destinations.find((d) => d.tierIndex === i) ?? {
        tierIndex: i,
        destinations: ["local"],
      },
    );
  }

  // De-dupe + insert.
  const filtered = existingTiers.filter((t) => t.maxAgeMs !== newTier.maxAgeMs);
  const filteredDest = filtered.map(
    (t) => existingDestByMaxAge.get(t.maxAgeMs)!,
  );
  filtered.push(newTier);
  filteredDest.push({
    tierIndex: filtered.length - 1,
    destinations: ["local"],
  });

  // Sort by maxAgeMs ascending; rebuild destinations to match new indices.
  const indices = filtered
    .map((_, i) => i)
    .sort((a, b) => filtered[a].maxAgeMs - filtered[b].maxAgeMs);
  const sortedTiers = indices.map((i) => filtered[i]);
  const sortedDest: TierDestinationConfig[] = indices.map((i, newIdx) => ({
    tierIndex: newIdx,
    destinations: [...filteredDest[i].destinations],
  }));

  return {
    policy: { ...policy, tiers: sortedTiers },
    destinations: sortedDest,
  };
}

/**
 * Remove the tier at `tierIndex`. Realigns destinations so their `tierIndex`
 * fields match the new order. Returns the input verbatim if `tierIndex` is
 * out of range.
 */
export function removeTier(
  policy: RetentionPolicy,
  destinations: TierDestinationConfig[],
  tierIndex: number,
): { policy: RetentionPolicy; destinations: TierDestinationConfig[] } {
  if (tierIndex < 0 || tierIndex >= policy.tiers.length) {
    return { policy, destinations };
  }
  const tiers = policy.tiers.filter((_, i) => i !== tierIndex);
  const dest: TierDestinationConfig[] = tiers.map((_, i) => {
    const oldIdx = i < tierIndex ? i : i + 1;
    const existing = destinations.find((d) => d.tierIndex === oldIdx) ?? {
      tierIndex: oldIdx,
      destinations: ["local"],
    };
    return { tierIndex: i, destinations: [...existing.destinations] };
  });
  return { policy: { ...policy, tiers }, destinations: dest };
}

/**
 * Replace the granularity of the tier at `tierIndex`. Returns the input
 * verbatim if `tierIndex` is out of range. `destinations` is unchanged.
 */
export function setTierGranularity(
  policy: RetentionPolicy,
  tierIndex: number,
  granularity: RetentionGranularity,
): RetentionPolicy {
  if (tierIndex < 0 || tierIndex >= policy.tiers.length) return policy;
  const tiers = policy.tiers.map((t, i) =>
    i === tierIndex ? { ...t, granularity } : t,
  );
  return { ...policy, tiers };
}
