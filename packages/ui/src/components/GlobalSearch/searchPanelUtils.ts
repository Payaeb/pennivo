import type { SearchFileResult, SearchResultLine } from "@pennivo/core";

// Pure helpers for the global-search panel. Kept out of the component module so
// the component file only exports components (Fast Refresh boundary) and so the
// path-join + flatten logic is unit-testable in isolation.

// ── Path join (workspace-relative POSIX → absolute) ──
//
// Results carry a workspace-relative POSIX path (e.g. "notes/todo.md"). To open
// one we join it onto the active workspace root. The root may use either slash
// style (Windows backslashes or POSIX forward slashes), so we detect the
// separator from the root and emit a path in that same style.
export function joinWorkspacePath(rootPath: string, relPath: string): string {
  const sep = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  const trimmedRoot = rootPath.replace(/[\\/]+$/, "");
  const cleanedRel = relPath.replace(/^[\\/]+/, "");
  const native =
    sep === "\\"
      ? cleanedRel.replace(/\//g, "\\")
      : cleanedRel.replace(/\\/g, "/");
  return `${trimmedRoot}${sep}${native}`;
}

// ── Flattened navigation model ──
//
// The grouped (file → lines) results are flattened into a single list of
// "result" rows so Arrow Up/Down can move a single selection across files. File
// header rows are NOT selectable; selection only ever lands on a result line.
export interface FlatResultItem {
  fileIndex: number;
  lineIndex: number;
  file: SearchFileResult;
  result: SearchResultLine;
}

export function flattenResults(files: SearchFileResult[]): FlatResultItem[] {
  const items: FlatResultItem[] = [];
  files.forEach((file, fileIndex) => {
    file.lines.forEach((result, lineIndex) => {
      items.push({ fileIndex, lineIndex, file, result });
    });
  });
  return items;
}
