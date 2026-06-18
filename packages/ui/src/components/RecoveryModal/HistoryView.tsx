import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  formatDayGroupHeader,
  formatRowTime,
  groupByLocalDay,
  type Snapshot,
  type SnapshotAuthor,
} from "@pennivo/core";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { LineDiff } from "./LineDiff";
import "./HistoryView.css";

/**
 * Snapshot row plus a few derived display bits the timeline needs but the
 * IPC payload doesn't directly carry. Computed once at load time so the
 * row renderer stays cheap.
 */
interface TimelineRow extends Snapshot {
  /** Number of added/removed lines vs the file's current on-disk content. */
  addedLines?: number;
  removedLines?: number;
}

interface HistoryViewProps {
  /** Absolute path of the file whose history we're showing. */
  filePath: string | null;
  /** Filename for the modal title (`History — chapter-3.md`). */
  filename: string | null;
  /** Current on-disk content — the diff baseline. */
  currentContent: string;
  /**
   * Open the file path in the editor. Used by `Restore as new file` after
   * the snapshot is materialized at a fresh path.
   */
  onOpenFilePath: (filePath: string) => void;
  /**
   * Surface a transient toast message (success / failure). Same toast
   * surface the rest of the app uses.
   */
  onShowToast?: (message: string, isError?: boolean) => void;
  /**
   * Persisted layout settings. Passed in so the modal stays a controlled
   * component — App.tsx owns the read/write to the recovery settings store.
   */
  timelineWidth: number;
  timelineCollapsed: boolean;
  previewCollapsed: boolean;
  onLayoutChange: (next: {
    timelineWidth?: number;
    timelineCollapsed?: boolean;
    previewCollapsed?: boolean;
  }) => void;
  /** Modal width, used to trigger sub-800px auto-collapse of the timeline. */
  modalWidth: number;
  /**
   * Switch the modal into compare-merge mode. Fired by the footer button
   * when exactly two snapshots are selected. Receives the two selected
   * snapshot IDs so App.tsx can hand them to `CompareMergeView`. The older
   * snapshot ends up as `left`; the newer (or "current" sentinel) as `right`.
   */
  onEnterCompareMerge?: (selection: { left: string; right: string }) => void;
}

/**
 * Min widths enforced by the drag handle. Below the timeline min the
 * collapse button is the better affordance; below the preview min the diff
 * stops being readable.
 */
const TIMELINE_MIN = 200;
const PREVIEW_MIN = 400;
const NARROW_MODAL_THRESHOLD = 800;

type PreviewTab = "diff" | "full";

/**
 * `HistoryView` — the History tab body. Two columns:
 *
 * - **Timeline** (left): day-grouped snapshot list with attribution chips,
 *   line-diff summary, and full-date headers.
 * - **Preview** (right): tabbed Diff / Full view of the selected snapshot.
 *
 * Multi-select state is wired (shift-click adds to selection) so the next
 * UI slice can light up Compare & merge without re-architecting.
 */
export function HistoryView({
  filePath,
  filename,
  currentContent,
  onOpenFilePath,
  onShowToast,
  timelineWidth,
  timelineCollapsed,
  previewCollapsed,
  onLayoutChange,
  modalWidth,
  onEnterCompareMerge,
}: HistoryViewProps) {
  const platform = (
    window as unknown as {
      pennivo?: never;
    }
  ).pennivo
    ? // Real Electron host — go through the bridge.
      // We import lazily via require-style to keep tests that don't stub
      // window.pennivo working.
      undefined
    : undefined;
  void platform;
  // We use the singleton platform helper to avoid duplicating the lookup
  // logic; importing here keeps the component decoupled from the App.
  const { getPlatform } = useGetPlatform();
  const p = getPlatform();

  const [snapshots, setSnapshots] = useState<TimelineRow[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewTab, setPreviewTab] = useState<PreviewTab>("diff");
  const [previewContent, setPreviewContent] = useState<string>("");
  const [pendingRestore, setPendingRestore] = useState<TimelineRow | null>(
    null,
  );
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  // Re-derive auto-collapse state every time modal width crosses the
  // threshold. Per design: auto-collapse is NOT persisted.
  useEffect(() => {
    setAutoCollapsed(modalWidth > 0 && modalWidth < NARROW_MODAL_THRESHOLD);
  }, [modalWidth]);

  // Load snapshots when the file path changes.
  useEffect(() => {
    let cancelled = false;
    if (!filePath) {
      setSnapshots(null);
      setSelectedIds([]);
      return;
    }
    setSnapshots(null);
    setSelectedIds([]);
    p.snapshot
      .list(filePath)
      .then((rows) => {
        if (cancelled) return;
        // Cast through the IPC-untyped boundary; the desktop store returns
        // SnapshotMetaFile[]-shaped objects.
        const list = rows as TimelineRow[];
        setSnapshots(list);
        // Auto-select the newest snapshot so the preview pane has something
        // useful to render the moment the modal opens.
        if (list.length > 0) setSelectedIds([list[0].id]);
      })
      .catch(() => {
        if (cancelled) return;
        setSnapshots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, p]);

  // Lazy-load the preview content for the most-recently-selected snapshot.
  const lastSelectedId =
    selectedIds.length > 0 ? selectedIds[selectedIds.length - 1] : null;
  useEffect(() => {
    let cancelled = false;
    if (!filePath || !lastSelectedId) {
      setPreviewContent("");
      return;
    }
    p.snapshot
      .read(filePath, lastSelectedId)
      .then((res) => {
        if (cancelled) return;
        const r = res as { content?: string } | null;
        setPreviewContent(r?.content ?? "");
      })
      .catch(() => {
        if (!cancelled) setPreviewContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, lastSelectedId, p]);

  // ----- Selection handlers -----

  const toggleSelection = useCallback(
    (
      id: string,
      ev: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    ) => {
      setSelectedIds((prev) => {
        const isShift = !!ev.shiftKey;
        const isToggle = !!(ev.ctrlKey || ev.metaKey);
        if (isShift && prev.length > 0) {
          // Range select from last-selected to clicked. Find both indices in
          // the current snapshot list.
          const list = snapshots ?? [];
          const lastId = prev[prev.length - 1];
          const lastIdx = list.findIndex((r) => r.id === lastId);
          const newIdx = list.findIndex((r) => r.id === id);
          if (lastIdx === -1 || newIdx === -1) return [id];
          const [from, to] =
            lastIdx <= newIdx ? [lastIdx, newIdx] : [newIdx, lastIdx];
          const range = list.slice(from, to + 1).map((r) => r.id);
          // Union with prev, but bring the clicked id to the end of the
          // selection list (so `lastSelectedId` is the clicked row).
          const set = new Set(prev);
          for (const rid of range) set.add(rid);
          set.delete(id);
          return [...set, id];
        }
        if (isToggle) {
          return prev.includes(id)
            ? prev.filter((x) => x !== id)
            : [...prev, id];
        }
        // Plain click: clear and select just this row.
        return [id];
      });
    },
    [snapshots],
  );

  // ----- Pane resize / collapse handlers -----

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
    // At least one column must remain expanded.
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

  const handleRestoreAsCurrent = useCallback(() => {
    if (selectedIds.length !== 1) return;
    const sel = (snapshots ?? []).find((r) => r.id === selectedIds[0]);
    if (sel) setPendingRestore(sel);
  }, [selectedIds, snapshots]);

  const confirmRestoreAsCurrent = useCallback(async () => {
    const sel = pendingRestore;
    if (!sel || !filePath) return;
    setPendingRestore(null);
    try {
      const res = await p.snapshot.restore(
        filePath,
        sel.id,
        "overwrite",
        filePath,
      );
      if (res) {
        onShowToast?.(
          `Restored snapshot from ${formatRowTime(new Date(sel.ts))}.`,
        );
        // Re-open the file so the editor picks up the restored content.
        onOpenFilePath(filePath);
      } else {
        onShowToast?.("Restore failed.", true);
      }
    } catch {
      onShowToast?.("Restore failed.", true);
    }
  }, [pendingRestore, filePath, p, onShowToast, onOpenFilePath]);

  const handleRestoreAsNewFile = useCallback(async () => {
    if (selectedIds.length !== 1 || !filePath) return;
    const sel = (snapshots ?? []).find((r) => r.id === selectedIds[0]);
    if (!sel) return;
    try {
      const res = await p.snapshot.restore(filePath, sel.id, "as-new-file");
      const newPath = (res as { newPath?: string } | null)?.newPath;
      if (newPath) {
        onShowToast?.("Snapshot restored as a new file.");
        onOpenFilePath(newPath);
      } else {
        onShowToast?.("Restore failed.", true);
      }
    } catch {
      onShowToast?.("Restore failed.", true);
    }
  }, [selectedIds, filePath, snapshots, p, onShowToast, onOpenFilePath]);

  const handleCopyToClipboard = useCallback(async () => {
    if (!previewContent) return;
    try {
      await navigator.clipboard.writeText(previewContent);
      onShowToast?.("Snapshot copied to clipboard.");
    } catch {
      onShowToast?.("Copy to clipboard failed.", true);
    }
  }, [previewContent, onShowToast]);

  // ----- Render: grouped timeline rows -----

  const groups = useMemo(() => {
    if (!snapshots) return [];
    return groupByLocalDay(snapshots);
  }, [snapshots]);

  // Effective collapsed states: timeline auto-collapses on narrow modals.
  const timelineEff = timelineCollapsed || autoCollapsed;
  const previewEff = previewCollapsed && !timelineEff;
  const showTimelineRail = timelineEff;
  const showPreviewRail = previewEff;

  const restoreEnabled =
    selectedIds.length === 1 && snapshots !== null && snapshots.length > 0;
  const compareEnabled = selectedIds.length === 2;
  const compareLabel = compareEnabled
    ? "Compare & merge…"
    : `Compare & merge — select 2 (${selectedIds.length})`;
  const compareTitle = compareEnabled
    ? undefined
    : "Select 2 snapshots to compare";

  const handleCompareMerge = useCallback(() => {
    if (!compareEnabled) return;
    // Order so the older snapshot is `left` and the newer is `right`. The
    // snapshots list is newest-first, so look up timestamps to order.
    const list = snapshots ?? [];
    const a = list.find((r) => r.id === selectedIds[0]);
    const b = list.find((r) => r.id === selectedIds[1]);
    if (!a || !b) return;
    const [older, newer] = a.ts <= b.ts ? [a, b] : [b, a];
    onEnterCompareMerge?.({ left: older.id, right: newer.id });
  }, [compareEnabled, onEnterCompareMerge, snapshots, selectedIds]);

  return (
    <div className="history-view" data-modal-width={modalWidth}>
      <div className="history-view-body">
        {/* Timeline column / rail */}
        {showTimelineRail ? (
          <button
            type="button"
            className="history-view-rail history-view-rail--left"
            onClick={expandTimeline}
            aria-label="Expand timeline"
            disabled={autoCollapsed && !timelineCollapsed && !previewCollapsed}
            title={
              autoCollapsed && !timelineCollapsed
                ? "Timeline auto-collapsed (modal narrow)"
                : "Expand timeline"
            }
          >
            <span className="history-view-rail-icon">»</span>
          </button>
        ) : (
          <div
            className="history-view-timeline"
            style={{ width: timelineWidth }}
          >
            <div className="history-view-pane-header">
              <span className="history-view-pane-title">Timeline</span>
              <button
                type="button"
                className="history-view-pane-collapse"
                onClick={collapseTimeline}
                disabled={previewEff}
                aria-label="Collapse timeline"
                title="Collapse timeline"
              >
                «
              </button>
            </div>
            <div className="history-view-timeline-list">
              {snapshots === null ? (
                <div className="history-view-empty">Loading…</div>
              ) : snapshots.length === 0 ? (
                <div className="history-view-empty">No history yet.</div>
              ) : (
                groups.map((group) => (
                  <div className="history-view-group" key={group.dayKey}>
                    <div className="history-view-group-header">
                      {formatDayGroupHeader(group.date)}
                    </div>
                    {group.items.map((row) => (
                      <SnapshotRow
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

        {/* Drag handle (only when both panes expanded) */}
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
              <div
                className="history-view-preview-tabs"
                role="tablist"
                aria-label="Preview"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewTab === "diff"}
                  className={`history-view-preview-tab${
                    previewTab === "diff"
                      ? " history-view-preview-tab--active"
                      : ""
                  }`}
                  onClick={() => setPreviewTab("diff")}
                >
                  Diff
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewTab === "full"}
                  className={`history-view-preview-tab${
                    previewTab === "full"
                      ? " history-view-preview-tab--active"
                      : ""
                  }`}
                  onClick={() => setPreviewTab("full")}
                >
                  Full
                </button>
              </div>
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
              {selectedIds.length === 0 ? (
                <div className="history-view-empty">
                  Select a snapshot from the timeline.
                </div>
              ) : previewTab === "diff" ? (
                <LineDiff
                  oldText={previewContent}
                  newText={currentContent}
                  ariaLabel="Snapshot diff"
                />
              ) : (
                <pre className="history-view-full">{previewContent}</pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="history-view-footer">
        <span className="history-view-footer-spacer" aria-hidden="true">
          {filename ? `History — ${filename}` : ""}
        </span>
        <button
          type="button"
          className="history-view-footer-btn history-view-footer-btn--primary"
          disabled={!restoreEnabled}
          onClick={handleRestoreAsCurrent}
        >
          Restore as current
        </button>
        <button
          type="button"
          className="history-view-footer-btn"
          disabled={!restoreEnabled}
          onClick={handleRestoreAsNewFile}
        >
          Restore as new file
        </button>
        <button
          type="button"
          className="history-view-footer-btn"
          disabled={!previewContent}
          onClick={handleCopyToClipboard}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          className="history-view-footer-btn"
          disabled={!compareEnabled}
          title={compareTitle}
          onClick={handleCompareMerge}
        >
          {compareLabel}
        </button>
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restore snapshot?"
        message={
          pendingRestore && filename
            ? `Overwrite the current version of "${filename}"? A pre-restore snapshot will be taken so you can undo this.`
            : "Overwrite the current version? A pre-restore snapshot will be taken so you can undo this."
        }
        confirmLabel="Restore"
        cancelLabel="Cancel"
        onConfirm={confirmRestoreAsCurrent}
        onCancel={() => setPendingRestore(null)}
      />
    </div>
  );
}

// ───────────────────────────── helpers ─────────────────────────────

interface SnapshotRowProps {
  row: TimelineRow;
  selected: boolean;
  onClick: (ev: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
  }) => void;
}

function SnapshotRow({ row, selected, onClick }: SnapshotRowProps) {
  const date = new Date(row.ts);
  const isoTitle = date.toISOString();
  const sizeLabel = formatBytes(row.sizeBytes);
  return (
    <div
      role="option"
      aria-selected={selected}
      className={`history-view-row${selected ? " history-view-row--selected" : ""}`}
      onClick={(e) =>
        onClick({
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
        })
      }
      title={isoTitle}
    >
      <div className="history-view-row-line1">
        <span className="history-view-row-time">{formatRowTime(date)}</span>
        <span className="history-view-row-size">{sizeLabel}</span>
      </div>
      <div className="history-view-row-line2">
        <AttributionChip
          author={row.author}
          deviceName={row.deviceName ?? row.deviceId.slice(0, 8)}
          agentName={row.agentName}
        />
      </div>
    </div>
  );
}

interface AttributionChipProps {
  author: SnapshotAuthor;
  deviceName: string;
  agentName?: string;
}

function AttributionChip({
  author,
  deviceName,
  agentName,
}: AttributionChipProps) {
  let label: string;
  let cls = "attribution-chip";
  switch (author) {
    case "user":
      label = `you · ${deviceName}`;
      cls += " attribution-chip--user";
      break;
    case "mcp":
      label = agentName ? `${agentName} (MCP)` : "Claude (MCP)";
      cls += " attribution-chip--ai";
      break;
    case "inline-ai":
      label = agentName ? `${agentName} (inline AI)` : "Inline AI";
      cls += " attribution-chip--ai";
      break;
    case "external":
      label = "external";
      cls += " attribution-chip--external";
      break;
    case "sync":
      label = "synced from another device";
      cls += " attribution-chip--sync";
      break;
    default:
      label = String(author);
  }
  return (
    <span className={cls}>
      {author === "external" && (
        <span className="attribution-chip-glyph" aria-hidden="true">
          ⚠
        </span>
      )}
      {label}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ───────── platform shim ─────────
//
// HistoryView needs the singleton platform helper, but importing it
// directly creates a cycle in the test harness because `getPlatform()`
// reads from the test-injected webPlatform on first call. We wrap it in a
// lazy getter so component tests can stub the platform via the test-utils
// the rest of the codebase already uses.

import { getPlatform } from "../../platform";

function useGetPlatform() {
  return useMemo(() => ({ getPlatform }), []);
}
