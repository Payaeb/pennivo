// Pure index builder over a set of already-extracted TaskItems. No fs/IPC/DOM.

import type { TaskIndex, TaskItem } from "./types";

/** String-compare two paths the same way search's ranking does (path ASC). */
function comparePath(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Build a TaskIndex over `items`: a label lookup (insertion order per label
 * preserved from `items`) and a due-date-sorted list. Never throws.
 */
export function buildTaskIndex(items: TaskItem[]): TaskIndex {
  const byLabel = new Map<string, TaskItem[]>();
  for (const item of items) {
    for (const label of item.labels) {
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(item);
      else byLabel.set(label, [item]);
    }
  }

  const dated = items
    .filter((item): item is TaskItem & { due: string } => item.due !== null)
    .slice()
    .sort((a, b) => {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
      const pathCompare = comparePath(a.path, b.path);
      if (pathCompare !== 0) return pathCompare;
      return a.line - b.line;
    });

  return { all: items, byLabel, dated };
}
