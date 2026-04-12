import { useEffect, useRef } from "react";
import "./LinkActionSheet.css";

export interface LinkActionSheetProps {
  href: string;
  anchorRect: { top: number; left: number } | null;
  onOpen: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Mobile-only bottom sheet that appears when the user taps a link in the editor.
 * Offers Open / Edit / Copy / Remove actions with 44px minimum touch targets.
 */
export function LinkActionSheet({
  href,
  onOpen,
  onEdit,
  onCopy,
  onRemove,
  onClose,
}: LinkActionSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="link-action-sheet-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="link-action-sheet"
        ref={sheetRef}
        role="dialog"
        aria-label="Link actions"
      >
        <div className="link-action-sheet-url" title={href}>
          {href}
        </div>
        <div className="link-action-sheet-actions">
          <button
            type="button"
            className="link-action-sheet-btn"
            onClick={onOpen}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            <span>Open</span>
          </button>
          <button
            type="button"
            className="link-action-sheet-btn"
            onClick={onEdit}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="link-action-sheet-btn"
            onClick={onCopy}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>Copy</span>
          </button>
          <button
            type="button"
            className="link-action-sheet-btn link-action-sheet-btn--danger"
            onClick={onRemove}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.72" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.72" />
              <line x1="4" y1="20" x2="20" y2="4" />
            </svg>
            <span>Remove</span>
          </button>
        </div>
        <button
          type="button"
          className="link-action-sheet-cancel"
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
