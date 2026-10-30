/**
 * Workspace-relative, forward-slash path of `filePath` under `rootPath`, or
 * null when the file is not inside the workspace (or either input is
 * missing). Separators are normalized first so Windows (backslash)
 * and POSIX inputs both work; the comparison is otherwise a plain
 * prefix check on a path-segment boundary: case-insensitive when both paths
 * start with a Windows drive letter, case-sensitive for POSIX paths.
 */
export function toWorkspaceRelativePath(
  filePath: string | null | undefined,
  rootPath: string | null | undefined,
): string | null {
  if (!filePath || !rootPath) return null;
  const file = filePath.replace(/\\/g, "/");
  const root = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root.length) return null;
  const windows = /^[a-zA-Z]:\//.test(file) && /^[a-zA-Z]:\//.test(root);
  const prefix = file.slice(0, root.length + 1);
  const wanted = `${root}/`;
  const inside = windows
    ? prefix.toLowerCase() === wanted.toLowerCase()
    : prefix === wanted;
  if (!inside) return null;
  const rel = file.slice(root.length + 1).replace(/^\/+/, "");
  return rel.length > 0 ? rel : null;
}

export function normalizeItemPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}
