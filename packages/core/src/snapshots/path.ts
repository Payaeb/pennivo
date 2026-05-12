// Content-addressed path generation for snapshots.
//
// We don't return joined paths — joining is host-specific (Node `path.join`
// vs a browser-side virtual fs vs a future cloud-key namespace). The caller
// composes `dir` + `fileBasename(ts)` with whatever separator suits its
// destination.

import { sha1Hex } from "./sha1";

/**
 * Normalize an absolute path before hashing so the same logical path on
 * Windows and POSIX produces the same content-addressed directory name.
 *
 * Steps:
 * 1. Replace backslashes with forward slashes.
 * 2. Lowercase any leading drive-letter (`C:` -> `c:`) — Windows treats
 *    drive letters case-insensitively, so we shouldn't punish a user who
 *    typed `c:\foo` once and `C:\foo` later.
 * 3. Collapse repeated slashes (`//` -> `/`).
 * 4. Strip a trailing slash (unless the path is just `/`).
 *
 * We deliberately do NOT lowercase the rest of the path. POSIX paths are
 * case-sensitive; Windows paths beyond the drive letter are case-preserving
 * but case-insensitive — the trade-off either way breaks something. Keeping
 * the user's casing matches "open the same file twice, get the same
 * snapshot directory" for the overwhelmingly common case.
 */
export function normalizeAbsolutePath(absolutePath: string): string {
  let p = absolutePath.replace(/\\/g, "/");
  if (/^[A-Za-z]:/.test(p)) {
    p = p[0]!.toLowerCase() + p.slice(1);
  }
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

/**
 * Build a cross-OS-safe basename for a snapshot file given its capture
 * timestamp. ISO-8601 with `:` and `.` replaced by `-` so Windows accepts
 * the filename. Always 24 chars + extension.
 *
 * Examples:
 *   ts = 0                     -> "1970-01-01T00-00-00-000Z.md"
 *   ts = 1714941022123         -> "2024-05-05T18-30-22-123Z.md"
 */
export function snapshotFileBasename(ts: number, extension = "md"): string {
  const iso = new Date(ts).toISOString();
  const safe = iso.replace(/:/g, "-").replace(/\./g, "-");
  return `${safe}.${extension}`;
}

export interface SnapshotPathSegments {
  /** sha1(normalizedAbsolutePath); 40-char lowercase hex. */
  dir: string;
  /** Build the per-snapshot filename from a capture timestamp. */
  fileBasename: (ts: number, extension?: string) => string;
}

/**
 * Returns the content-addressed directory and a basename builder for
 * snapshots of `absolutePath`. Pure: same input always yields the same
 * directory hash on every OS.
 */
export function snapshotPathSegments(
  absolutePath: string,
): SnapshotPathSegments {
  const normalized = normalizeAbsolutePath(absolutePath);
  const dir = sha1Hex(normalized);
  return {
    dir,
    fileBasename: (ts, extension) => snapshotFileBasename(ts, extension),
  };
}
