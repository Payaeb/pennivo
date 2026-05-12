// Trash retention math.
//
// `trashRetentionDays` from RecoverySettings is a plain number with a single
// sentinel: `-1` means Forever (entry never auto-expires). We accept any
// non-positive value as Forever for safety — a corrupted settings file with
// `0` shouldn't cause the sweeper to delete everything immediately.

import type { TrashEntry } from "./types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the wall-clock ms at which an entry becomes eligible for permanent
 * deletion. Returns `null` for Forever retention.
 *
 * - `retentionDays > 0` → `deletedAtMs + retentionDays * 86_400_000`
 * - `retentionDays <= 0` (e.g. `-1`) → `null`
 *
 * `Number.POSITIVE_INFINITY` is also treated as Forever — defensive against
 * any future code path that might compute it.
 */
export function computeExpiresAtMs(
  deletedAtMs: number,
  retentionDays: number,
): number | null {
  if (!Number.isFinite(retentionDays)) return null;
  if (retentionDays <= 0) return null;
  return deletedAtMs + retentionDays * MS_PER_DAY;
}

/**
 * Filter `entries` down to those whose `expiresAtMs` is non-null and on or
 * before `now`. Forever entries (`expiresAtMs === null`) are never returned.
 */
export function findExpired(
  entries: readonly TrashEntry[],
  now: number,
): TrashEntry[] {
  const out: TrashEntry[] = [];
  for (const e of entries) {
    if (e.expiresAtMs === null) continue;
    if (e.expiresAtMs <= now) out.push(e);
  }
  return out;
}
