import { useEffect } from "react";
import "./CapExceededToast.css";
import type { CapWarning } from "./CapExceededBanner";

interface CapExceededToastProps {
  warning: CapWarning;
  onOpenSettings: () => void;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. Defaults to 8000 per the design spec. */
  autoDismissMs?: number;
}

/**
 * One-time-per-session toast surfaced when `recovery:cap-exceeded` first
 * fires. Lives bottom-right above the statusbar; warm-amber accent on the
 * left edge to match the in-modal banner.
 *
 * Visibility / first-of-session bookkeeping is owned by App.tsx — this
 * component renders unconditionally; the parent decides whether to mount it.
 */
export function CapExceededToast({
  warning,
  onOpenSettings,
  onDismiss,
  autoDismissMs = 8000,
}: CapExceededToastProps) {
  useEffect(() => {
    const id = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(id);
  }, [onDismiss, autoDismissMs]);

  return (
    <div className="cap-exceeded-toast" role="status" aria-live="polite">
      <div className="cap-exceeded-toast-body">
        <span className="cap-exceeded-toast-message">
          {warning.protectedSnapshotCount} protected snapshot
          {warning.protectedSnapshotCount === 1 ? "" : "s"}{" "}
          {warning.protectedSnapshotCount === 1 ? "is" : "are"}{" "}
          {formatBytes(warning.overageBytes)} over your{" "}
          {formatBytes(warning.capBytes)} cap.
        </span>
        <div className="cap-exceeded-toast-actions">
          <button
            type="button"
            className="cap-exceeded-toast-btn"
            onClick={onOpenSettings}
          >
            Open Settings
          </button>
          <button
            type="button"
            className="cap-exceeded-toast-btn"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
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
