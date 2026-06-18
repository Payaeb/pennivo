import { describe, it, expect } from "vitest";
import { dedupeArchiveQueue, type ArchiveQueueEntry } from "../archiveQueue";

function entry(overrides: Partial<ArchiveQueueEntry> = {}): ArchiveQueueEntry {
  return {
    absolutePath: "/work/foo.md",
    snapshotId: "2026-05-07T00-00-00-000Z",
    ts: 0,
    relPath: "abc/2026-05-07T00-00-00-000Z.md",
    metaRelPath: "abc/2026-05-07T00-00-00-000Z.json",
    content: "hello",
    meta: "{}",
    enqueuedAt: 100,
    ...overrides,
  };
}

describe("dedupeArchiveQueue", () => {
  it("collapses entries that share absolutePath + snapshotId", () => {
    const dup = entry({ enqueuedAt: 200 });
    const result = dedupeArchiveQueue([entry(), dup]);
    expect(result).toHaveLength(1);
    // Earliest enqueuedAt wins.
    expect(result[0]?.enqueuedAt).toBe(100);
  });

  it("keeps entries with different snapshotIds", () => {
    const a = entry({ snapshotId: "a" });
    const b = entry({ snapshotId: "b" });
    expect(dedupeArchiveQueue([a, b])).toHaveLength(2);
  });

  it("keeps entries for different absolutePaths", () => {
    const a = entry({ absolutePath: "/work/foo.md" });
    const b = entry({ absolutePath: "/work/bar.md" });
    expect(dedupeArchiveQueue([a, b])).toHaveLength(2);
  });

  it("returns an empty array for empty input", () => {
    expect(dedupeArchiveQueue([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [entry(), entry({ enqueuedAt: 50 })];
    const before = JSON.stringify(input);
    dedupeArchiveQueue(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
