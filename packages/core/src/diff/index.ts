// Pure diff module — computes unified line diffs for the History panel
// renderer. See ./computeDiff.ts for the algorithm + ./types.ts for shapes.

export type {
  DiffMode,
  DiffLine,
  DiffLineKind,
  DiffHunk,
  DiffResult,
} from "./types";

export { computeDiff } from "./computeDiff";

export {
  computeMergeSegments,
  applyMergeResolutions,
  mergeResolution,
  countHunks,
  type MergeChoice,
  type MergeHunk,
  type MergeSegment,
} from "./merge";
