import { describe, it, expect } from "vitest";
import { addIsoDays, groupTasksByAgenda } from "../agenda";
import { AGENDA_BUCKET_ORDER } from "../types";
import type { TaskItem } from "../types";

/** Build a minimal TaskItem fixture; only `due`/`checked` vary per test. */
function task(
  due: string | null,
  checked = false,
  overrides: Partial<TaskItem> = {},
): TaskItem {
  return {
    path: "a.md",
    line: 0,
    charOffset: 0,
    checked,
    rawText: "task",
    displayText: "task",
    labels: [],
    due,
    done: null,
    indent: 0,
    ...overrides,
  };
}

describe("addIsoDays", () => {
  it("adds days within the same month", () => {
    expect(addIsoDays("2026-10-07", 1)).toBe("2026-10-08");
    expect(addIsoDays("2026-10-07", 6)).toBe("2026-10-13");
  });

  it("rolls over a month boundary", () => {
    expect(addIsoDays("2026-10-30", 2)).toBe("2026-11-01");
  });

  it("rolls over a year boundary", () => {
    expect(addIsoDays("2026-12-30", 1)).toBe("2026-12-31");
    expect(addIsoDays("2026-12-30", 2)).toBe("2027-01-01");
    expect(addIsoDays("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("supports negative days", () => {
    expect(addIsoDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("groupTasksByAgenda — basic boundaries", () => {
  const today = "2026-10-07";

  it("buckets a date before today as overdue", () => {
    const buckets = groupTasksByAgenda([task("2026-10-06")], today);
    expect(buckets.overdue).toHaveLength(1);
  });

  it("buckets a date exactly today as today", () => {
    const buckets = groupTasksByAgenda([task("2026-10-07")], today);
    expect(buckets.today).toHaveLength(1);
    expect(buckets.overdue).toHaveLength(0);
  });

  it("buckets a date exactly today+1 as tomorrow", () => {
    const buckets = groupTasksByAgenda([task("2026-10-08")], today);
    expect(buckets.tomorrow).toHaveLength(1);
  });

  it("buckets today+2 through today+6 as thisWeek", () => {
    for (const d of [
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
    ]) {
      const buckets = groupTasksByAgenda([task(d)], today);
      expect(buckets.thisWeek, `due=${d}`).toHaveLength(1);
    }
  });

  it("buckets today+7 as later (the first later day)", () => {
    const buckets = groupTasksByAgenda([task("2026-10-14")], today);
    expect(buckets.later).toHaveLength(1);
    expect(buckets.thisWeek).toHaveLength(0);
  });

  it("buckets a far-future date as later", () => {
    const buckets = groupTasksByAgenda([task("2027-01-01")], today);
    expect(buckets.later).toHaveLength(1);
  });

  it("buckets a null due date as noDate when unchecked", () => {
    const buckets = groupTasksByAgenda([task(null)], today);
    expect(buckets.noDate).toHaveLength(1);
  });
});

describe("groupTasksByAgenda — checked items", () => {
  const today = "2026-10-07";

  it("never puts a checked item in any bucket, regardless of due date", () => {
    const buckets = groupTasksByAgenda(
      [
        task("2026-10-06", true), // would be overdue
        task("2026-10-07", true), // would be today
        task(null, true), // would be noDate
      ],
      today,
    );
    expect(buckets.overdue).toHaveLength(0);
    expect(buckets.today).toHaveLength(0);
    expect(buckets.noDate).toHaveLength(0);
    expect(buckets.completed).toBe(3);
  });

  it("counts completed independently of unchecked bucket counts", () => {
    const buckets = groupTasksByAgenda(
      [task("2026-10-06"), task("2026-10-06", true)],
      today,
    );
    expect(buckets.overdue).toHaveLength(1);
    expect(buckets.completed).toBe(1);
  });
});

describe("groupTasksByAgenda — month/year rollover", () => {
  const today = "2026-12-30";

  it("puts today+1 (2026-12-31) in tomorrow", () => {
    const buckets = groupTasksByAgenda([task("2026-12-31")], today);
    expect(buckets.tomorrow).toHaveLength(1);
  });

  it("puts thisWeek dates crossing into January in thisWeek", () => {
    // today+2 .. today+6 = 2027-01-01 .. 2027-01-05
    for (const d of [
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
      "2027-01-04",
      "2027-01-05",
    ]) {
      const buckets = groupTasksByAgenda([task(d)], today);
      expect(buckets.thisWeek, `due=${d}`).toHaveLength(1);
    }
  });

  it("puts today+7 (2027-01-06) in later", () => {
    const buckets = groupTasksByAgenda([task("2027-01-06")], today);
    expect(buckets.later).toHaveLength(1);
  });
});

describe("groupTasksByAgenda — empty input", () => {
  it("returns every bucket empty and completed 0 for no items", () => {
    const buckets = groupTasksByAgenda([], "2026-10-07");
    expect(buckets).toEqual({
      overdue: [],
      today: [],
      tomorrow: [],
      thisWeek: [],
      later: [],
      noDate: [],
      completed: 0,
    });
  });
});

describe("AGENDA_BUCKET_ORDER", () => {
  it("lists every bucket key exactly once, in display order", () => {
    expect(AGENDA_BUCKET_ORDER).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "thisWeek",
      "later",
      "noDate",
    ]);
  });
});
