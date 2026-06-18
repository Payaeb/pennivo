import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  computeNextSelection,
  formatDayGroupHeader,
  formatRowTime,
  formatTrashExpiry,
  groupByLocalDay,
  type TrashEntry,
} from "@pennivo/core";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { getPlatform } from "../../platform";
import "./HistoryView.css";
import "./TrashView.css";

interface TrashViewProps {
  /** Surface a transient toast message — same channel HistoryView uses. */
  onShowToast?: (message: string, isError?: boolean) => void;
  /** Persisted layout settings — symmetric with HistoryView for the shared
   * resizable-panes contract. */
  timelineWidth: number;
  timelineCollapsed: boolean;
  previewCollapsed: boolean;
  onLayoutChange: (next: {
    timelineWidth?: number;
    timelineCollapsed?: boolean;
    previewCollapsed?: boolean;
  }) => void;
  /** Modal width — used to trigger sub-800px auto-collapse of the timeline. */
  modalWidth: number;
}

/**
 * Bookkeeping the renderer needs but the engine doesn't store on the entry.
 * Re-derived each render so it stays cheap.
 */
interface TrashRow extends TrashEntry {
  /** `ts` alias so `groupByLocalDay` can bucket by deletion day. */
  ts: number;
}

const TIMELINE_MIN = 200;
const PREVIEW_MIN = 400;
const NARROW_MODAL_THRESHOLD = 800;

/**
 * `TrashView` — the Trash tab body. Workspace-scoped: lists every soft-
 * deleted file across the workspace (no per-file filter), grouped by deletion
 * day. Mirrors HistoryView's resizable-pane shell so the design language
 * stays consistent.
 *
 * Bulk select uses pure `computeNextSelection` from `@pennivo/core` — same
 * gesture vocabulary as Sidebar.tsx (shift-range, ctrl/cmd-toggle, plain
 * click selects only that row).
 */
export function TrashView({
  onShowToast,
  timelineWidth,
  timelineCollapsed,
  previewCollapsed,
  onLayoutChange,
  modalWidth,
}: TrashViewProps) {
  const platform = getPlatform();

  const [entries, setEntries] = useState<TrashRow[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [pendingConfirm, setPendingConfirm] = useState<
    | { kind: "delete-selected"; count: number }
    | { kind: "empty-trash"; count: number }
    | null
  >(null);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  // Refresh trash list on mount + whenever the platform fires count-changed.
  const refresh = useCallback(async () => {
    try {
      const rows = (await platform.trash.list()) as TrashEntry[];
      const ts: TrashRow[] = rows.map((r) => ({ ...r, ts: r.deletedAtMs }));
      setEntries(ts);
      // Drop dead selections so the footer counter stays honest.
      setSelectedIds((prev) =>
        prev.filter((id) => ts.some((r) => r.id === id)),
      );
    } catch (err) {
      console.error("[TrashView] list failed:", err);
      setEntries([]);
    }
  }, [platform]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setAutoCollapsed(modalWidth > 0 && modalWidth < NARROW_MODAL_THRESHOLD);
  }, [modalWidth]);

  // Lazy-load preview content for the most-recently-clicked row when exactly
  // one is selected.
  const lastSelectedId =
    selectedIds.length === 1
      ? selectedIds[0]
      : selectedIds.length === 0
        ? null
        : null; // 2+ selected → no preview
  useEffect(() => {
    let cancelled = false;
    if (!lastSelectedId) {
      setPreviewContent("");
      return;
    }
    platform.trash
      .read(lastSelectedId)
      .then((res) => {
        if (cancelled) return;
        setPreviewContent(res?.content ?? "");
      })
      .catch(() => {
        if (!cancelled) setPreviewContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [lastSelectedId, platform]);

  // Grouped-by-day view, in render order. Defined here (before the selection
  // helpers) so range-selection operates on the SAME order the DOM shows.
  const groups = useMemo(() => {
    if (!entries) return [];
    return groupByLocalDay(entries);
  }, [entries]);

  // Range selection (shift-click) must walk the visible order, not the raw
  // `entries` array — `groupByLocalDay` re-buckets and sorts within a day, so
  // the two can diverge (e.g. two same-day entries whose order depends on the
  // wall clock). Flatten the rendered groups so anchor→target ranges match
  // exactly what the user sees.
  const orderedIds = useMemo(
    () => groups.flatMap((g) => g.items.map((r) => r.id)),
    [groups],
  );

  const toggleSelection = useCallback(
    (
      id: string,
      ev: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ) => {
      setSelectedIds((prev) =>
        computeNextSelection({
          orderedIds,
          selectedIds: prev,
          clickedId: id,
          shiftKey: ev.shiftKey,
          ctrlKey: ev.ctrlKey,
          metaKey: ev.metaKey,
        }),
      );
    },
    [orderedIds],
  );

  // ----- Pane resize / collapse handlers (mirror HistoryView) -----

  const dragStartRef = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );
  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = {
        startX: e.clientX,
        startWidth: timelineWidth,
      };
      const onMove = (me: MouseEvent) => {
        if (!dragStartRef.current) return;
        const delta = me.clientX - dragStartRef.current.startX;
        const proposed = dragStartRef.current.startWidth + delta;
        const maxAllowed = Math.max(TIMELINE_MIN, modalWidth - PREVIEW_MIN - 8);
        const next = Math.max(TIMELINE_MIN, Math.min(maxAllowed, proposed));
        onLayoutChange({ timelineWidth: next });
      };
      const onUp = () => {
        dragStartRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [timelineWidth, onLayoutChange, modalWidth],
  );

  const collapseTimeline = useCallback(() => {
    if (previewCollapsed) return;
    onLayoutChange({ timelineCollapsed: true });
  }, [previewCollapsed, onLayoutChange]);
  const expandTimeline = useCallback(() => {
    onLayoutChange({ timelineCollapsed: false });
  }, [onLayoutChange]);
  const collapsePreview = useCallback(() => {
    if (timelineCollapsed || autoCollapsed) return;
    onLayoutChange({ previewCollapsed: true });
  }, [timelineCollapsed, autoCollapsed, onLayoutChange]);
  const expandPreview = useCallback(() => {
    onLayoutChange({ previewCollapsed: false });
  }, [onLayoutChange]);

  // ----- Footer actions -----

  const handleRestoreSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    let restored = 0;
    const failures: string[] = [];
    for (const id of selectedIds) {
      try {
        const res = await platform.trash.restore(id);
        if (res) restored += 1;
        else failures.push(id);
      } catch {
        failures.push(id);
      }
    }
    if (restored > 0) {
      onShowToast?.(`Restored ${restored} file${restored === 1 ? "" : "s"}.`);
    }
    if (failures.length > 0) {
      onShowToast?.(
        `Failed to restore ${failures.length} file${failures.length === 1 ? "" : "s"}.`,
        true,
      );
    }
    setSelectedIds([]);
    await refresh();
  }, [selectedIds, platform, onShowToast, refresh]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    setPendingConfirm({ kind: "delete-selected", count: selectedIds.length });
  }, [selectedIds]);

  const handleEmptyTrash = useCallback(() => {
    if (!entries || entries.length === 0) return;
    setPendingConfirm({ kind: "empty-trash", count: entries.length });
  }, [entries]);

  const confirmPending = useCallback(async () => {
    const action = pendingConfirm;
    setPendingConfirm(null);
    if (!action) return;
    const targetIds =
      action.kind === "delete-selected"
        ? [...selectedIds]
        : (entries ?? []).map((e) => e.id);
    let removed = 0;
    for (const id of targetIds) {
      try {
        const ok = await platform.trash.permanentlyDelete(id);
        if (ok) removed += 1;
      } catch (err) {
        console.error("[TrashView] permanentlyDelete failed:", err);
      }
    }
    if (removed > 0) {
      onShowToast?.(
        `Permanently deleted ${removed} file${removed === 1 ? "" : "s"}.`,
      );
    }
    setSelectedIds([]);
    await refresh();
  }, [pendingConfirm, selectedIds, entries, platform, onShowToast, refresh]);

  // ----- Render: grouped trash rows -----

  const timelineEff = timelineCollapsed || autoCollapsed;
  const previewEff = previewCollapsed && !timelineEff;
  const showTimelineRail = timelineEff;
  const showPreviewRail = previewEff;

  const selCount = selectedIds.length;
  const hasEntries = (entries?.length ?? 0) > 0;

  const confirmDialogProps = pendingConfirm
    ? pendingConfirm.kind === "empty-trash"
      ? {
          title: "Empty trash?",
          message: `Permanently delete all ${pendingConfirm.count} file${
            pendingConfirm.count === 1 ? "" : "s"
          } in trash? This cannot be undone.`,
          confirmLabel: "Empty trash",
        }
      : {
          title: "Delete permanently?",
          message: `Permanently delete ${pendingConfirm.count} file${
            pendingConfirm.count === 1 ? "" : "s"
          }? This cannot be undone.`,
          confirmLabel: "Delete permanently",
        }
    : null;

  return (
    <div className="history-view trash-view" data-modal-width={modalWidth}>
      <div className="history-view-body">
        {/* Timeline column / rail */}
        {showTimelineRail ? (
          <button
            type="button"
            className="history-view-rail history-view-rail--left"
            onClick={expandTimeline}
            aria-label="Expand trash list"
            title="Expand trash list"
          >
            <span className="history-view-rail-icon">»</span>
          </button>
        ) : (
          <div
            className="history-view-timeline"
            style={{ width: timelineWidth }}
          >
            <div className="history-view-pane-header">
              <span className="history-view-pane-title">Trash</span>
              <button
                type="button"
                className="history-view-pane-collapse"
                onClick={collapseTimeline}
                disabled={previewEff}
                aria-label="Collapse trash list"
                title="Collapse trash list"
              >
                «
              </button>
            </div>
            <div className="history-view-timeline-list">
              {entries === null ? (
                <div className="history-view-empty">Loading…</div>
              ) : entries.length === 0 ? (
                <div className="history-view-empty">Trash is empty.</div>
              ) : (
                groups.map((group) => (
                  <div className="history-view-group" key={group.dayKey}>
                    <div className="history-view-group-header">
                      {formatDayGroupHeader(group.date)}
                    </div>
                    {group.items.map((row) => (
                      <TrashRow
                        key={row.id}
                        row={row}
                        selected={selectedIds.includes(row.id)}
                        onClick={(ev) => toggleSelection(row.id, ev)}
                      />
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Drag handle */}
        {!showTimelineRail && !showPreviewRail && (
          <div
            className="history-view-resize-handle"
            onMouseDown={onResizeMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panes"
          />
        )}

        {/* Preview column / rail */}
        {showPreviewRail ? (
          <button
            type="button"
            className="history-view-rail history-view-rail--right"
            onClick={expandPreview}
            aria-label="Expand preview"
          >
            <span className="history-view-rail-icon">«</span>
          </button>
        ) : (
          <div className="history-view-preview">
            <div className="history-view-pane-header">
              <span className="history-view-pane-title">Preview</span>
              <button
                type="button"
                className="history-view-pane-collapse"
                onClick={collapsePreview}
                disabled={timelineEff}
                aria-label="Collapse preview"
                title="Collapse preview"
              >
                »
              </button>
            </div>
            <div className="history-view-preview-body">
              {selCount === 0 ? (
                <div className="history-view-empty">
                  Select a deleted file to preview.
                </div>
              ) : selCount > 1 ? (
                <div className="history-view-empty">
                  {selCount} files selected
                </div>
              ) : (
                <pre className="history-view-full">{previewContent}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="history-view-footer">
        <span className="history-view-footer-spacer" aria-hidden="true" />
        {selCount > 0 && (
          <>
            <button
              type="button"
              className="history-view-footer-btn history-view-footer-btn--primary"
              onClick={handleRestoreSelected}
            >
              Restore selected ({selCount})
            </button>
            <button
              type="button"
              className="history-view-footer-btn trash-view-footer-btn--danger"
              onClick={handleDeleteSelected}
            >
              Delete selected permanently ({selCount})…
            </button>
          </>
        )}
        <button
          type="button"
          className="history-view-footer-btn trash-view-footer-btn--danger"
          onClick={handleEmptyTrash}
          disabled={!hasEntries}
        >
          Empty trash…
        </button>
      </div>

      <ConfirmDialog
        open={confirmDialogProps !== null}
        title={confirmDialogProps?.title ?? ""}
        message={confirmDialogProps?.message ?? ""}
        confirmLabel={confirmDialogProps?.confirmLabel ?? "Delete"}
        cancelLabel="Cancel"
        danger
        onConfirm={confirmPending}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

interface TrashRowProps {
  row: TrashRow;
  selected: boolean;
  onClick: (ev: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) => void;
}

function TrashRow({ row, selected, onClick }: TrashRowProps) {
  const date = new Date(row.deletedAtMs);
  const isoTitle = date.toISOString();
  const expiry = formatTrashExpiry(row.expiresAtMs);
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`history-view-row trash-view-row${
        selected ? " history-view-row--selected" : ""
      }`}
      onClick={(e) =>
        onClick({
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
        })
      }
      title={`${row.absolutePath} · deleted ${isoTitle}`}
    >
      <div className="history-view-row-line1 trash-view-row-line1">
        <span className="trash-view-row-icon" aria-hidden="true">
          <FileIcon />
        </span>
        <span className="trash-view-row-name">{row.fileBasename}</span>
        <span className="history-view-row-time">{formatRowTime(date)}</span>
      </div>
      <div className="history-view-row-line2 trash-view-row-line2">
        <span className="trash-view-row-expiry">{expiry}</span>
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 2h6L13 5.5V14h-9.5z" />
      <path d="M9.5 2v3.5H13" />
    </svg>
  );
}
