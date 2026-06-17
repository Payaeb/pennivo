import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  InMemoryAuditSink,
  JsonlAuditSink,
  type AuditEvent,
} from "../audit/auditLog.js";
import { makeWorkspace, cleanup } from "./fixtures.js";

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return { ts: 1, agent: "a", tool: "read_file", outcome: "ok", ...overrides };
}

describe("InMemoryAuditSink", () => {
  it("returns events newest-first", () => {
    const sink = new InMemoryAuditSink();
    sink.record(event({ ts: 1 }));
    sink.record(event({ ts: 2 }));
    sink.record(event({ ts: 3 }));
    expect(sink.recent(10).map((e) => e.ts)).toEqual([3, 2, 1]);
  });

  it("caps the ring buffer and drops the oldest", () => {
    const sink = new InMemoryAuditSink(2);
    sink.record(event({ ts: 1 }));
    sink.record(event({ ts: 2 }));
    sink.record(event({ ts: 3 }));
    expect(sink.recent(10).map((e) => e.ts)).toEqual([3, 2]);
  });

  it("returns nothing for a non-positive limit", () => {
    const sink = new InMemoryAuditSink();
    sink.record(event());
    expect(sink.recent(0)).toEqual([]);
  });
});

describe("JsonlAuditSink", () => {
  let root: string;
  beforeEach(() => (root = makeWorkspace()));
  afterEach(() => cleanup(root));

  it("appends one JSON line per event and mirrors in memory", () => {
    const file = path.join(root, "audit.jsonl");
    const sink = new JsonlAuditSink(file);
    sink.record(event({ ts: 1, path: "a.md" }));
    sink.record(event({ ts: 2, path: "b.md", outcome: "denied" }));

    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((l) => JSON.parse(l) as AuditEvent);
    expect(parsed[0]).toMatchObject({ ts: 1, path: "a.md", outcome: "ok" });
    expect(parsed[1]).toMatchObject({ ts: 2, path: "b.md", outcome: "denied" });

    expect(sink.recent(10).map((e) => e.ts)).toEqual([2, 1]);
  });

  it("never throws when the file path is unwritable", () => {
    const sink = new JsonlAuditSink(
      path.join(root, "no", "such", "dir", "x.jsonl"),
    );
    expect(() => sink.record(event())).not.toThrow();
    // Still mirrored in memory even though the disk write failed.
    expect(sink.recent(1)).toHaveLength(1);
  });
});
