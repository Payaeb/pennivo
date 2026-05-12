// Pure date formatter for the History timeline / Trash list day-group
// headers. Lives in @pennivo/core so test fixtures can pin a `now`
// timestamp and exercise the rules without dragging Intl quirks across
// platforms.
//
// Rules (locked 2026-05-07):
// - Today        -> `Today · Wed May 7, 2026`
// - Yesterday    -> `Yesterday · Tue May 6, 2026`
// - Same year    -> `Mon May 5, 2026`        (no Today/Yesterday prefix; year omitted? See below.)
// - Older year   -> `Mar 12, 2025`
//
// Per the locked design, the year is "omitted if same year as now and shown
// otherwise" *except* on Today/Yesterday rows where we keep the full date so
// it's never ambiguous in screenshots / docs.

const WEEKDAYS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

interface YMD {
  year: number;
  month: number; // 0-based
  day: number;
}

function ymd(d: Date): YMD {
  return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate() };
}

function sameDay(a: YMD, b: YMD): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Returns `true` when `a` is one calendar day before `b` in local time.
 * Implementation note: subtract 24h from `b`'s midnight and compare.
 */
function isYesterday(a: YMD, b: YMD): boolean {
  const bMidnight = new Date(b.year, b.month, b.day);
  bMidnight.setDate(bMidnight.getDate() - 1);
  const aDate = new Date(a.year, a.month, a.day);
  return sameDay(ymd(aDate), ymd(bMidnight));
}

/**
 * `Wed May 7, 2026`
 */
function fullWithWeekday(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * `Mon May 5, 2026` (same-year) or `Mar 12, 2025` (other year).
 * The locked rule omits the year when same-year, but keeps the weekday for
 * within-week days; we apply weekday for any same-year date so glanceable
 * scanning works on the recent end of the timeline.
 *
 * Same-year: `Mon May 5` (no year)
 * Other-year: `Mar 12, 2025` (no weekday, with year)
 */
function dayGroupForOlder(d: Date, today: Date): string {
  if (d.getFullYear() === today.getFullYear()) {
    return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Format a Date as a History timeline / Trash list day-group header.
 *
 * `now` defaults to `new Date()` but is injectable so tests can pin time.
 */
export function formatDayGroupHeader(date: Date, now: Date = new Date()): string {
  const dY = ymd(date);
  const nY = ymd(now);
  if (sameDay(dY, nY)) return `Today · ${fullWithWeekday(date)}`;
  if (isYesterday(dY, nY)) return `Yesterday · ${fullWithWeekday(date)}`;
  return dayGroupForOlder(date, now);
}

/**
 * `14:30` time-only (zero-padded HH:MM) for row timestamps within a day group.
 */
export function formatRowTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Bucket a list of timestamps into chronologically-grouped day buckets,
 * newest first. Used by the timeline + trash list renderers. Pure: input
 * isn't mutated.
 *
 * Returned bucket key is the local-date midnight ms — stable for `keyExtractor`
 * usage in the React renderer.
 */
export function groupByLocalDay<T extends { ts: number }>(
  items: T[],
): { dayKey: number; date: Date; items: T[] }[] {
  // Sort newest-first without mutating input.
  const sorted = [...items].sort((a, b) => b.ts - a.ts);
  const buckets = new Map<number, { date: Date; items: T[] }>();
  for (const item of sorted) {
    const d = new Date(item.ts);
    const dayKey = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    let bucket = buckets.get(dayKey);
    if (!bucket) {
      bucket = { date: new Date(dayKey), items: [] };
      buckets.set(dayKey, bucket);
    }
    bucket.items.push(item);
  }
  // Return entries newest-first.
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayKey, b]) => ({ dayKey, date: b.date, items: b.items }));
}
