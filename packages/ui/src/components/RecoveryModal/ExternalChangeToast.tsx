import { useEffect } from "react";
import "./ExternalChangeToast.css";

interface ExternalChangeToastProps {
  /** Absolute path of the file that changed externally. */
  absolutePath: string;
  /**
   * Which situation produced the toast:
   *  - `"external"` (default): a non-open file (or a file already in sync)
   *    changed outside Pennivo — informational, offers "View history".
   *  - `"conflict"`: the OPEN file changed on disk while it had unsaved edits —
   *    offers "Compare & merge" so the user reconciles instead of clobbering.
   */
  variant?: "external" | "conflict";
  /** "View history" jumps the recovery modal to this file in History mode. */
  onViewHistory?: () => void;
  /** "Compare & merge" opens the merge view (conflict variant only). */
  onCompareMerge?: () => void;
  /** Dismiss the toast immediately. */
  onDismiss: () => void;
  /**
   * Auto-dismiss delay in ms. Defaults to 30000 — long enough for a writer
   * to actually notice and read the toast in the corner of their eye while
   * still finite so it doesn't pin to the screen forever.
   */
  autoDismissMs?: number;
}

/**
 * Toast surfaced when `recovery:external-change-detected` fires. Lives bottom-
 * right above the statusbar; warm-amber accent on the left edge — same family
 * as the cap-exceeded toast / banner.
 *
 * Visibility / per-file dedupe lives in App.tsx (this component renders
 * unconditionally; the parent decides whether to mount it).
 */
export function ExternalChangeToast({
  absolutePath,
  variant = "external",
  onViewHistory,
  onCompareMerge,
  onDismiss,
  autoDismissMs = 30000,
}: ExternalChangeToastProps) {
  // Auto-dismiss timer. Re-armed when `absolutePath` changes (new toast for
  // a different file resets the countdown).
  useEffect(() => {
    const id = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(id);
  }, [onDismiss, autoDismissMs, absolutePath]);

  const isConflict = variant === "conflict";

  return (
    <div className="external-change-toast" role="status" aria-live="polite">
      <div className="external-change-toast-body">
        <span className="external-change-toast-message">
          {isConflict
            ? "This file changed on disk while you had unsaved edits. Your edits are kept."
            : "This file changed outside Pennivo. A snapshot was taken."}
        </span>
        <div className="external-change-toast-actions">
          {isConflict ? (
            <button
              type="button"
              className="external-change-toast-btn"
              onClick={onCompareMerge}
            >
              Compare &amp; merge
            </button>
          ) : (
            <button
              type="button"
              className="external-change-toast-btn"
              onClick={onViewHistory}
            >
              View history
            </button>
          )}
          <button
            type="button"
            className="external-change-toast-btn"
            onClick={onDismiss}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
