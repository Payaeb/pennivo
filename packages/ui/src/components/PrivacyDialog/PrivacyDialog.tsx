import { useEffect, useMemo, useRef } from "react";
import { getPlatform } from "../../platform";
import { PRIVACY_TEXT } from "../../content/privacy";
import { renderPrivacyMarkdown } from "./renderPrivacyMarkdown";
import "./PrivacyDialog.css";

interface PrivacyDialogProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * In-app privacy notice. Renders the bundled `PRIVACY_TEXT` (mirrored from
 * the repo-root `PRIVACY.md`) so the document is viewable completely
 * offline — no GitHub URL, no IPC, no fs read at runtime.
 *
 * Mirrors the AboutDialog modal pattern: overlay + card, Esc closes,
 * single Close button. Links inside the body open in the OS default
 * browser via `platform.openExternal` (same as About).
 */
export function PrivacyDialog({ visible, onClose }: PrivacyDialogProps) {
  const platform = getPlatform();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [visible, onClose]);

  // Parse once per mount — privacy text is a constant.
  const body = useMemo(
    () =>
      renderPrivacyMarkdown(PRIVACY_TEXT, (url) => {
        platform.openExternal(url);
      }),
    // platform is the project-wide stable singleton (getPlatform() returns the same instance)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  if (!visible) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  return (
    <div
      className="privacy-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
    >
      <div
        className="privacy-card"
        role="dialog"
        aria-label="Pennivo Privacy Notice"
        aria-modal="true"
      >
        <div className="privacy-body">{body}</div>
        <button
          type="button"
          className="privacy-close"
          onClick={onClose}
          autoFocus
        >
          Close
        </button>
      </div>
    </div>
  );
}
