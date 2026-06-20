import "./Statusbar.css";

export type SaveStatus = "saved" | "saving" | "unsaved" | "external-reload";

interface StatusbarProps {
  wordCount: number;
  charCount: number;
  saveStatus: SaveStatus;
  showWordCount?: boolean;
  /** When true, render the per-doc streaming-animation toggle (a doc is open
   *  in WYSIWYG mode). When false the control is hidden entirely. */
  showStreamingToggle?: boolean;
  /** Current checked state of the streaming toggle for the open doc. */
  streamingEnabled?: boolean;
  /** Fired with the new value when the user flips the streaming toggle. */
  onStreamingToggle?: (enabled: boolean) => void;
}

export function Statusbar({
  wordCount,
  charCount,
  saveStatus,
  showWordCount = true,
  showStreamingToggle = false,
  streamingEnabled = false,
  onStreamingToggle,
}: StatusbarProps) {
  const rawMinutes = wordCount / 238;
  const readingLabel =
    rawMinutes < 1 ? "< 1 min read" : `${Math.ceil(rawMinutes)} min read`;

  return (
    <div className="statusbar" role="status">
      <StatusSave status={saveStatus} />
      {showWordCount && (
        <>
          <span className="status-sep">·</span>
          <span className="status-item">
            {wordCount.toLocaleString()} words
          </span>
          <span className="status-sep">·</span>
          <span className="status-item">
            {charCount.toLocaleString()} characters
          </span>
          <span className="status-sep">·</span>
          <span className="status-item">{readingLabel}</span>
        </>
      )}
      {showStreamingToggle && (
        <>
          <span className="status-spacer" />
          <label className="status-streaming-toggle" title="Animate incremental updates when this file is rewritten by an agent">
            <input
              type="checkbox"
              checked={streamingEnabled}
              onChange={(e) => onStreamingToggle?.(e.target.checked)}
            />
            Streaming animation
          </label>
        </>
      )}
    </div>
  );
}

function StatusSave({ status }: { status: SaveStatus }) {
  return (
    <span
      className={`status-item status-save status-save--${status}`}
      aria-live="polite"
    >
      <span className="status-save-dot" />
      {status === "saving"
        ? "Saving…"
        : status === "unsaved"
          ? "Unsaved"
          : status === "external-reload"
            ? "Updated from disk"
            : "Saved"}
    </span>
  );
}
