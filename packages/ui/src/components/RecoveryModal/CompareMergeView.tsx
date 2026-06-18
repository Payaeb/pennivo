import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import {
  computeMergeSegments,
  applyMergeResolutions,
  formatRowTime,
  type MergeChoice,
  type MergeSegment,
  type Snapshot,
  type SnapshotAuthor,
} from "@pennivo/core";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";
import { getPlatform } from "../../platform";
import "./CompareMergeView.css";

/**
 * `CompareMergeView` — the Compare & merge body inside the recovery modal.
 *
 * A single CSS-Grid scroll container holds both panes side by side. Each
 * hunk's per-side line rows render as paired grid cells; immediately below
 * them, a full-width action row spans both columns, holding the per-hunk
 * `Take left / Take right / Both / Edit…` chips. Hunks are numbered (1-
 * based) so a content marker on each side stays visually associated with
 * its action row even when scrolled.
 *
 * Footer counter (`12 hunks · 8 resolved · 4 remaining`) and Save buttons
 * (Save as new file… / Replace current file…) gate on full resolution.
 *
 * Esc handling lives in the modal shell (when `onBack` is set, first Esc
 * = back to History; second Esc = close everything).
 */

/** A snapshot ID or the sentinel `'current'` (= live on-disk content). */
export type CompareMergeSide = string | "current";

export interface CompareMergeSelection {
  left: CompareMergeSide;
  right: CompareMergeSide;
}

interface CompareMergeViewProps {
  /** Absolute path of the file being compared. */
  filePath: string;
  /** Filename for the modal title (no path). */
  filename: string;
  /** Snapshot IDs (or `'current'`) the user picked in History. */
  selection: CompareMergeSelection;
  /**
   * Live on-disk content — used when `selection.right === 'current'` (or
   * `left === 'current'`, theoretically) so the modal doesn't have to re-
   * read the file.
   */
  currentContent: string;
  /** Surface a transient toast. Same toast surface the rest of the app uses. */
  onShowToast?: (message: string, isError?: boolean) => void;
  /** Open a path in the editor — used after Save as new file. */
  onOpenFilePath: (filePath: string) => void;
  /**
   * Close the modal entirely. Called after a successful save (or when the
   * user confirms discard for an in-progress merge close attempt).
   */
  onClose: () => void;
  /**
   * Back-out to the History view. Called from the back button + first Esc
   * (the modal shell wires Esc — this prop lets the body trigger the same
   * exit).
   */
  onBack: () => void;
  /**
   * Re-open the modal at the parent's current `filePath` after Replace
   * current file — the editor's loaded content is now stale.
   */
  onAfterReplace?: () => void;
  /**
   * Optional ref slot the body uses to publish its guarded close handler so
   * the modal shell's × / overlay can route through the discard-confirm.
   * The body writes its current `guardedClose` into `ref.current` whenever
   * progress state changes, and clears it on unmount. The shell's
   * `onCloseRequest` (in `App.tsx`) reads this ref to decide whether to
   * intercept or fall through to a plain close.
   */
  closeGuardRef?: MutableRefObject<(() => void) | null>;
}

/** Lightweight view of a snapshot's identity, used in the pane header chip. */
interface SideMeta {
  ts: number;
  author?: SnapshotAuthor;
  agentName?: string;
  deviceName?: string;
  isCurrent: boolean;
}

export function CompareMergeView({
  filePath,
  filename,
  selection,
  currentContent,
  onShowToast,
  onOpenFilePath,
  onClose,
  onBack,
  onAfterReplace,
  closeGuardRef,
}: CompareMergeViewProps) {
  const platform = getPlatform();

  const [leftContent, setLeftContent] = useState<string | null>(null);
  const [rightContent, setRightContent] = useState<string | null>(null);
  const [leftMeta, setLeftMeta] = useState<SideMeta | null>(null);
  const [rightMeta, setRightMeta] = useState<SideMeta | null>(null);
  const [resolutions, setResolutions] = useState<Record<number, MergeChoice>>(
    {},
  );
  const [editingHunk, setEditingHunk] = useState<number | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [pendingReplace, setPendingReplace] = useState(false);
  const [pendingDiscard, setPendingDiscard] = useState(false);

  // ----- Load snapshot content + meta for both sides -----

  useEffect(() => {
    let cancelled = false;
    setLeftContent(null);
    setRightContent(null);
    setLeftMeta(null);
    setRightMeta(null);
    setResolutions({});

    async function loadSide(
      side: CompareMergeSide,
    ): Promise<{ content: string; meta: SideMeta }> {
      if (side === "current") {
        // Stat the file via fs would require IPC; we use the live
        // `currentContent` prop and stamp `ts: Date.now()` so the header
        // shows a live "current" marker. Author / device omitted.
        return {
          content: currentContent,
          meta: { ts: Date.now(), isCurrent: true },
        };
      }
      const res = await platform.snapshot.read(filePath, side);
      if (!res) throw new Error(`snapshot read failed for ${side}`);
      const meta = res.meta as Snapshot;
      return {
        content: res.content,
        meta: {
          ts: meta?.ts ?? 0,
          author: meta?.author,
          agentName: meta?.agentName,
          deviceName: meta?.deviceName,
          isCurrent: false,
        },
      };
    }

    Promise.all([loadSide(selection.left), loadSide(selection.right)])
      .then(([l, r]) => {
        if (cancelled) return;
        setLeftContent(l.content);
        setLeftMeta(l.meta);
        setRightContent(r.content);
        setRightMeta(r.meta);
      })
      .catch(() => {
        if (cancelled) return;
        onShowToast?.("Failed to load snapshots for compare.", true);
        // Backstop: leave content empty so the empty state renders.
        setLeftContent("");
        setRightContent("");
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, selection, currentContent, platform, onShowToast]);

  // ----- Compute merge segments -----

  const segments: MergeSegment[] | null = useMemo(() => {
    if (leftContent === null || rightContent === null) return null;
    return computeMergeSegments(leftContent, rightContent);
  }, [leftContent, rightContent]);

  const totalHunks = useMemo(() => {
    if (!segments) return 0;
    let n = 0;
    for (const s of segments) if (s.kind === "hunk") n++;
    return n;
  }, [segments]);

  const resolvedCount = useMemo(() => {
    let n = 0;
    if (!segments) return 0;
    for (const s of segments) {
      if (s.kind === "hunk" && resolutions[s.hunk.index] !== undefined) n++;
    }
    return n;
  }, [segments, resolutions]);

  const remainingCount = totalHunks - resolvedCount;
  const allResolved = totalHunks > 0 && remainingCount === 0;

  // ----- Resolution handlers -----

  const setChoice = useCallback((idx: number, choice: MergeChoice) => {
    setResolutions((prev) => ({ ...prev, [idx]: choice }));
  }, []);

  const startEdit = useCallback(
    (idx: number, hunk: { leftLines: string[]; rightLines: string[] }) => {
      const existing = resolutions[idx];
      const seed =
        existing && typeof existing === "object" && existing.kind === "edit"
          ? existing.text
          : [...hunk.leftLines, ...hunk.rightLines].join("\n");
      setEditingHunk(idx);
      setEditingText(seed);
    },
    [resolutions],
  );

  const confirmEdit = useCallback(() => {
    if (editingHunk === null) return;
    setChoice(editingHunk, { kind: "edit", text: editingText });
    setEditingHunk(null);
    setEditingText("");
  }, [editingHunk, editingText, setChoice]);

  const cancelEdit = useCallback(() => {
    setEditingHunk(null);
    setEditingText("");
  }, []);

  // ----- Save handlers -----

  const performSave = useCallback(
    async (mode: "overwrite" | "as-new-file") => {
      if (!segments || !allResolved) return;
      const merged = applyMergeResolutions(segments, resolutions);
      try {
        const res = await platform.snapshot.saveMerged({
          filePath,
          content: merged,
          mode,
          left: typeof selection.left === "string" ? selection.left : null,
          right: typeof selection.right === "string" ? selection.right : null,
        });
        if (!res || !res.savedPath) {
          onShowToast?.("Save failed.", true);
          return;
        }
        if (mode === "overwrite") {
          onShowToast?.("Merged version saved.");
          onAfterReplace?.();
        } else {
          onShowToast?.("Merged version saved as a new file.");
          onOpenFilePath(res.savedPath);
        }
        onClose();
      } catch {
        onShowToast?.("Save failed.", true);
      }
    },
    [
      segments,
      allResolved,
      resolutions,
      platform,
      filePath,
      selection,
      onShowToast,
      onAfterReplace,
      onOpenFilePath,
      onClose,
    ],
  );

  const handleReplace = useCallback(() => {
    if (!allResolved) return;
    setPendingReplace(true);
  }, [allResolved]);
  const confirmReplace = useCallback(async () => {
    setPendingReplace(false);
    await performSave("overwrite");
  }, [performSave]);
  const handleSaveAsNew = useCallback(async () => {
    if (!allResolved) return;
    await performSave("as-new-file");
  }, [allResolved, performSave]);

  // Close-with-unresolved guard: when there's progress, intercept the shell's
  // × / overlay-click with a discard confirm. The body publishes its current
  // guarded handler into `closeGuardRef` so `App.tsx` can route the modal
  // shell's `onCloseRequest` through it. When there's no progress (or
  // everything is resolved), the ref still publishes a handler that calls
  // `onClose` directly — the shell's × closes immediately, same as today.
  const hasProgress = resolvedCount > 0 && !allResolved;
  const guardedClose = useCallback(() => {
    if (hasProgress) setPendingDiscard(true);
    else onClose();
  }, [hasProgress, onClose]);

  useEffect(() => {
    if (!closeGuardRef) return;
    closeGuardRef.current = guardedClose;
    return () => {
      closeGuardRef.current = null;
    };
  }, [closeGuardRef, guardedClose]);

  // ----- Render -----

  const isLoading = leftContent === null || rightContent === null;

  if (isLoading) {
    return (
      <div className="compare-merge-view">
        <div className="compare-merge-loading">Loading snapshots…</div>
      </div>
    );
  }

  if (!segments || segments.length === 0) {
    return (
      <div className="compare-merge-view">
        <div className="compare-merge-empty">
          <span className="compare-merge-empty-title">
            These versions are identical.
          </span>
          <span className="compare-merge-empty-sub">
            Pick two different snapshots from History to compare.
          </span>
          <button
            type="button"
            className="compare-merge-footer-btn"
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  if (totalHunks === 0) {
    return (
      <div className="compare-merge-view">
        <div className="compare-merge-empty">
          <span className="compare-merge-empty-title">
            These versions are identical.
          </span>
          <button
            type="button"
            className="compare-merge-footer-btn"
            onClick={onBack}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="compare-merge-view">
      <div className="compare-merge-scroll">
        <div className="compare-merge-grid">
          <div className="compare-merge-pane-header compare-merge-pane-header--left">
            <SideHeaderChip side="left" meta={leftMeta} />
          </div>
          <div className="compare-merge-pane-header compare-merge-pane-header--right">
            <SideHeaderChip side="right" meta={rightMeta} />
          </div>

          {renderGridRows(
            segments,
            resolutions,
            editingHunk,
            editingText,
            setEditingText,
            confirmEdit,
            cancelEdit,
            setChoice,
            startEdit,
          )}
        </div>
      </div>

      <div className="compare-merge-footer">
        <span
          className="compare-merge-counter"
          aria-live="polite"
          data-testid="compare-merge-counter"
        >
          {totalHunks} hunk{totalHunks === 1 ? "" : "s"} · {resolvedCount}{" "}
          resolved · {remainingCount} remaining
        </span>
        <span className="compare-merge-footer-spacer" aria-hidden="true">
          {filename}
        </span>
        <button
          type="button"
          className="compare-merge-footer-btn"
          disabled={!allResolved}
          onClick={handleSaveAsNew}
        >
          Save as new file…
        </button>
        <button
          type="button"
          className="compare-merge-footer-btn compare-merge-footer-btn--primary"
          disabled={!allResolved}
          onClick={handleReplace}
        >
          Replace current file…
        </button>
      </div>

      <ConfirmDialog
        open={pendingReplace}
        title="Replace current file?"
        message={`Overwrite the current version of "${filename}"? A pre-restore snapshot will be taken so you can undo this.`}
        confirmLabel="Replace"
        cancelLabel="Cancel"
        onConfirm={confirmReplace}
        onCancel={() => setPendingReplace(false)}
      />
      <ConfirmDialog
        open={pendingDiscard}
        title="Discard merge progress?"
        message="Resolved hunks won't be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setPendingDiscard(false);
          onClose();
        }}
        onCancel={() => setPendingDiscard(false)}
      />
    </div>
  );
}

// ───────────────────────────── helpers ─────────────────────────────

interface SideHeaderChipProps {
  side: "left" | "right";
  meta: SideMeta | null;
}

function SideHeaderChip({ meta }: SideHeaderChipProps) {
  if (!meta) return <span className="compare-merge-side-chip">…</span>;
  if (meta.isCurrent) {
    return (
      <span className="compare-merge-side-chip compare-merge-side-chip--current">
        current file
      </span>
    );
  }
  const time = formatRowTime(new Date(meta.ts));
  const author = meta.author;
  let attribution = "";
  if (author === "user") {
    attribution = `you · ${meta.deviceName ?? ""}`.trim();
  } else if (author === "external") {
    attribution = "external";
  } else if (author === "mcp") {
    attribution = meta.agentName ? `${meta.agentName} (MCP)` : "Claude (MCP)";
  } else if (author === "inline-ai") {
    attribution = meta.agentName
      ? `${meta.agentName} (inline AI)`
      : "Inline AI";
  } else if (author === "sync") {
    attribution = "synced from another device";
  }
  return (
    <span
      className={`compare-merge-side-chip compare-merge-side-chip--${author ?? "neutral"}`}
    >
      <span className="compare-merge-side-chip-time">{time}</span>
      {attribution && (
        <>
          <span className="compare-merge-side-chip-sep">·</span>
          <span className="compare-merge-side-chip-attribution">
            {attribution}
          </span>
        </>
      )}
    </span>
  );
}

interface ChoiceChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

function ChoiceChip({ label, active, onClick }: ChoiceChipProps) {
  return (
    <button
      type="button"
      className={`compare-merge-chip${active ? " compare-merge-chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

/**
 * Emit grid rows for the merge view.
 *
 * For each segment:
 * - Context lines emit one paired row per line (same text on both sides).
 * - Hunks emit:
 *     1) a tiny `── Hunk N ──` caption row (one cell per side, faint)
 *     2) one paired row per pairCount, with phantom padding for the
 *        shorter side so the two columns stay vertically aligned within
 *        the hunk
 *     3) a full-width action row (`grid-column: 1 / -1`) holding the
 *        per-hunk chips (or the inline edit textarea when editing).
 *
 * Each line cell carries `data-hunk-index` (when belonging to a hunk) so
 * tests / future scroll-to-hunk logic can target it.
 */
function renderGridRows(
  segments: MergeSegment[],
  resolutions: Record<number, MergeChoice>,
  editingHunk: number | null,
  editingText: string,
  setEditingText: (v: string) => void,
  confirmEdit: () => void,
  cancelEdit: () => void,
  setChoice: (idx: number, choice: MergeChoice) => void,
  startEdit: (
    idx: number,
    hunk: { leftLines: string[]; rightLines: string[] },
  ) => void,
): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  let key = 0;

  for (const seg of segments) {
    if (seg.kind === "context") {
      for (const line of seg.lines) {
        rows.push(
          <div
            className="compare-merge-line compare-merge-line--context compare-merge-cell--left"
            key={key++}
          >
            <span className="compare-merge-line-text">{line || " "}</span>
          </div>,
        );
        rows.push(
          <div
            className="compare-merge-line compare-merge-line--context compare-merge-cell--right"
            key={key++}
          >
            <span className="compare-merge-line-text">{line || " "}</span>
          </div>,
        );
      }
      continue;
    }

    // Hunk: render the per-side caption, the paired diff lines, then the
    // full-width action row.
    const { leftLines, rightLines, index } = seg.hunk;
    const hunkLabel = `Hunk ${index + 1}`;
    const choice = resolutions[index];
    const isResolvedAsLeft = choice === "left";
    const isResolvedAsRight = choice === "right";
    const isResolvedAsBoth = choice === "both";
    const isEdited = typeof choice === "object" && choice?.kind === "edit";
    const leftDimmed = isResolvedAsRight;
    const rightDimmed = isResolvedAsLeft;

    // Caption row — a faint inline marker on each side so the user can
    // visually trace from a hunk's content up to its action row.
    rows.push(
      <div
        className="compare-merge-hunk-caption compare-merge-cell--left"
        key={key++}
        data-hunk-index={index}
      >
        <span className="compare-merge-hunk-caption-text">
          ── {hunkLabel} ──
        </span>
      </div>,
    );
    rows.push(
      <div
        className="compare-merge-hunk-caption compare-merge-cell--right"
        key={key++}
        data-hunk-index={index}
      >
        <span className="compare-merge-hunk-caption-text">
          ── {hunkLabel} ──
        </span>
      </div>,
    );

    // Paired diff lines.
    const pairCount = Math.max(leftLines.length, rightLines.length);
    for (let i = 0; i < pairCount; i++) {
      const leftLine = i < leftLines.length ? leftLines[i] : null;
      const rightLine = i < rightLines.length ? rightLines[i] : null;

      // Left cell.
      let leftCls = "compare-merge-line compare-merge-cell--left";
      if (leftLine !== null) leftCls += " compare-merge-line--remove";
      else if (rightLine !== null) leftCls += " compare-merge-line--phantom";
      if (leftDimmed) leftCls += " compare-merge-line--dimmed";
      if (isEdited) leftCls += " compare-merge-line--edited";
      if (isResolvedAsBoth) leftCls += " compare-merge-line--both";

      // Right cell.
      let rightCls = "compare-merge-line compare-merge-cell--right";
      if (rightLine !== null) rightCls += " compare-merge-line--add";
      else if (leftLine !== null) rightCls += " compare-merge-line--phantom";
      if (rightDimmed) rightCls += " compare-merge-line--dimmed";
      if (isEdited) rightCls += " compare-merge-line--edited";
      if (isResolvedAsBoth) rightCls += " compare-merge-line--both";

      rows.push(
        <div className={leftCls} key={key++} data-hunk-index={index}>
          <span className="compare-merge-line-text">
            {leftLine === null ? " " : leftLine || " "}
          </span>
        </div>,
      );
      rows.push(
        <div className={rightCls} key={key++} data-hunk-index={index}>
          <span className="compare-merge-line-text">
            {rightLine === null ? " " : rightLine || " "}
          </span>
        </div>,
      );
    }

    // Full-width action row immediately below the hunk's content.
    const isEditing = editingHunk === index;
    rows.push(
      <div
        className="compare-merge-action-row"
        key={key++}
        data-hunk-index={index}
      >
        <span className="compare-merge-action-label">{hunkLabel}</span>
        {isEditing ? (
          <div className="compare-merge-edit-box">
            <textarea
              className="compare-merge-edit-textarea"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              rows={Math.min(
                Math.max(leftLines.length + rightLines.length, 3),
                8,
              )}
              aria-label={`Edit hunk ${index + 1}`}
            />
            <div className="compare-merge-edit-actions">
              <button
                type="button"
                className="compare-merge-chip compare-merge-chip--primary"
                onClick={confirmEdit}
              >
                Save edit
              </button>
              <button
                type="button"
                className="compare-merge-chip"
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="compare-merge-chips">
            <ChoiceChip
              active={choice === "left"}
              onClick={() => setChoice(index, "left")}
              label="Take left"
            />
            <ChoiceChip
              active={choice === "right"}
              onClick={() => setChoice(index, "right")}
              label="Take right"
            />
            <ChoiceChip
              active={choice === "both"}
              onClick={() => setChoice(index, "both")}
              label="Both"
            />
            <ChoiceChip
              active={typeof choice === "object" && choice?.kind === "edit"}
              onClick={() => startEdit(index, seg.hunk)}
              label="Edit…"
            />
          </div>
        )}
      </div>,
    );
  }

  return rows;
}
