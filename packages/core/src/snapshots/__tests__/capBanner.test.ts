import { describe, it, expect } from "vitest";
import { shouldShowCapBanner } from "../capBanner";
import type { PruneWarning } from "../types";

function warning(overage: number): PruneWarning {
  return {
    kind: "cap-exceeded",
    currentBytes: 280 * 1024 * 1024,
    capBytes: 200 * 1024 * 1024,
    overageBytes: overage,
    protectedBytes: overage,
    protectedSnapshotCount: 1,
  };
}

describe("shouldShowCapBanner", () => {
  it("hides banner when no warning is active", () => {
    expect(
      shouldShowCapBanner(null, {
        capBannerDismissedAt: null,
        lastCapWarningOverageBytes: null,
      }),
    ).toBe(false);
    expect(
      shouldShowCapBanner(null, {
        capBannerDismissedAt: 123,
        lastCapWarningOverageBytes: 5_000,
      }),
    ).toBe(false);
  });

  it("shows banner with warning + no prior dismissal", () => {
    expect(
      shouldShowCapBanner(warning(80 * 1024 * 1024), {
        capBannerDismissedAt: null,
        lastCapWarningOverageBytes: null,
      }),
    ).toBe(true);
  });

  it("hides banner when dismissed at the same overage", () => {
    expect(
      shouldShowCapBanner(warning(80 * 1024 * 1024), {
        capBannerDismissedAt: 1234,
        lastCapWarningOverageBytes: 80 * 1024 * 1024,
      }),
    ).toBe(false);
  });

  it("re-shows banner when overage grows past the dismissed value", () => {
    expect(
      shouldShowCapBanner(warning(120 * 1024 * 1024), {
        capBannerDismissedAt: 1234,
        lastCapWarningOverageBytes: 80 * 1024 * 1024,
      }),
    ).toBe(true);
  });

  it("treats a dismissed-at-without-overage as 'show' (defensive)", () => {
    expect(
      shouldShowCapBanner(warning(50_000_000), {
        capBannerDismissedAt: 1234,
        lastCapWarningOverageBytes: null,
      }),
    ).toBe(true);
  });
});
