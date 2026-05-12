import "./ArchiveStatusChip.css";

interface ArchiveStatusChipProps {
  /** Archive queue state, as reported by `recovery:archive-status`. */
  status: "ok" | "unavailable" | "queued";
  /** When `status === 'queued'`, how many entries are waiting. */
  count: number;
  /**
   * Click handler. The intended behavior is to open SettingsPanel scrolled
   * to the Recovery section's "Where snapshots are stored" sub-heading.
   */
  onClick: () => void;
}

/**
 * Small chip that lives in the titlebar's left section between the filename
 * and the dirty-dot. Hidden in the `'ok'` state; visible when the archive
 * queue has unflushed entries (`'queued'`) or when the archive folder is
 * unreachable (`'unavailable'`).
 *
 * Uses the `--warning` token (warm amber) — informational, not alarming.
 * Carries `-webkit-app-region: no-drag` so it remains clickable inside the
 * titlebar's drag region.
 */
export function ArchiveStatusChip({
  status,
  count,
  onClick,
}: ArchiveStatusChipProps) {
  if (status === "ok") return null;
  if (status === "queued" && count === 0) return null;

  const label =
    status === "unavailable" ? "Archive offline" : "Archive offline";
  const tooltip =
    status === "unavailable"
      ? "Archive folder unreachable. Click to fix."
      : `${count} snapshot${count === 1 ? "" : "s"} waiting for archive.`;

  return (
    <button
      type="button"
      className="archive-status-chip"
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
    >
      <span className="archive-status-chip-dot" aria-hidden="true" />
      <span className="archive-status-chip-label">{label}</span>
    </button>
  );
}
