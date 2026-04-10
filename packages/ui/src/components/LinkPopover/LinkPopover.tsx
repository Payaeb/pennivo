import { useState, useRef, useEffect, useCallback } from "react";
import "./LinkPopover.css";

interface LinkPopoverProps {
  hasSelection: boolean;
  initialUrl?: string;
  initialText?: string;
  anchorRect: { top: number; left: number } | null;
  onConfirm: (url: string, text: string) => void;
  onCancel: () => void;
}

export function LinkPopover({
  hasSelection,
  initialUrl = "",
  initialText = "",
  anchorRect,
  onConfirm,
  onCancel,
}: LinkPopoverProps) {
  const [url, setUrl] = useState(initialUrl);
  const [text, setText] = useState(initialText);
  const urlRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Focus the URL input on mount
  useEffect(() => {
    // Small delay to avoid toolbar click stealing focus
    const t = setTimeout(() => urlRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onCancel]);

  const handleSubmit = useCallback(() => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const label = hasSelection ? "" : text.trim() || trimmedUrl;
    onConfirm(trimmedUrl, label);
  }, [url, text, hasSelection, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Tab") {
        // Focus trap: cycle between inputs and buttons within popover
        const focusable =
          popoverRef.current?.querySelectorAll<HTMLElement>("input, button");
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [handleSubmit, onCancel],
  );

  if (!anchorRect) return null;

  // Position the popover below the anchor point
  const style: React.CSSProperties = {
    top: anchorRect.top + 4,
    left: anchorRect.left,
  };

  return (
    <div
      className="link-popover"
      ref={popoverRef}
      style={style}
      role="dialog"
      aria-label="Insert link"
    >
      {!hasSelection && (
        <>
          <label htmlFor="link-popover-text" className="sr-only">
            Link text
          </label>
          <input
            id="link-popover-text"
            className="link-popover-input"
            type="text"
            placeholder="Link text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </>
      )}
      <label htmlFor="link-popover-url" className="sr-only">
        URL
      </label>
      <input
        id="link-popover-url"
        ref={urlRef}
        className="link-popover-input"
        type="url"
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="link-popover-actions">
        <button
          className="link-popover-btn link-popover-btn--confirm"
          onClick={handleSubmit}
        >
          Insert
        </button>
        <button
          className="link-popover-btn link-popover-btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <span className="link-popover-hint">
          Enter to confirm, Esc to cancel
        </span>
      </div>
    </div>
  );
}
