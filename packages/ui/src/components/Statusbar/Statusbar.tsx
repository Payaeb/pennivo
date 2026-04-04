import './Statusbar.css';

export type SaveStatus = 'saved' | 'saving' | 'unsaved';

interface StatusbarProps {
  wordCount: number;
  saveStatus: SaveStatus;
}

export function Statusbar({ wordCount, saveStatus }: StatusbarProps) {
  const readingMinutes = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div className="statusbar">
      <StatusSave status={saveStatus} />
      <span className="status-sep">·</span>
      <span className="status-item">{wordCount.toLocaleString()} words</span>
      <span className="status-sep">·</span>
      <span className="status-item">{readingMinutes} min read</span>
    </div>
  );
}

function StatusSave({ status }: { status: SaveStatus }) {
  return (
    <span className={`status-item status-save status-save--${status}`}>
      <span className="status-save-dot" />
      {status === 'saving' ? 'Saving…' : status === 'unsaved' ? 'Unsaved' : 'Saved'}
    </span>
  );
}
