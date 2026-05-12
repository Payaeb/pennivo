import { describe, it, expect } from "vitest";
import {
  defaultRecoverySettings,
  migrateRecoverySettings,
  applyArchiveDefaults,
} from "../recoverySettings";

describe("defaultRecoverySettings", () => {
  it("returns enabled=true with line diff and 30-day trash retention", () => {
    const s = defaultRecoverySettings();
    expect(s.enabled).toBe(true);
    expect(s.diffStyle).toBe("line");
    expect(s.trashRetentionDays).toBe(30);
  });

  it("defaults every tier to local-only", () => {
    const s = defaultRecoverySettings();
    expect(s.tierDestinations.length).toBe(s.retentionPolicy.tiers.length);
    for (const td of s.tierDestinations) {
      expect(td.destinations).toEqual(["local"]);
    }
  });

  it("defaults max storage to 200 MB", () => {
    expect(defaultRecoverySettings().maxStorageBytes).toBe(200 * 1024 * 1024);
  });

  it("has no archive folder by default", () => {
    expect(defaultRecoverySettings().archiveFolder).toBeUndefined();
  });

  it("starts with no cap-banner dismissal recorded", () => {
    const s = defaultRecoverySettings();
    expect(s.capBannerDismissedAt).toBeNull();
    expect(s.lastCapWarningOverageBytes).toBeNull();
  });
});

describe("migrateRecoverySettings — cap-banner persistence", () => {
  it("preserves persisted dismissal timestamp + overage", () => {
    const out = migrateRecoverySettings({
      capBannerDismissedAt: 1700_000_000_000,
      lastCapWarningOverageBytes: 80 * 1024 * 1024,
    });
    expect(out.capBannerDismissedAt).toBe(1700_000_000_000);
    expect(out.lastCapWarningOverageBytes).toBe(80 * 1024 * 1024);
  });

  it("defaults missing cap-banner keys to null", () => {
    const out = migrateRecoverySettings({});
    expect(out.capBannerDismissedAt).toBeNull();
    expect(out.lastCapWarningOverageBytes).toBeNull();
  });

  it("rejects non-numeric cap-banner values", () => {
    const out = migrateRecoverySettings({
      capBannerDismissedAt: "soon",
      lastCapWarningOverageBytes: NaN,
    });
    expect(out.capBannerDismissedAt).toBeNull();
    expect(out.lastCapWarningOverageBytes).toBeNull();
  });
});

describe("migrateRecoverySettings", () => {
  it("returns full defaults for null/undefined/garbage input", () => {
    expect(migrateRecoverySettings(undefined)).toEqual(
      defaultRecoverySettings(),
    );
    expect(migrateRecoverySettings(null)).toEqual(defaultRecoverySettings());
    expect(migrateRecoverySettings("nope")).toEqual(defaultRecoverySettings());
  });

  it("preserves user-set fields and fills missing ones with defaults", () => {
    const partial = { enabled: false, diffStyle: "word" };
    const out = migrateRecoverySettings(partial);
    expect(out.enabled).toBe(false);
    expect(out.diffStyle).toBe("word");
    expect(out.trashRetentionDays).toBe(30);
  });

  it("accepts maxStorageBytes=null as 'unlimited'", () => {
    const out = migrateRecoverySettings({ maxStorageBytes: null });
    expect(out.maxStorageBytes).toBeNull();
  });

  it("aligns tierDestinations to the policy tier count", () => {
    // Empty tierDestinations on input — should be padded to match policy tiers
    const out = migrateRecoverySettings({ tierDestinations: [] });
    expect(out.tierDestinations.length).toBe(out.retentionPolicy.tiers.length);
    for (const td of out.tierDestinations) {
      expect(td.destinations).toEqual(["local"]);
    }
  });
});

describe("applyArchiveDefaults", () => {
  it("upgrades daily-and-older default tiers to ['local','archive']", () => {
    const s = defaultRecoverySettings();
    const out = applyArchiveDefaults(s);
    // Default policy: tiers = [every, hourly, daily]. Only the daily tier
    // gets upgraded.
    const dailyIdx = s.retentionPolicy.tiers.findIndex(
      (t) => t.granularity === "daily",
    );
    expect(out[dailyIdx]?.destinations).toEqual(["local", "archive"]);
    const hourlyIdx = s.retentionPolicy.tiers.findIndex(
      (t) => t.granularity === "hourly",
    );
    expect(out[hourlyIdx]?.destinations).toEqual(["local"]);
  });

  it("never overrides a user-customized tier", () => {
    const s = defaultRecoverySettings();
    const dailyIdx = s.retentionPolicy.tiers.findIndex(
      (t) => t.granularity === "daily",
    );
    // User set this tier to archive-only
    s.tierDestinations[dailyIdx] = {
      tierIndex: dailyIdx,
      destinations: ["archive"],
    };
    const out = applyArchiveDefaults(s);
    expect(out[dailyIdx]?.destinations).toEqual(["archive"]);
  });
});
