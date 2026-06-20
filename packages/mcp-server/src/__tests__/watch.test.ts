import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, ALL_ENABLED, type Harness } from "./harness.js";
import { seedWorkspace, makeWorkspace, cleanup } from "./fixtures.js";

// A controllable fake FSWatcher so we can deterministically induce the recursive
// 'error' event Node emits on Linux/macOS (subdir removed, EPERM, inotify limit)
// without depending on platform-specific fs.watch behavior.
class FakeWatcher extends EventEmitter {
  closed = 0;
  close() {
    this.closed++;
  }
}
const fakeWatchers: FakeWatcher[] = [];
vi.mock("node:fs", async (importActual) => {
  const actual = await importActual<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn(() => {
      const w = new FakeWatcher();
      fakeWatchers.push(w);
      return w as unknown as FSWatcher;
    }),
  };
});

import {
  debounce,
  isRelevantChange,
  createWorkspaceWatcher,
} from "../watch/watcher.js";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid calls into one", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d.call();
    d.call();
    d.call();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel prevents a pending call", () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("isRelevantChange", () => {
  it("accepts markdown and directory events, rejects others", () => {
    expect(isRelevantChange("a.md")).toBe(true);
    expect(isRelevantChange("a.markdown")).toBe(true);
    expect(isRelevantChange("a.txt")).toBe(true);
    expect(isRelevantChange("folder")).toBe(true); // no extension = dir event
    expect(isRelevantChange("a.png")).toBe(false);
    expect(isRelevantChange(null)).toBe(false);
  });
});

describe("createWorkspaceWatcher error handling", () => {
  beforeEach(() => {
    fakeWatchers.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("attaches an 'error' listener to the FSWatcher", () => {
    const dispose = createWorkspaceWatcher("/some/root", () => {});
    expect(fakeWatchers).toHaveLength(1);
    expect(fakeWatchers[0].listenerCount("error")).toBe(1);
    dispose();
  });

  it("does not throw / crash when the underlying watcher emits 'error'", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onChange = vi.fn();
    const dispose = createWorkspaceWatcher("/some/root", onChange);
    const w = fakeWatchers[0];

    // Emitting 'error' with a listener attached must not rethrow / crash.
    expect(() => w.emit("error", new Error("inotify limit"))).not.toThrow();
    expect(w.closed).toBe(1); // the broken watcher was closed
    // The error was reported to STDERR, never stdout (the JSON-RPC channel).
    expect(errSpy).toHaveBeenCalled();

    // Dispose after an error is safe (watcher already nulled, not double-closed).
    expect(() => dispose()).not.toThrow();
    expect(w.closed).toBe(1);
  });

  it("dispose is idempotent and never throws", () => {
    const dispose = createWorkspaceWatcher("/some/root", () => {});
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
    // Real-dir smoke check that helpers still work under the partial mock.
    const root = makeWorkspace();
    cleanup(root);
  });
});

describe("resources/list_changed wiring", () => {
  let root: string;
  let h: Harness;
  let trigger: () => void;

  beforeEach(async () => {
    root = seedWorkspace();
    // Inject a manual change subscription so the test is deterministic
    // (independent of fs.watch timing).
    h = await connect(root, {
      config: ALL_ENABLED,
      subscribeToChanges: (onChange) => {
        trigger = onChange;
        return () => {};
      },
    });
  });

  afterEach(async () => {
    await h.close();
    cleanup(root);
  });

  it("notifies the client when the workspace changes", async () => {
    let notified = 0;
    h.client.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      async () => {
        notified++;
      },
    );

    trigger();
    // Give the notification a tick to propagate over the in-memory transport.
    await new Promise((r) => setTimeout(r, 20));
    expect(notified).toBeGreaterThanOrEqual(1);
  });
});
