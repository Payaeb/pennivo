import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ResourceListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { connect, ALL_ENABLED, type Harness } from "./harness.js";
import { seedWorkspace, cleanup } from "./fixtures.js";
import { debounce, isRelevantChange } from "../watch/watcher.js";

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
