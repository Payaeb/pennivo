import "./CapExceededBanner.css";

export interface CapWarning {
  /**
   * Discriminator (matches `PruneWarning` from `@pennivo/core`). Future
   * variants land alongside without breaking consumers.
   */
  kind: "cap-exceeded";
  currentBytes: number;
  capBytes: number;
  overageBytes: number;
  protectedBytes: number;
  protectedSnapshotCount: number;
}

interface CapExceededBannerProps {
  warning: CapWarning;
  onOpenSettings: () => void;
  onChangeRules: () => void;
  onManageManually: () => void;
  onDismiss: () => void;
}

/**
 * In-modal warm-amber banner shown at the top of the History / Trash views
 * when the snapshot cap is exceeded and the user hasn't dismissed the
 * current overage. See docs/file-recovery-ui-design.md §2.6.
 */
export function CapExceededBanner({
  warning,
  onOpenSettings,
  onChangeRules,
  onManageManually,
  onDismiss,
}: CapExceededBannerProps) {
  return (
    <div className="cap-exceeded-banner" role="status" aria-live="polite">
      <span className="cap-exceeded-banner-glyph" aria-hidden="true">
        !
      </span>
      <span className="cap-exceeded-banner-message">
        {warning.protectedSnapshotCount} protected snapshot
        {warning.protectedSnapshotCount === 1 ? "" : "s"}{" "}
        {warning.protectedSnapshotCount === 1 ? "is" : "are"}{" "}
        {formatBytes(warning.overageBytes)} over your{" "}
        {formatBytes(warning.capBytes)} cap.
      </span>
      <div className="cap-exceeded-banner-actions">
        <button
          type="button"
          className="cap-exceeded-banner-btn"
          onClick={onOpenSettings}
        >
          Open Settings
        </button>
        <button
          type="button"
          className="cap-exceeded-banner-btn"
          onClick={onChangeRules}
        >
          Change rules
        </button>
        <button
          type="button"
          className="cap-exceeded-banner-btn"
          onClick={onManageManually}
        >
          Manage manually
        </button>
        <button
          type="button"
          className="cap-exceeded-banner-close"
          onClick={onDismiss}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
