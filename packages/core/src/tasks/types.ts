// Type definitions for the pure cross-file Tasks feature. Lives in core so it
// can be unit-tested without fs/IPC/DOM. No React, DOM, Electron, or
// node:path.
//
// v1 scope: only GFM checklist lines (`- [ ]` / `- [x]`) become TaskItems.
// Label/due indexing of plain (non-checklist) list items is a later phase.

/** One GFM checklist item discovered by extractTaskItems. */
export interface TaskItem {
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
  /** True for `[x]`/`[X]`, false for `[ ]`. */
  checked: boolean;
  /**
   * The item text after the checkbox marker, verbatim (still contains any
   * `#label` tokens and the raw `[due:: ...]` field, if present).
   */
  rawText: string;
  /**
   * `rawText` with the `[due:: ...]` token(s) removed and whitespace
   * collapsed/trimmed. Labels stay in `displayText`.
   */
  displayText: string;
  /** Inline `#tag` labels, deduped, without the leading `#`, in order of first appearance. */
  labels: string[];
  /** ISO `YYYY-MM-DD` date exactly as written, or null when absent/invalid. */
  due: string | null;
  /** Nesting depth indicator: count of leading indentation characters. Cheap; no full tree needed. */
  indent: number;
}

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
 * One inline task-metadata token found by scanMetaTokens: a `#tag` label or
 * a valid `[due:: YYYY-MM-DD]` field. `start`/`end` are char offsets into
 * the scanned string, covering the token's full text (for `label`, the `#`
 * plus the tag name; for `due`, the whole `[due:: ...]` bracket). `value` is
 * the tag name (no `#`) for a label, or the validated ISO date string for a
 * due field. `datePart` is present only on `due` tokens.
 */
export interface MetaToken {
  kind: "label" | "due";
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
