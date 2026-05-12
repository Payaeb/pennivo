// Phase 13a recovery UI module — modal shell + History tab + line-diff
// renderer (this slice). Trash tab body, Compare-merge body, Settings →
// Recovery section land in subsequent slices.

export { RecoveryModal, type RecoveryModalMode } from "./RecoveryModal";
export { HistoryView } from "./HistoryView";
export { TrashView } from "./TrashView";
export { LineDiff } from "./LineDiff";
export { RecoveryModalWidthMeasurer } from "./WidthMeasurer";
export { CapExceededBanner, type CapWarning } from "./CapExceededBanner";
export { CapExceededToast } from "./CapExceededToast";
export {
  CompareMergeView,
  type CompareMergeSelection,
  type CompareMergeSide,
} from "./CompareMergeView";
export { ExternalChangeToast } from "./ExternalChangeToast";
