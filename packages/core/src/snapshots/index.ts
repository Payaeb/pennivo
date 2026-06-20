// Snapshot module — pure planner for Pennivo Phase 13a (file recovery +
// versioning). Framework-free: no fs / IPC / React / Electron / Node deps.
//
// See docs/file-recovery-and-versioning.md for the full design.

export type {
  Snapshot,
  SnapshotAuthor,
  RetentionGranularity,
  RetentionTier,
  RetentionPolicy,
  PruneWarning,
  PruneResult,
  StorageDestination,
  TierDestinationConfig,
} from "./types";

export {
  snapshotPathSegments,
  snapshotFileBasename,
  normalizeAbsolutePath,
  type SnapshotPathSegments,
} from "./path";

export { sha1Hex } from "./sha1";

export { shouldDedupe } from "./dedupe";

export { defaultRetentionPolicy, tierForAge, prune } from "./retention";

export { routeSnapshot } from "./routing";

export { detectExternalChange, type ExternalChangeStatus } from "./external";

export { dedupeArchiveQueue, type ArchiveQueueEntry } from "./archiveQueue";

export {
  defaultRecoverySettings,
  migrateRecoverySettings,
  applyArchiveDefaults,
  type RecoverySettings,
  type DiffStyle,
} from "./recoverySettings";

export {
  type TierAgeUnit,
  tierAgeToMs,
  msToTierAge,
  formatTierAgeRange,
  insertTier,
  removeTier,
  setTierGranularity,
} from "./retentionEditor";

export { shouldShowCapBanner } from "./capBanner";

export {
  type McpAuditEvent,
  type McpWriteMatch,
  MCP_WRITE_TOOLS,
  matchMcpWrite,
  parseAuditLines,
} from "./mcpAttribution";
