import './Statusbar.css';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

interface StatusbarProps {
  wordCount: number;
  charCount: number;
  saveStatus: SaveStatus;
}

export function Statusbar({ wordCount, charCount, saveStatus }: StatusbarProps) {
  const rawMinutes = wordCount / 238;
  const readingLabel = rawMinutes < 1 ? '< 1 min read' : `${Math.ceil(rawMinutes)} min read`;

  return (
    <div className="statusbar" role="status">
      <StatusSave status={saveStatus} />
      <span className="status-sep">·</span>
      <span className="status-item">{wordCount.toLocaleString()} words</span>
      <span className="status-sep">·</span>
      <span className="status-item">{charCount.toLocaleString()} characters</span>
      <span className="status-sep">·</span>
      <span className="status-item">{readingLabel}</span>
    </div>
  );
}

function StatusSave({ status }: { status: SaveStatus }) {
  return (
    <span className={`status-item status-save status-save--${status}`} aria-live="polite">
      <span className="status-save-dot" />
      {status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : 'Saved'}
    </span>
  );
}
