// Snapshot types — pure data shapes for the file-recovery / versioning
// pipeline. No I/O, no framework deps. Shared by desktop, future Android /
// iOS hosts, and the future cloud sync module.
//
// Design reference: docs/file-recovery-and-versioning.md (Phase 13a).

/**
 * Origin of an edit captured in a snapshot.
 *
 * - `user`        — default; save originated from the editor.
 * - `mcp`         — Phase 12a's MCP write tools tagged the next snapshot.
 * - `inline-ai`   — Phase 12c BYO-key inline AI tagged its write.
 * - `external`    — disk content differed from the last snapshot on file
 *                   open (faulty sync, another editor, OS hiccup, etc.).
 * - `sync`        — Phase 13b cross-device sync delivered this snapshot.
 */
export type SnapshotAuthor = "user" | "mcp" | "inline-ai" | "external" | "sync";

/**
 * Granularity rule applied within a retention tier.
 *
 * - `every`     — keep every snapshot in this tier.
 * - `hourly`    — keep one per UTC hour bucket.
 * - `daily`     — keep one per UTC day bucket.
 * - `weekly`    — keep one per ISO-week bucket (Mon-anchored, UTC).
 * - `monthly`   — keep one per UTC year+month bucket.
 * - `yearly`    — keep one per UTC year bucket.
 * - `forever`   — keep every snapshot in this tier regardless of age.
 * - `off`       — drop every snapshot in this tier.
 *
 * For `hourly` / `daily` / `weekly` / `monthly` / `yearly` the "latest in
 * bucket" is kept (most recent state of the file in that hour / day / etc.).
 */
export type RetentionGranularity =
  | "every"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "forever"
  | "off";

export interface RetentionTier {
  /**
   * Upper bound (exclusive) of the age range this tier covers, in
   * milliseconds. Snapshots older than the largest `maxAgeMs` across all
   * tiers fall outside the table and are evicted.
   */
  maxAgeMs: number;
  /** Granularity rule used to thin snapshots within this tier. */
  granularity: RetentionGranularity;
}

export interface RetentionPolicy {
  /**
   * Tiers in age-ascending order (smallest `maxAgeMs` first). The pruner
   * walks tiers in this order; the first tier whose `maxAgeMs` exceeds the
   * snapshot's age owns the snapshot.
   */
  tiers: RetentionTier[];
  /**
   * Optional global cap on the total `sizeBytes` of kept snapshots.
   * `undefined` means unlimited.
   */
  maxStorageBytes?: number;
}

export type StorageDestination = "local" | "archive";

export interface TierDestinationConfig {
  /** Index into `RetentionPolicy.tiers` this rule applies to. */
  tierIndex: number;
  /** Destinations the snapshot should be written to. */
  destinations: StorageDestination[];
}

/**
 * A structured warning emitted by `prune` when it could not fully honor the
 * retention policy. Modeled as a discriminated union (`kind`) so additional
 * variants can be added later without breaking consumers — e.g. archive
 * unavailable, tier misconfiguration, etc.
 *
 * The pruner stays pure: warnings are returned, never thrown or logged.
 * The UI layer is expected to translate these into user-facing notifications.
 */
export type PruneWarning = {
  /** Discriminator — only `cap-exceeded` exists today. */
  kind: "cap-exceeded";
  /** Total `sizeBytes` of snapshots the pruner kept. */
  currentBytes: number;
  /** The cap from `RetentionPolicy.maxStorageBytes`. */
  capBytes: number;
  /** `currentBytes - capBytes` (always positive when this warning fires). */
  overageBytes: number;
  /**
   * Total `sizeBytes` of forever-tier snapshots that the pruner refused to
   * evict. Equal to or greater than `overageBytes` (otherwise the pruner
   * would have evicted enough non-forever snapshots to satisfy the cap).
   */
  protectedBytes: number;
  /** Count of forever-tier snapshots that the pruner refused to evict. */
  protectedSnapshotCount: number;
};

/**
 * Return shape of `prune`. `warnings` is always an array (possibly empty)
 * so consumers can iterate without a null check. `keep` and `evict` are
 * disjoint and together form a partition of the input snapshots.
 */
export interface PruneResult {
  keep: Snapshot[];
  evict: Snapshot[];
  warnings: PruneWarning[];
}

export interface Snapshot {
  /** Stable per-snapshot identifier (e.g. the ISO-8601 filename basename). */
  id: string;
  /** Wall-clock timestamp the snapshot was captured at, ms since epoch. */
  ts: number;
  /** Size of the snapshot's content in bytes. */
  sizeBytes: number;
  /** Hex digest of the snapshot's content (sha256 in production). */
  contentHash: string;
  /** Origin of the change that produced this snapshot. */
  author: SnapshotAuthor;
  /** Free-form name of the agent for `mcp` / `inline-ai` authors. */
  agentName?: string;
  /** Random-UUID device identifier. */
  deviceId: string;
  /** User-friendly device name (defaults to OS hostname). */
  deviceName?: string;
  /** Ancestor snapshot id used by 3-way merge. */
  parentSnapshotId?: string;
}
