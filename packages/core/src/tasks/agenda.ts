// Pure agenda grouping over already-extracted TaskItems. No fs/IPC/DOM, no
// Date.now() — `todayIso` is injected by the caller so this stays
// deterministic and unit-testable. ISO `YYYY-MM-DD` strings compare
// lexicographically the same as chronologically (fixed-width, zero-padded),
// so bucket boundaries are plain string comparisons; only the boundary dates
// themselves need date arithmetic, done via `addIsoDays` below (UTC-based, so
// month/year rollover is correct with no external deps).

import type { AgendaBuckets, ListItemLocation } from "./types";

/**
 * Add `days` (may be negative) to an ISO `YYYY-MM-DD` date and return the
 * result in the same format. Uses UTC internally purely as a rollover-safe
 * calendar calculator — no timezone meaning is implied or read back.
 */
export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Group `items` into agenda buckets relative to `todayIso`. Checked items
 * never enter a bucket; they are counted in `completed` instead. See
 * AgendaBuckets for the exact boundary semantics. Never throws.
 *
 * Generic so callers can mix tasks with dated plain bullets; an item with no
 * `checked` field is treated as open. Undated items always land in `noDate`
 * (this function does not exclude them), so a caller feeding plain bullets
 * must pre-filter them to `due !== null`.
 */
export function groupTasksByAgenda<
  T extends ListItemLocation & { checked?: boolean },
>(items: T[], todayIso: string): AgendaBuckets<T> {
  const tomorrowIso = addIsoDays(todayIso, 1);
  const weekEndIso = addIsoDays(todayIso, 6);

  const buckets: AgendaBuckets<T> = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
    noDate: [],
    completed: 0,
  };

  for (const item of items) {
    if (item.checked) {
      buckets.completed += 1;
      continue;
    }
    if (item.due === null) {
      buckets.noDate.push(item);
      continue;
    }
    if (item.due < todayIso) {
      buckets.overdue.push(item);
    } else if (item.due === todayIso) {
      buckets.today.push(item);
    } else if (item.due === tomorrowIso) {
      buckets.tomorrow.push(item);
    } else if (item.due <= weekEndIso) {
      buckets.thisWeek.push(item);
    } else {
      buckets.later.push(item);
    }
  }

  return buckets;
}
