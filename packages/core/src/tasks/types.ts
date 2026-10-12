// Type definitions for the pure cross-file Tasks feature. Lives in core so it
// can be unit-tested without fs/IPC/DOM. No React, DOM, Electron, or
// node:path.
//
// v1 scope: GFM checklist lines (`- [ ]` / `- [x]`) become TaskItems (see
// extractTaskItems). Phase 18c+ also indexes plain (non-checklist) list
// items that carry a label, as LabeledItem (see extractLabeled.ts) — the two
// extractors are kept separate (never double-extracting a checklist line)
// and composed together only in the UI layer's Labels view.

/**
 * Fields every located list item shares, whether it's a GFM checklist item
 * (TaskItem) or a plain labeled bullet/ordered item (LabeledItem). Factored
 * out so the two extractors can never drift on what a "located list item"
 * looks like.
 */
export interface ListItemLocation {
  /** Workspace-relative path of the file the item was found in. */
  path: string;
  /** 0-based line number within the file. */
  line: number;
  /**
   * Absolute char offset of the line's start in the file. Same coordinate
   * convention as the search feature's `fileOffset` (see search/types.ts),
   * so the UI can reuse one jump-to-match code path for both features.
   */
  charOffset: number;
  /**
   * The item text after the list marker (and, for a checklist item, the
   * checkbox), verbatim — still contains any `#label` tokens and the raw
   * `[due:: ...]` / `[done:: ...]` fields, if present.
   */
  rawText: string;
  /**
   * `rawText` with the `[due:: ...]` and `[done:: ...]` token(s) removed and
   * whitespace collapsed/trimmed. Labels stay in `displayText`.
   */
  displayText: string;
  /** Inline `#tag` labels, deduped, without the leading `#`, in order of first appearance. */
  labels: string[];
  /** ISO `YYYY-MM-DD` date exactly as written, or null when absent/invalid. */
  due: string | null;
  /** Nesting depth indicator: count of leading indentation characters. Cheap; no full tree needed. */
  indent: number;
}

/** One GFM checklist item discovered by extractTaskItems. */
export interface TaskItem extends ListItemLocation {
  /** True for `[x]`/`[X]`, false for `[ ]`. */
  checked: boolean;
  /**
   * ISO `YYYY-MM-DD` from a `[done:: ...]` field, or null when absent/
   * invalid. Written by the editor's checkbox-toggle handler ONLY when the
   * "Record completion dates" setting is on, and only ever removed by the
   * same handler on un-check — extractTaskItems just reads whatever is on
   * disk. Independent of `checked` at the data layer: a checked item with
   * `done === null` is valid (the setting was off, or was turned on after
   * the item was already checked).
   */
  done: string | null;
}

/**
 * One non-checklist (plain bullet/ordered) list item discovered by
 * extractLabeledItems. Always carries at least one label — items with no
 * label are not indexed, since the Labels view has nothing to group them
 * under. Same location/text fields as TaskItem, minus the checklist-only
 * `checked`/`done` state (a plain bullet has no check state to track).
 */
export type LabeledItem = ListItemLocation;

/** Index over a set of TaskItems, grouped for cheap lookup. */
export interface TaskIndex {
  all: TaskItem[];
  byLabel: Map<string, TaskItem[]>;
  /** Items with a due date, sorted by due ascending then path/line ascending. */
  dated: TaskItem[];
}

/** Agenda bucket name. */
export type AgendaBucketKey =
  | "overdue"
  | "today"
  | "tomorrow"
  | "thisWeek"
  | "later"
  | "noDate";

/**
 * A char range, relative to whatever string was scanned, of just the date
 * digits within a `due` MetaToken (excluding the `[due::`/`]` syntax and any
 * inner whitespace).
 */
export interface MetaTokenDatePart {
  start: number;
  end: number;
}

/**
 * One inline task-metadata token found by scanMetaTokens: a `#tag` label, a
 * valid `[due:: YYYY-MM-DD]` field, or a valid `[done:: YYYY-MM-DD]` field.
 * `start`/`end` are char offsets into the scanned string, covering the
 * token's full text (for `label`, the `#` plus the tag name; for `due`/
 * `done`, the whole bracket field — including a leading backslash when the
 * field was escaped as `\[due:: ...]` by the markdown serializer). `value`
 * is the tag name (no `#`) for a label, or the validated ISO date string for
 * a due/done field. `datePart` is present only on `due`/`done` tokens.
 */
export interface MetaToken {
  kind: "label" | "due" | "done";
  start: number;
  end: number;
  value: string;
  datePart?: MetaTokenDatePart;
}

/** Deterministic bucket order for the UI to iterate. */
export const AGENDA_BUCKET_ORDER: AgendaBucketKey[] = [
  "overdue",
  "today",
  "tomorrow",
  "thisWeek",
  "later",
  "noDate",
];

/**
 * Agenda buckets produced by groupTasksByAgenda. Every bucket below holds
 * unchecked items only; checked items never enter the agenda and are instead
 * summed into `completed` so the panel can show an "N done" count.
 */
export interface AgendaBuckets {
  /** due < today. */
  overdue: TaskItem[];
  /** due === today. */
  today: TaskItem[];
  /** due === today + 1. */
  tomorrow: TaskItem[];
  /** today + 2 .. today + 6. */
  thisWeek: TaskItem[];
  /** due >= today + 7. */
  later: TaskItem[];
  /** due === null. */
  noDate: TaskItem[];
  /** Count of checked items, excluded from every bucket above. */
  completed: number;
}
