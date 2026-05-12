// Trash entry directory naming.
//
// The trash dir name is `<sha1(normalizedAbsolutePath)>-<deletedAtMs>`. The
// sha1 piece is the same path-hash the snapshot module uses (so we don't
// invent a second hashing scheme); the timestamp suffix lets the same file
// be deleted, restored, edited, deleted again without colliding.

import { normalizeAbsolutePath } from "../snapshots/path";
import { sha1Hex } from "../snapshots/sha1";

/**
 * Build the directory name for a soft-deleted file. Pure, deterministic across
 * OSes. Same `absolutePath + deletedAtMs` always produces the same name.
 */
export function trashEntryDirName(
  absolutePath: string,
  deletedAtMs: number,
): string {
  const normalized = normalizeAbsolutePath(absolutePath);
  const hash = sha1Hex(normalized);
  return `${hash}-${deletedAtMs}`;
}
