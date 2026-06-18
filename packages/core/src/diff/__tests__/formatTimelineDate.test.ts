import { describe, it, expect } from "vitest";
import {
  formatDayGroupHeader,
  formatRowTime,
  groupByLocalDay,
} from "../formatTimelineDate";

describe("formatDayGroupHeader", () => {
  // Pin "now" to Thu May 7, 2026 14:30 local time. (Real-calendar weekday.)
  const now = new Date(2026, 4, 7, 14, 30, 0);

  it("formats today with `Today · Thu May 7, 2026`", () => {
    const date = new Date(2026, 4, 7, 9, 0, 0);
    expect(formatDayGroupHeader(date, now)).toBe("Today · Thu May 7, 2026");
  });

  it("formats yesterday with `Yesterday · Wed May 6, 2026`", () => {
    const date = new Date(2026, 4, 6, 23, 0, 0);
    expect(formatDayGroupHeader(date, now)).toBe("Yesterday · Wed May 6, 2026");
  });

  it("formats same-week earlier days as `Mon May 4`", () => {
    const date = new Date(2026, 4, 4, 12, 0, 0);
    expect(formatDayGroupHeader(date, now)).toBe("Mon May 4");
  });

  it("formats same-year older days as `Tue Apr 28` (weekday + month + day, no year)", () => {
    const date = new Date(2026, 3, 28, 12, 0, 0);
    expect(formatDayGroupHeader(date, now)).toBe("Tue Apr 28");
  });

  it("formats other-year dates with the year, no weekday", () => {
    const date = new Date(2025, 2, 12, 12, 0, 0);
    expect(formatDayGroupHeader(date, now)).toBe("Mar 12, 2025");
  });

  it("year boundary: yesterday across a New Year", () => {
    const newYearMidnight = new Date(2026, 0, 1, 0, 5, 0);
    const yesterday = new Date(2025, 11, 31, 23, 0, 0);
    const result = formatDayGroupHeader(yesterday, newYearMidnight);
    expect(result.startsWith("Yesterday · ")).toBe(true);
    expect(result).toContain("Dec 31, 2025");
  });
});

describe("formatRowTime", () => {
  it("zero-pads hours and minutes", () => {
    expect(formatRowTime(new Date(2026, 4, 7, 9, 5, 0))).toBe("09:05");
    expect(formatRowTime(new Date(2026, 4, 7, 14, 30, 0))).toBe("14:30");
    expect(formatRowTime(new Date(2026, 4, 7, 0, 0, 0))).toBe("00:00");
  });
});

describe("groupByLocalDay", () => {
  it("buckets by local day, newest day first within each bucket", () => {
    const items = [
      { ts: new Date(2026, 4, 7, 9, 0).getTime() },
      { ts: new Date(2026, 4, 7, 14, 0).getTime() },
      { ts: new Date(2026, 4, 6, 12, 0).getTime() },
    ];
    const groups = groupByLocalDay(items);
    expect(groups.length).toBe(2);
    expect(groups[0].items.length).toBe(2);
    // Newest item first within the bucket.
    expect(groups[0].items[0].ts).toBe(new Date(2026, 4, 7, 14, 0).getTime());
    expect(groups[1].items.length).toBe(1);
  });

  it("does not mutate input", () => {
    const items = [
      { ts: new Date(2026, 4, 6, 0).getTime() },
      { ts: new Date(2026, 4, 7, 0).getTime() },
    ];
    const original = [...items];
    groupByLocalDay(items);
    expect(items).toEqual(original);
  });

  it("returns empty for empty input", () => {
    expect(groupByLocalDay([])).toEqual([]);
  });
});
