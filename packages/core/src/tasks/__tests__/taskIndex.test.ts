import { describe, it, expect } from "vitest";
import { extractTaskItems } from "../extractTasks";
import { buildTaskIndex } from "../taskIndex";
import type { TaskItem } from "../types";

describe("buildTaskIndex — all", () => {
  it("passes every item through unchanged", () => {
    const items = extractTaskItems("- [ ] a\n- [x] b\n", "a.md");
    const index = buildTaskIndex(items);
    expect(index.all).toBe(items);
    expect(index.all).toHaveLength(2);
  });

  it("handles an empty item list", () => {
    const index = buildTaskIndex([]);
    expect(index.all).toEqual([]);
    expect(index.byLabel.size).toBe(0);
    expect(index.dated).toEqual([]);
  });
});

describe("buildTaskIndex — byLabel", () => {
  it("groups items under every label they carry, preserving item order", () => {
    const items = extractTaskItems(
      [
        "- [ ] first #work #urgent",
        "- [ ] second #work",
        "- [ ] third #personal",
      ].join("\n"),
      "a.md",
    );
    const index = buildTaskIndex(items);
    expect(index.byLabel.get("work")!.map((i) => i.rawText)).toEqual([
      "first #work #urgent",
      "second #work",
    ]);
    expect(index.byLabel.get("urgent")!.map((i) => i.rawText)).toEqual([
      "first #work #urgent",
    ]);
    expect(index.byLabel.get("personal")!.map((i) => i.rawText)).toEqual([
      "third #personal",
    ]);
    expect(index.byLabel.has("missing")).toBe(false);
  });

  it("returns an empty map when no item has a label", () => {
    const items = extractTaskItems("- [ ] plain task\n", "a.md");
    const index = buildTaskIndex(items);
    expect(index.byLabel.size).toBe(0);
  });
});

describe("buildTaskIndex — dated", () => {
  it("includes only items with a non-null due date", () => {
    const items = extractTaskItems(
      [
        "- [ ] no date here",
        "- [ ] dated [due:: 2026-10-15]",
        "- [ ] invalid [due:: 2026-13-45]",
      ].join("\n"),
      "a.md",
    );
    const index = buildTaskIndex(items);
    expect(index.dated).toHaveLength(1);
    expect(index.dated[0].due).toBe("2026-10-15");
  });

  it("sorts by due date ascending", () => {
    const items = extractTaskItems(
      [
        "- [ ] c [due:: 2026-12-01]",
        "- [ ] a [due:: 2026-10-01]",
        "- [ ] b [due:: 2026-11-01]",
      ].join("\n"),
      "a.md",
    );
    const index = buildTaskIndex(items);
    expect(index.dated.map((i) => i.due)).toEqual([
      "2026-10-01",
      "2026-11-01",
      "2026-12-01",
    ]);
  });

  it("breaks a due-date tie by path ascending, then line ascending", () => {
    const itemsB: TaskItem[] = extractTaskItems(
      "- [ ] second [due:: 2026-10-15]\n- [ ] first-on-same-file [due:: 2026-10-15]\n",
      "b.md",
    );
    const itemsA: TaskItem[] = extractTaskItems(
      "- [ ] only [due:: 2026-10-15]\n",
      "a.md",
    );
    const index = buildTaskIndex([...itemsB, ...itemsA]);
    expect(index.dated.map((i) => `${i.path}:${i.line}`)).toEqual([
      "a.md:0",
      "b.md:0",
      "b.md:1",
    ]);
  });
});
