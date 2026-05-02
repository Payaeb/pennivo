import type { FileTreeEntry } from "../platform";

export type SidebarSortKey =
  | "name-asc"
  | "name-desc"
  | "modified-desc"
  | "modified-asc"
  | "size-desc"
  | "size-asc"
  | "recent-desc";

export const DEFAULT_SORT: SidebarSortKey = "name-asc";

export const SORT_OPTIONS: { key: SidebarSortKey; label: string }[] = [
  { key: "name-asc", label: "Name (A → Z)" },
  { key: "name-desc", label: "Name (Z → A)" },
  { key: "modified-desc", label: "Modified (newest)" },
  { key: "modified-asc", label: "Modified (oldest)" },
  { key: "size-desc", label: "Size (largest)" },
  { key: "size-asc", label: "Size (smallest)" },
  { key: "recent-desc", label: "Recently opened" },
];

export function isSidebarSortKey(value: unknown): value is SidebarSortKey {
  return (
    typeof value === "string" && SORT_OPTIONS.some((opt) => opt.key === value)
  );
}

function compareName(a: FileTreeEntry, b: FileTreeEntry, dir: 1 | -1): number {
  return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function compareNumeric(
  a: number | undefined,
  b: number | undefined,
  dir: 1 | -1,
): number {
  // Treat missing metadata as 0; falls through to name tiebreak above
  const av = a ?? 0;
  const bv = b ?? 0;
  if (av === bv) return 0;
  return dir * (av - bv);
}

/**
 * Sort a file tree by the given key. Folders are always grouped first within
 * each branch (matches Finder/Explorer behavior). Folders sort by name only —
 * folder mtime/size are not meaningful across filesystems. Files sort by the
 * chosen criterion, falling back to name when values tie.
 *
 * Pure: returns a new tree, never mutates input.
 */
export function sortTree(
  entries: FileTreeEntry[],
  key: SidebarSortKey,
): FileTreeEntry[] {
  // Folders always alphabetical within their group; direction follows name sort
  // for name-* keys, otherwise ascending by name.
  const folderDir: 1 | -1 = key === "name-desc" ? -1 : 1;

  const folders: FileTreeEntry[] = [];
  const files: FileTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.type === "folder") folders.push(entry);
    else files.push(entry);
  }

  folders.sort((a, b) => compareName(a, b, folderDir));

  files.sort((a, b) => {
    let primary = 0;
    switch (key) {
      case "name-asc":
        primary = compareName(a, b, 1);
        break;
      case "name-desc":
        primary = compareName(a, b, -1);
        break;
      case "modified-desc":
        primary = compareNumeric(a.mtimeMs, b.mtimeMs, -1);
        break;
      case "modified-asc":
        primary = compareNumeric(a.mtimeMs, b.mtimeMs, 1);
        break;
      case "size-desc":
        primary = compareNumeric(a.size, b.size, -1);
        break;
      case "size-asc":
        primary = compareNumeric(a.size, b.size, 1);
        break;
      case "recent-desc":
        primary = compareNumeric(a.lastOpenedMs, b.lastOpenedMs, -1);
        break;
    }
    if (primary !== 0) return primary;
    return compareName(a, b, 1);
  });

  const sortedChildren = (entry: FileTreeEntry): FileTreeEntry =>
    entry.children
      ? { ...entry, children: sortTree(entry.children, key) }
      : entry;

  return [...folders.map(sortedChildren), ...files];
}
