export const PENNIVO_VERSION = "0.1.0";

export {
  type GanttTask,
  type GanttSection,
  type GanttData,
  generateTaskId,
  createDefaultGanttData,
  parseMermaidGantt,
  ganttDataToMermaid,
} from "./gantt";

export {
  type KanbanCard,
  type KanbanColumn,
  type KanbanData,
  generateCardId,
  createDefaultKanbanData,
  parseKanbanMarkdown,
  kanbanDataToMarkdown,
} from "./kanban";

export {
  type ContextMenuInput,
  type ContextMenuItem,
  buildContextMenu,
} from "./contextMenu";

export {
  type NormalizePlanInput,
  type NormalizePlan,
  planNormalize,
  extractReferencedFolders,
  decodeImageUrlSpaces,
  encodeImageUrlSpaces,
} from "./assetNormalizer";

export { suggestFilenameFromContent } from "./filenameSuggest";

export {
  type Snapshot,
  type SnapshotAuthor,
  type RetentionGranularity,
  type RetentionTier,
  type RetentionPolicy,
  type PruneWarning,
  type PruneResult,
  type StorageDestination,
  type TierDestinationConfig,
  type SnapshotPathSegments,
  type ExternalChangeStatus,
  type ArchiveQueueEntry,
  type RecoverySettings,
  type DiffStyle,
  snapshotPathSegments,
  snapshotFileBasename,
  normalizeAbsolutePath,
  sha1Hex,
  shouldDedupe,
  defaultRetentionPolicy,
  tierForAge,
  prune,
  routeSnapshot,
  detectExternalChange,
  dedupeArchiveQueue,
  defaultRecoverySettings,
  migrateRecoverySettings,
  applyArchiveDefaults,
  type TierAgeUnit,
  tierAgeToMs,
  msToTierAge,
  formatTierAgeRange,
  insertTier,
  removeTier,
  setTierGranularity,
  shouldShowCapBanner,
} from "./snapshots";

export {
  type TrashEntry,
  type PickRestorePathOptions,
  trashEntryDirName,
  computeExpiresAtMs,
  findExpired,
  pickRestorePath,
  formatTrashExpiry,
  type MultiSelectInput,
  computeNextSelection,
} from "./trash";

export {
  type DiffMode,
  type DiffLine,
  type DiffLineKind,
  type DiffHunk,
  type DiffResult,
  computeDiff,
  computeMergeSegments,
  applyMergeResolutions,
  mergeResolution,
  countHunks,
  type MergeChoice,
  type MergeHunk,
  type MergeSegment,
} from "./diff";

export {
  formatDayGroupHeader,
  formatRowTime,
  groupByLocalDay,
} from "./diff/formatTimelineDate";
