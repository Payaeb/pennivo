// Filesystem reads for the read tools and resources. Mirrors the shape of the
// desktop's `readDirectoryTree` (skip hidden + node_modules, markdown-only,
// folders-first sort) so an agent sees the same workspace the editor's sidebar
// shows. All returned `path` fields are workspace-relative (via the caller's
// `toWorkspaceRelative`); this module takes `root` to do that conversion.

import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { toWorkspaceRelative } from "./pathSafety.js";

export const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

/** Hard cap on a single `read_file` to avoid handing an agent a huge buffer. */
export const MAX_READ_BYTES = 5 * 1024 * 1024;

export interface FileNode {
  name: string;
  /** Workspace-relative path (forward slashes). */
  path: string;
  type: "file" | "folder";
  children?: FileNode[];
  size?: number;
  mtimeMs?: number;
}

function isMarkdown(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function shouldSkip(name: string): boolean {
  return name.startsWith(".") || name === "node_modules";
}

function sortFoldersFirst(
  a: { name: string; isDirectory(): boolean },
  b: { name: string; isDirectory(): boolean },
): number {
  if (a.isDirectory() && !b.isDirectory()) return -1;
  if (!a.isDirectory() && b.isDirectory()) return 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * List the markdown tree under `absDir`. When `recursive`, prunes folders that
 * contain no markdown anywhere beneath them (matches the editor sidebar). When
 * not recursive, lists immediate files + immediate folders one level deep.
 */
export async function readDirTree(
  absDir: string,
  recursive: boolean,
  root: string,
): Promise<FileNode[]> {
  const out: FileNode[] = [];
  let items: Dirent[];
  try {
    items = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return out;
  }

  items.sort(sortFoldersFirst);

  for (const item of items) {
    if (shouldSkip(item.name)) continue;
    const abs = path.join(absDir, item.name);

    if (item.isDirectory()) {
      if (recursive) {
        const children = await readDirTree(abs, true, root);
        if (children.length > 0) {
          out.push({
            name: item.name,
            path: toWorkspaceRelative(root, abs),
            type: "folder",
            children,
          });
        }
      } else {
        out.push({
          name: item.name,
          path: toWorkspaceRelative(root, abs),
          type: "folder",
        });
      }
    } else if (isMarkdown(item.name)) {
      let size: number | undefined;
      let mtimeMs: number | undefined;
      try {
        const stat = await fs.stat(abs);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        // stat failure is non-fatal — still list the file.
      }
      out.push({
        name: item.name,
        path: toWorkspaceRelative(root, abs),
        type: "file",
        size,
        mtimeMs,
      });
    }
  }

  return out;
}

/** Yield absolute paths of every markdown file under `absDir`, recursively. */
export async function* walkMarkdown(absDir: string): AsyncGenerator<string> {
  let items: Dirent[];
  try {
    items = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (shouldSkip(item.name)) continue;
    const abs = path.join(absDir, item.name);
    if (item.isDirectory()) {
      yield* walkMarkdown(abs);
    } else if (isMarkdown(item.name)) {
      yield abs;
    }
  }
}

/** Count markdown files under `absDir`. */
export async function countMarkdown(absDir: string): Promise<number> {
  let n = 0;
  for await (const _ of walkMarkdown(absDir)) {
    void _;
    n++;
  }
  return n;
}

/** Read a markdown file as UTF-8, rejecting oversize files. */
export async function readFileText(abs: string): Promise<string> {
  const stat = await fs.stat(abs);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(
      `File is too large to read (${stat.size} bytes; limit ${MAX_READ_BYTES}).`,
    );
  }
  return fs.readFile(abs, "utf-8");
}

export { isMarkdown };
