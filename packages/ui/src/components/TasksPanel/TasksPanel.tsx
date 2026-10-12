import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
} from "react";
import type {
  AgendaBucketKey,
  AgendaBuckets,
  TaskItem,
  LabeledItem,
} from "@pennivo/core";
import {
  AGENDA_BUCKET_ORDER,
  groupTasksByAgenda,
  scanMetaTokens,
} from "@pennivo/core";
import { joinWorkspacePath } from "../GlobalSearch/searchPanelUtils";
import type { GlobalSearchJumpTarget } from "../GlobalSearch/GlobalSearchPanel";
import "./TasksPanel.css";

/** Either extraction result the panel can render a row for. Both share every
 *  location/text field (path/line/charOffset/displayText/labels/due) — only
 *  TaskItem carries `checked`/`done`, which is how a row tells the two
 *  apart (see `isTaskItem` below) without a dedicated discriminant field in
 *  core (kept out of core per the design doc: the UI composes the two
 *  extractors' output, core never double-extracts). */
type AnyListItem = TaskItem | LabeledItem;

function isTaskItem(item: AnyListItem): item is TaskItem {
  return "checked" in item;
}

/** One row in the Labels view's flattened navigation list. The SAME item
 *  can produce multiple rows (once per label it carries), so the row key is
 *  group-scoped (`label:path:line`), unlike Tasks mode's `path:line` (an
 *  item appears in exactly one agenda bucket there). */
interface LabelsFlatRow {
  key: string;
  item: AnyListItem;
}

interface LabelGroup {
  label: string;
  rows: LabelsFlatRow[];
}

export interface TasksPanelProps {
  /**
   * Active workspace root (absolute). Used to convert a task's
   * workspace-relative path into an absolute path before opening — same
   * convention as GlobalSearchPanel's `rootPath`.
   */
  rootPath: string | null;
  /**
   * Load every GFM checklist item AND every labeled plain bullet/ordered
   * item across the active workspace. The host wires this to
   * `platform.getWorkspaceTasks` so the panel stays presentational (no
   * platform import) — mirrors GlobalSearchPanel's `onSearch`.
   */
  onLoad: () => Promise<{ items: TaskItem[]; labeledItems: LabeledItem[] }>;
  /**
   * Open a task's file and jump to its line. Receives the absolute path plus
   * a jump target in GlobalSearchPanel's exact `{ line, fileOffset, query }`
   * shape, so the host can pass its existing search-result jump handler
   * straight through (the same pending-jump/rAF-poll infra, unchanged).
   */
  onOpenTask: (absPath: string, target: GlobalSearchJumpTarget) => void;
  /** Close tasks and return the rail to tree mode (Escape with no active filter). */
  onClose: () => void;
  /**
   * Local date (YYYY-MM-DD) to group the agenda against. Computed by the host
   * at open time (`new Date()` is fine there) so the panel itself never calls
   * Date.now() — keeps bucket boundaries deterministic and unit-testable.
   */
  todayIso: string;
  /**
   * Bumped by the host (e.g. after the editor's own save completes while the
   * panel is open) to trigger a reload without the panel reaching for
   * Date.now()/timers itself. Mount already triggers one load; changing this
   * value triggers another. Omitting it just means no external refresh
   * trigger — the manual refresh button and the mount-time load still work.
   */
  reloadSignal?: number;
}

const DEBOUNCE_MS = 200;

const BUCKET_LABELS: Record<AgendaBucketKey, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  thisWeek: "This Week",
  later: "Later",
  noDate: "No date",
};

/**
 * `TaskItem.displayText`/`LabeledItem.displayText` deliberately keep
 * `#label` tokens (core's own doc comment: "Labels stay in displayText") —
 * the extractors only strip the `[due:: ...]`/`[done:: ...]` fields. The row
 * already renders each label as its own chip below the text, so showing it
 * a second time inline would duplicate it. Scan with scanMetaTokens (the
 * same tokenizer the WYSIWYG chip renderer and both extractors use, so this
 * can never disagree with them on what counts as a label) and excise every
 * `label`-kind token's range, then collapse the whitespace left behind —
 * never an ad-hoc regex, so `#2026`-style all-digit non-tags and tags
 * inside code spans (already absent from displayText / never present to
 * begin with) can't be mishandled differently here than anywhere else.
 */
function stripLabelTokensForDisplay(text: string): string {
  const labelTokens = scanMetaTokens(text).filter((t) => t.kind === "label");
  if (labelTokens.length === 0) return text;

  let result = "";
  let cursor = 0;
  for (const token of labelTokens) {
    result += text.slice(cursor, token.start);
    cursor = token.end;
  }
  result += text.slice(cursor);

  return result.replace(/\s+/g, " ").trim();
}

type PanelMode = "tasks" | "labels";

export function TasksPanel({
  rootPath,
  onLoad,
  onOpenTask,
  onClose,
  todayIso,
  reloadSignal,
}: TasksPanelProps) {
  const [mode, setMode] = useState<PanelMode>("tasks");
  const [items, setItems] = useState<TaskItem[]>([]);
  const [labeledItems, setLabeledItems] = useState<LabeledItem[]>([]);
  // True once a load has actually resolved, so the empty state can distinguish
  // "still loading" from "loaded, genuinely nothing to show".
  const [loaded, setLoaded] = useState(false);
  const [textFilter, setTextFilter] = useState("");
  const [debouncedTextFilter, setDebouncedTextFilter] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
  // Mirrors GlobalSearchPanel's own keyboard-nav model, with one
  // deliberate difference: GlobalSearchPanel only ever shows rows after
  // the user has typed a query (an action), so pre-selecting its first
  // result on arrival is a reasonable "jump to top hit" affordance. This
  // panel populates itself on mount with zero user interaction, so
  // starting from `null` (nothing selected) and only entering the list on
  // an explicit ArrowDown/ArrowUp avoids highlighting a row the user never
  // asked about.
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Monotonic request id, same last-write-wins pattern as GlobalSearchPanel:
  // a manual refresh click racing the mount-time load (or a reloadSignal
  // bump) can never have the older response clobber the newer one.
  const requestIdRef = useRef(0);

  // Focus the filter input on mount (the rail just swapped to tasks mode).
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const load = useCallback(() => {
    const id = ++requestIdRef.current;
    void onLoad().then((res) => {
      if (id !== requestIdRef.current) return; // stale response; dropped
      setItems(res.items);
      setLabeledItems(res.labeledItems);
      setLoaded(true);
    });
  }, [onLoad]);

  // Load on mount (panel just opened) and whenever the host bumps
  // reloadSignal (e.g. after its own save completes while the panel stays
  // open). One effect covers both so mounting never double-fetches.
  useEffect(() => {
    load();
    // `load` intentionally excluded: it only changes identity when `onLoad`
    // does, which is not a reason to reload on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // Debounce the free-text filter (matches GlobalSearchPanel's DEBOUNCE_MS).
  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedTextFilter(textFilter),
      DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [textFilter]);

  const textQuery = debouncedTextFilter.trim().toLowerCase();
  const matchesText = useCallback(
    (item: AnyListItem) =>
      !textQuery || item.displayText.toLowerCase().includes(textQuery),
    [textQuery],
  );

  // Label chip row: enumerated from every loaded OPEN item (the panel's scope
  // is "all open checklist items workspace-wide" per the locked design),
  // independent of the current text/label filters so the facet row stays
  // stable as the user narrows down rather than shrinking out from under them.
  // Tasks-mode only — Labels mode groups by label directly, so this facet
  // row would be redundant there (and is hidden in that mode, see render).
  const labelOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.checked) continue;
      for (const label of item.labels) {
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));
  }, [items]);

  const hasActiveFilter =
    debouncedTextFilter.trim().length > 0 || selectedLabels.size > 0;

  // --- Tasks mode: agenda buckets (unchanged behavior) ---

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (!matchesText(item)) return false;
      if (
        selectedLabels.size > 0 &&
        !item.labels.some((l) => selectedLabels.has(l))
      ) {
        return false;
      }
      return true;
    });
  }, [items, matchesText, selectedLabels]);

  // groupTasksByAgenda does its own checked/unchecked split (buckets hold
  // unchecked items only; `completed` counts the checked ones), so filtering
  // first and grouping once gives both the agenda AND the "N done" count
  // scoped to the current filter with no separate pre-filter step.
  const buckets: AgendaBuckets = useMemo(
    () => groupTasksByAgenda(filteredItems, todayIso),
    [filteredItems, todayIso],
  );

  const visibleBucketKeys = useMemo(
    () => AGENDA_BUCKET_ORDER.filter((k) => buckets[k].length > 0),
    [buckets],
  );

  // Flattened navigation model in render order, mirroring GlobalSearchPanel's
  // flattened result list — Arrow Up/Down moves a single selection across
  // bucket boundaries. Keys are `path:line`, safe to be globally unique here
  // because groupTasksByAgenda partitions each item into exactly one bucket.
  const tasksFlatRows = useMemo<LabelsFlatRow[]>(
    () =>
      visibleBucketKeys.flatMap((k) =>
        buckets[k].map((item) => ({
          key: `${item.path}:${item.line}`,
          item,
        })),
      ),
    [visibleBucketKeys, buckets],
  );

  // --- Labels mode: group by label, text-filter only (the label-chip row
  // is Tasks-mode-only — grouping already covers that narrowing) ---

  const labelGroups = useMemo<LabelGroup[]>(() => {
    const byLabel = new Map<string, LabelsFlatRow[]>();

    function addRow(label: string, item: AnyListItem) {
      const row: LabelsFlatRow = {
        key: `${label}:${item.path}:${item.line}`,
        item,
      };
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(row);
      else byLabel.set(label, [row]);
    }

    for (const item of items) {
      if (!matchesText(item)) continue;
      for (const label of item.labels) addRow(label, item);
    }
    for (const item of labeledItems) {
      if (!matchesText(item)) continue;
      for (const label of item.labels) addRow(label, item);
    }

    const comparePathLine = (a: LabelsFlatRow, b: LabelsFlatRow) => {
      if (a.item.path !== b.item.path) {
        return a.item.path < b.item.path ? -1 : 1;
      }
      return a.item.line - b.item.line;
    };

    return Array.from(byLabel.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, rows]) => ({
        label,
        rows: rows.slice().sort(comparePathLine),
      }));
  }, [items, labeledItems, matchesText]);

  const labelsFlatRows = useMemo<LabelsFlatRow[]>(
    () => labelGroups.flatMap((g) => g.rows),
    [labelGroups],
  );

  // The row list actually driving keyboard nav / selection / empty-state —
  // whichever mode is active. Both Tasks and Labels builds already landed
  // on the same `{ key, item }` shape above specifically so this one spot
  // can stay mode-agnostic.
  const activeFlatRows = mode === "tasks" ? tasksFlatRows : labelsFlatRows;

  // Clamp the selection when the filtered set shrinks. A `null` selection
  // (nothing chosen yet) is left alone — there's nothing to clamp.
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= activeFlatRows.length) {
      setSelectedIndex(Math.max(0, activeFlatRows.length - 1));
    }
  }, [activeFlatRows.length, selectedIndex]);

  // Mode switch: a selection from one mode's row list doesn't necessarily
  // mean anything in the other's (different grouping, different row keys) —
  // start fresh rather than risk indexing into a wrong list.
  useEffect(() => {
    setSelectedIndex(null);
  }, [mode]);

  // Scroll the selected row into view as it moves.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(
      `[data-task-index="${selectedIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const openItem = useCallback(
    (item: AnyListItem | undefined) => {
      if (!item || !rootPath) return;
      const absPath = joinWorkspacePath(rootPath, item.path);
      onOpenTask(absPath, {
        // GlobalSearchJumpTarget.line is 1-based; TaskItem/LabeledItem.line is 0-based.
        line: item.line + 1,
        fileOffset: item.charOffset,
        query: item.displayText,
      });
    },
    [rootPath, onOpenTask],
  );

  const toggleLabel = useCallback((label: string) => {
    setSelectedLabels((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            i === null ? 0 : Math.min(i + 1, activeFlatRows.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            i === null ? activeFlatRows.length - 1 : Math.max(i - 1, 0),
          );
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex !== null) {
            openItem(activeFlatRows[selectedIndex]?.item);
          }
          break;
        case "Escape":
          e.preventDefault();
          // First Escape clears any active filter; a second (already clear)
          // closes — mirrors GlobalSearchPanel's clear-then-close convention.
          // The label-chip selection is Tasks-mode-only state, so in Labels
          // mode only the text filter counts as "active".
          if (
            debouncedTextFilter.trim().length > 0 ||
            textFilter.length > 0 ||
            (mode === "tasks" && selectedLabels.size > 0)
          ) {
            setTextFilter("");
            setSelectedLabels(new Set());
          } else {
            onClose();
          }
          break;
      }
    },
    [
      activeFlatRows,
      selectedIndex,
      openItem,
      debouncedTextFilter,
      textFilter,
      selectedLabels,
      mode,
      onClose,
    ],
  );

  // Map each flat row to its global index for selection + data attrs.
  const indexByKey = useMemo(() => {
    const map = new Map<string, number>();
    activeFlatRows.forEach((row, idx) => {
      map.set(row.key, idx);
    });
    return map;
  }, [activeFlatRows]);

  const showEmpty = activeFlatRows.length === 0;

  return (
    <div
      className="tasks-panel"
      role="region"
      aria-label="Tasks"
      onKeyDown={handleKeyDown}
    >
      <div
        className="tasks-panel-mode-tabs"
        role="tablist"
        aria-label="Tasks panel view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "tasks"}
          className={`tasks-panel-mode-tab${mode === "tasks" ? " tasks-panel-mode-tab--active" : ""}`}
          onClick={() => setMode("tasks")}
        >
          Tasks
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "labels"}
          className={`tasks-panel-mode-tab${mode === "labels" ? " tasks-panel-mode-tab--active" : ""}`}
          onClick={() => setMode("labels")}
        >
          Labels
        </button>
      </div>

      <div className="tasks-panel-input-row">
        <ChecklistIcon className="tasks-panel-icon" width={14} height={14} />
        <input
          ref={inputRef}
          className="tasks-panel-input"
          type="text"
          placeholder={
            mode === "tasks" ? "Filter tasks..." : "Filter labeled items..."
          }
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-label="Filter tasks"
        />
        <button
          type="button"
          className="tasks-panel-refresh-btn"
          onClick={load}
          title="Refresh tasks"
          aria-label="Refresh tasks"
        >
          <RefreshIcon />
        </button>
      </div>

      {mode === "tasks" && labelOptions.length > 0 && (
        <div
          className="tasks-panel-label-row"
          role="group"
          aria-label="Filter by label"
        >
          <button
            type="button"
            className={`tasks-panel-label-chip${selectedLabels.size === 0 ? " tasks-panel-label-chip--active" : ""}`}
            onClick={() => setSelectedLabels(new Set())}
          >
            All
          </button>
          {labelOptions.map(({ label, count }) => (
            <button
              key={label}
              type="button"
              className={`tasks-panel-label-chip${selectedLabels.has(label) ? " tasks-panel-label-chip--active" : ""}`}
              onClick={() => toggleLabel(label)}
              aria-pressed={selectedLabels.has(label)}
            >
              #{label}
              <span className="tasks-panel-label-chip-count">{count}</span>
            </button>
          ))}
        </div>
      )}

      {loaded && mode === "tasks" && (
        <div className="tasks-panel-summary" aria-live="polite">
          {tasksFlatRows.length} open · {buckets.completed} done
        </div>
      )}
      {loaded && mode === "labels" && (
        <div className="tasks-panel-summary" aria-live="polite">
          {labelsFlatRows.length} item{labelsFlatRows.length === 1 ? "" : "s"} ·{" "}
          {labelGroups.length} label{labelGroups.length === 1 ? "" : "s"}
        </div>
      )}

      <div className="tasks-panel-results" ref={listRef} role="listbox">
        {showEmpty ? (
          <div className="tasks-panel-empty">
            <ChecklistIcon
              className="tasks-panel-empty-icon"
              width={28}
              height={28}
              aria-hidden="true"
            />
            {!loaded ? (
              <p className="tasks-panel-empty-title">Loading tasks…</p>
            ) : mode === "tasks" ? (
              hasActiveFilter ? (
                <>
                  <p className="tasks-panel-empty-title">No matching tasks</p>
                  <p className="tasks-panel-empty-hint">
                    Try a different filter or label.
                  </p>
                </>
              ) : (
                <>
                  <p className="tasks-panel-empty-title">No open tasks</p>
                  <p className="tasks-panel-empty-hint">
                    Checklist items across your workspace will show up here.
                  </p>
                </>
              )
            ) : debouncedTextFilter.trim().length > 0 ? (
              <>
                <p className="tasks-panel-empty-title">
                  No matching labeled items
                </p>
                <p className="tasks-panel-empty-hint">
                  Try a different filter.
                </p>
              </>
            ) : (
              <>
                <p className="tasks-panel-empty-title">No labeled items</p>
                <p className="tasks-panel-empty-hint">
                  Bullets and tasks carrying a #label will show up here, grouped
                  by label.
                </p>
              </>
            )}
          </div>
        ) : mode === "tasks" ? (
          visibleBucketKeys.map((bucketKey) => (
            <Fragment key={bucketKey}>
              <div
                className={`tasks-panel-section-header${bucketKey === "overdue" ? " tasks-panel-section-header--overdue" : ""}`}
              >
                <span className="tasks-panel-section-title">
                  {BUCKET_LABELS[bucketKey]}
                </span>
                <span className="tasks-panel-section-count">
                  {buckets[bucketKey].length}
                </span>
              </div>
              {buckets[bucketKey].map((item) => {
                const key = `${item.path}:${item.line}`;
                const idx = indexByKey.get(key) ?? -1;
                const selected = idx === selectedIndex;
                return (
                  <TaskRow
                    key={key}
                    item={item}
                    idx={idx}
                    selected={selected}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => openItem(item)}
                  />
                );
              })}
            </Fragment>
          ))
        ) : (
          labelGroups.map((group) => (
            <Fragment key={group.label}>
              <div className="tasks-panel-label-group-header">
                <span className="tasks-panel-chip tasks-panel-chip--label">
                  #{group.label}
                </span>
                <span className="tasks-panel-section-count">
                  {group.rows.length}
                </span>
              </div>
              {group.rows.map((row) => {
                const idx = indexByKey.get(row.key) ?? -1;
                const selected = idx === selectedIndex;
                return (
                  <TaskRow
                    key={row.key}
                    item={row.item}
                    idx={idx}
                    selected={selected}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => openItem(row.item)}
                  />
                );
              })}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

/** One row — shared between Tasks mode (always a TaskItem) and Labels mode
 *  (a TaskItem OR a LabeledItem). The glyph is the only thing that depends
 *  on which: a dot for a plain labeled bullet, a checkbox (reflecting its
 *  checked state) for a task. */
function TaskRow({
  item,
  idx,
  selected,
  onMouseEnter,
  onClick,
}: {
  item: AnyListItem;
  idx: number;
  selected: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  const task = isTaskItem(item);
  const doneDate = task ? item.done : null;
  return (
    <button
      type="button"
      data-task-index={idx}
      className={`tasks-panel-item${selected ? " tasks-panel-item--selected" : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      tabIndex={-1}
      role="option"
      aria-selected={selected}
    >
      <span className="tasks-panel-item-checkbox" aria-hidden="true">
        {task ? (
          <TaskCheckboxGlyph checked={item.checked} />
        ) : (
          <BulletDotGlyph />
        )}
      </span>
      <span className="tasks-panel-item-body">
        <span className="tasks-panel-item-text">
          {stripLabelTokensForDisplay(item.displayText)}
        </span>
        {(item.labels.length > 0 || item.due || doneDate) && (
          <span className="tasks-panel-item-meta">
            {item.labels.map((label) => (
              <span
                key={label}
                className="tasks-panel-chip tasks-panel-chip--label"
              >
                #{label}
              </span>
            ))}
            {item.due && (
              <span className="tasks-panel-chip tasks-panel-chip--due">
                {item.due}
              </span>
            )}
            {doneDate && (
              <span className="tasks-panel-chip tasks-panel-chip--done">
                done {doneDate}
              </span>
            )}
          </span>
        )}
        <span className="tasks-panel-item-path" title={item.path}>
          {item.path}
        </span>
      </span>
    </button>
  );
}

// Checklist glyph, shared between the header input row and the empty state —
// mirrors MagnifierIcon's sizing-prop convention in GlobalSearchPanel.tsx.
function ChecklistIcon({
  className,
  width = 14,
  height = 14,
  "aria-hidden": ariaHidden,
}: {
  className?: string;
  width?: number;
  height?: number;
  "aria-hidden"?: boolean | "true" | "false";
}) {
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden}
    >
      <rect x="2" y="2.5" width="3.4" height="3.4" rx="0.8" />
      <polyline points="2.8,4.2 3.5,4.9 4.7,3.5" strokeWidth="1.1" />
      <path d="M7.4 4.2h6.1" />
      <rect x="2" y="9.1" width="3.4" height="3.4" rx="0.8" />
      <path d="M7.4 10.8h6.1" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M13 4.5A5.5 5.5 0 104.2 6.8" />
      <polyline points="13,1.8 13,5 9.8,5" />
      <path d="M3 11.5A5.5 5.5 0 0011.8 9.2" />
      <polyline points="3,14.2 3,11 6.2,11" />
    </svg>
  );
}

// Decorative, read-only checkbox glyph for a task row. In Tasks mode every
// item that reaches this render path is unchecked by construction
// (groupTasksByAgenda routes checked items only into `completed`, never
// into a bucket), but Labels mode shows checked AND unchecked tasks side by
// side, so this needs to actually reflect `checked` there. Not interactive
// in v1 per the locked design (clicking a row jumps to the item; it does
// not toggle it).
function TaskCheckboxGlyph({ checked = false }: { checked?: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill={checked ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      {checked && (
        <polyline
          points="4.3,8.3 6.8,10.8 11.7,5.3"
          fill="none"
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

// Decorative glyph for a plain (non-checklist) labeled bullet/ordered item
// in the Labels view — a filled dot, distinguishing it at a glance from a
// task row's checkbox glyph.
function BulletDotGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" fill="currentColor" />
    </svg>
  );
}
