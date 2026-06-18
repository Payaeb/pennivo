// Pure shape + defaults + migration for the recovery section of app
// settings. Lives in @pennivo/core so desktop and future hosts agree on what
// the settings look like.
//
// See docs/file-recovery-and-versioning.md "Settings panel additions".

import { defaultRetentionPolicy } from "./retention";
import type { RetentionPolicy, TierDestinationConfig } from "./types";

export type DiffStyle = "line" | "word";

export interface RecoverySettings {
  /** Master toggle. When false, the writer skips snapshot capture entirely. */
  enabled: boolean;
  /** Tiered retention policy applied by `prune`. */
  retentionPolicy: RetentionPolicy;
  /**
   * Optional absolute path the user picked as the archive store. When unset
   * (`undefined`), every tier writes local-only regardless of
   * `tierDestinations`.
   */
  archiveFolder?: string;
  /**
   * Per-tier destination assignment. Length matches `retentionPolicy.tiers`.
   * Defaults to `['local']` for every tier; `applyArchiveDefaults` shifts
   * daily-and-older tiers to `['local', 'archive']` on first archive-folder
   * pick.
   */
  tierDestinations: TierDestinationConfig[];
  /**
   * Trash retention in days. `null` would mean "Forever" but we encode the
   * UI option as a number (365_000) for simpler downstream code; pure UI
   * never sees `Infinity`.
   */
  trashRetentionDays: number;
  /** Line vs word diff. `'word'` is wired but not implemented in v1. */
  diffStyle: DiffStyle;
  /** Global byte cap for the local store. `null` = unlimited. */
  maxStorageBytes: number | null;
  /** Optional override for the OS hostname display name. */
  deviceName?: string;
  /**
   * Persisted width (in CSS pixels) of the History modal's timeline column.
   * Default 340. Pane-resize updates write this through the settings store.
   */
  historyTimelineWidth: number;
  /**
   * Persisted "timeline column collapsed to a 32px rail" flag for the
   * History modal. Default false. Auto-collapse triggered by a sub-800px
   * modal width is *not* persisted — only user-driven collapses are.
   */
  historyTimelineCollapsed: boolean;
  /**
   * Persisted "preview column collapsed to a 32px rail" flag for the History
   * modal. Default false. At least one of timeline/preview must remain
   * expanded — the renderer no-ops a request that would collapse both.
   */
  historyPreviewCollapsed: boolean;
  /**
   * Wall-clock ms when the user last dismissed the cap-exceeded in-modal
   * banner. `null` = never dismissed (banner shows whenever a warning is
   * active). The renderer pairs this with `lastCapWarningOverageBytes` so the
   * banner re-appears when the overage grows past the previously-dismissed
   * value.
   */
  capBannerDismissedAt: number | null;
  /**
   * The `overageBytes` of the warning that was active when the user last
   * dismissed the in-modal banner. `null` = no dismissal recorded. When a
   * new warning's overage exceeds this, the banner re-surfaces — the
   * "dismiss is for the current overage" rule.
   */
  lastCapWarningOverageBytes: number | null;
}

/**
 * Defaults are conservative — local-only, line diff, 30-day trash, 200 MB
 * cap. `enabled: true` so day-one users get protection without configuring.
 */
export function defaultRecoverySettings(): RecoverySettings {
  const policy = defaultRetentionPolicy();
  const tierDestinations: TierDestinationConfig[] = policy.tiers.map(
    (_t, i) => ({ tierIndex: i, destinations: ["local"] }),
  );
  return {
    enabled: true,
    retentionPolicy: policy,
    tierDestinations,
    trashRetentionDays: 30,
    diffStyle: "line",
    maxStorageBytes: 200 * 1024 * 1024,
    historyTimelineWidth: 340,
    historyTimelineCollapsed: false,
    historyPreviewCollapsed: false,
    capBannerDismissedAt: null,
    lastCapWarningOverageBytes: null,
  };
}

/**
 * Migration: fill in any missing keys without clobbering user-set values.
 * Caller (host settings store) hands us whatever it loaded from disk; we
 * return a complete `RecoverySettings`. Pure: input is not mutated.
 *
 * Unknown extra keys are dropped — settings should round-trip cleanly through
 * a typed shape.
 */
export function migrateRecoverySettings(raw: unknown): RecoverySettings {
  const defaults = defaultRecoverySettings();
  if (!raw || typeof raw !== "object") return defaults;
  const r = raw as Partial<RecoverySettings> & Record<string, unknown>;

  const merged: RecoverySettings = {
    enabled: typeof r.enabled === "boolean" ? r.enabled : defaults.enabled,
    retentionPolicy:
      r.retentionPolicy &&
      typeof r.retentionPolicy === "object" &&
      Array.isArray((r.retentionPolicy as RetentionPolicy).tiers)
        ? (r.retentionPolicy as RetentionPolicy)
        : defaults.retentionPolicy,
    archiveFolder:
      typeof r.archiveFolder === "string" ? r.archiveFolder : undefined,
    tierDestinations: Array.isArray(r.tierDestinations)
      ? (r.tierDestinations as TierDestinationConfig[])
      : defaults.tierDestinations,
    trashRetentionDays:
      typeof r.trashRetentionDays === "number"
        ? r.trashRetentionDays
        : defaults.trashRetentionDays,
    diffStyle:
      r.diffStyle === "line" || r.diffStyle === "word"
        ? r.diffStyle
        : defaults.diffStyle,
    maxStorageBytes:
      r.maxStorageBytes === null
        ? null
        : typeof r.maxStorageBytes === "number"
          ? r.maxStorageBytes
          : defaults.maxStorageBytes,
    deviceName:
      typeof r.deviceName === "string" && r.deviceName.trim().length > 0
        ? r.deviceName
        : undefined,
    historyTimelineWidth:
      typeof r.historyTimelineWidth === "number" &&
      Number.isFinite(r.historyTimelineWidth) &&
      r.historyTimelineWidth >= 200
        ? r.historyTimelineWidth
        : defaults.historyTimelineWidth,
    historyTimelineCollapsed:
      typeof r.historyTimelineCollapsed === "boolean"
        ? r.historyTimelineCollapsed
        : defaults.historyTimelineCollapsed,
    historyPreviewCollapsed:
      typeof r.historyPreviewCollapsed === "boolean"
        ? r.historyPreviewCollapsed
        : defaults.historyPreviewCollapsed,
    capBannerDismissedAt:
      typeof r.capBannerDismissedAt === "number" &&
      Number.isFinite(r.capBannerDismissedAt)
        ? r.capBannerDismissedAt
        : null,
    lastCapWarningOverageBytes:
      typeof r.lastCapWarningOverageBytes === "number" &&
      Number.isFinite(r.lastCapWarningOverageBytes)
        ? r.lastCapWarningOverageBytes
        : null,
  };

  // If tierDestinations got shorter or longer than the policy, pad/truncate
  // to keep them aligned. Padding fills with `['local']` (the safe default).
  const tierCount = merged.retentionPolicy.tiers.length;
  if (merged.tierDestinations.length !== tierCount) {
    const aligned: TierDestinationConfig[] = [];
    for (let i = 0; i < tierCount; i++) {
      const existing = merged.tierDestinations.find((t) => t.tierIndex === i);
      aligned.push(existing ?? { tierIndex: i, destinations: ["local"] });
    }
    merged.tierDestinations = aligned;
  }

  return merged;
}

/**
 * On first archive-folder pick, default daily-and-older tiers to `['local',
 * 'archive']` per the design doc recommendation. "Daily and older" =
 * tier whose granularity is `daily`, `weekly`, `monthly`, `yearly`, or
 * `forever`. Doesn't override existing user choices: tiers already set to
 * something other than the default `['local']` are left as-is.
 *
 * Returns a fresh `tierDestinations` array. Pure.
 */
export function applyArchiveDefaults(
  settings: RecoverySettings,
): TierDestinationConfig[] {
  const dailyOrSlower = new Set([
    "daily",
    "weekly",
    "monthly",
    "yearly",
    "forever",
  ]);
  return settings.retentionPolicy.tiers.map((tier, i) => {
    const existing = settings.tierDestinations.find(
      (t) => t.tierIndex === i,
    ) ?? { tierIndex: i, destinations: ["local"] };

    // Only override if the user hasn't already changed this tier (i.e. it's
    // still the bare `['local']` default).
    const isDefault =
      existing.destinations.length === 1 &&
      existing.destinations[0] === "local";

    if (isDefault && dailyOrSlower.has(tier.granularity)) {
      return {
        tierIndex: i,
        destinations: ["local", "archive"] as const,
      } as TierDestinationConfig;
    }
    return { tierIndex: i, destinations: [...existing.destinations] };
  });
}
