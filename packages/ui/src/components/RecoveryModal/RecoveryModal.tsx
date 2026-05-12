import { useEffect, useRef, type ReactNode } from "react";
import "./RecoveryModal.css";

/**
 * Mode-driven modal that hosts the three Phase 13a recovery surfaces:
 * History, Trash, and Compare-merge. Per the locked design (§2.3, §2.4),
 * all three share the same overlay / chrome / Esc contract; only the body
 * + footer change between modes.
 *
 * In this slice we only render `'history'` and `'trash'` segments; the
 * `'compare-merge'` mode renders a placeholder so the next slice can swap
 * in the real body without touching the shell.
 */
export type RecoveryModalMode = "history" | "trash" | "compare-merge";

interface RecoveryModalProps {
  /** Controls visibility — render is no-op when false. */
  open: boolean;
  /** Which sub-surface to render in the body. */
  mode: RecoveryModalMode;
  /**
   * Called when the user wants to switch between History and Trash via the
   * top-right segmented control. Compare-merge mode does not switch via the
   * segmented control — it's entered from the History footer and exited via
   * the back arrow / first Esc.
   */
  onModeChange: (mode: "history" | "trash") => void;
  /** Optional title override. Defaults match the mode (e.g. "Trash"). */
  title?: string;
  /**
   * Called for "close everything" — single Esc in History/Trash, second Esc
   * in compare-merge. Compare-merge passes its own back-handler via the body
   * so the back arrow works without the shell knowing what mode it's in.
   */
  onClose: () => void;
  /**
   * Optional close-request interceptor. When provided, the shell's × button
   * and overlay click route through this instead of `onClose`. Lets the body
   * (e.g. CompareMergeView's discard-confirm guard) veto a close attempt
   * without changing the underlying close machinery. Esc handling is NOT
   * affected — the Esc contract (single Esc closes; or first Esc → back when
   * `onBack` is set) stays unchanged.
   */
  onCloseRequest?: () => void;
  /**
   * When provided, a small `← Back` button renders to the left of the title.
   * Compare-merge mode uses this to return to History without closing the
   * modal. Esc handling: when `onBack` is set, the FIRST Esc fires `onBack`
   * (back to History); a second Esc closes everything.
   */
  onBack?: () => void;
  /** Mode-owned body. Render slot. */
  children: ReactNode;
}

/**
 * `RecoveryModal` — the shared chrome.
 *
 * Sizing: 1080 px wide, 92vw cap, ~85vh tall. Border-radius and shadow
 * match `SettingsPanel` / `ShortcutsSheet` / `AboutDialog`.
 *
 * The overlay carries `-webkit-app-region: no-drag` so the close button
 * (and any controls in the top 36 px) aren't swallowed by the OS-level
 * window-drag handle. Same fix `SettingsPanel` documents.
 */
export function RecoveryModal({
  open,
  mode,
  onModeChange,
  title,
  onClose,
  onCloseRequest,
  onBack,
  children,
}: RecoveryModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (onBack) {
          // Compare-merge mode: first Esc backs out to the parent mode.
          onBack();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, onBack]);

  if (!open) return null;

  const requestClose = () => {
    if (onCloseRequest) onCloseRequest();
    else onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) requestClose();
  };

  const resolvedTitle =
    title ??
    (mode === "history"
      ? "History"
      : mode === "trash"
        ? "Trash"
        : "Compare & merge");

  return (
    <div
      className="recovery-modal-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className="recovery-modal-card"
        role="dialog"
        aria-label={resolvedTitle}
        aria-modal="true"
      >
        <div className="recovery-modal-header">
          {onBack && (
            <button
              type="button"
              className="recovery-modal-back-btn"
              onClick={onBack}
              aria-label="Back"
              title="Back to History"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="10 12 6 8 10 4" />
              </svg>
              <span className="recovery-modal-back-label">Back</span>
            </button>
          )}
          <span className="recovery-modal-title">{resolvedTitle}</span>
          {mode !== "compare-merge" && (
            <div
              className="recovery-modal-segmented"
              role="tablist"
              aria-label="Recovery view"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "history"}
                className={`recovery-modal-segmented-btn${
                  mode === "history"
                    ? " recovery-modal-segmented-btn--active"
                    : ""
                }`}
                onClick={() => onModeChange("history")}
              >
                History
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "trash"}
                className={`recovery-modal-segmented-btn${
                  mode === "trash"
                    ? " recovery-modal-segmented-btn--active"
                    : ""
                }`}
                onClick={() => onModeChange("trash")}
              >
                Trash
              </button>
            </div>
          )}
          <button
            type="button"
            className="recovery-modal-close-btn"
            onClick={requestClose}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
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
        <div className="recovery-modal-body">{children}</div>
      </div>
    </div>
  );
}
