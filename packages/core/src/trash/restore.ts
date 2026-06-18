// Pick a target path for restoring a trashed file.
//
// Pure: the caller is responsible for actually checking whether `originalPath`
// is taken on disk (we can't `fs.access` from `core/`). We accept that fact
// as a boolean and return a path string the caller should write to.
//
// Collision strategy:
//   - No collision → return `originalPath` unchanged.
//   - Collision     → insert ` (restored)` before the extension. If THAT also
//                     collides, append a counter: ` (restored 2)`, ` (restored 3)`.
//
// The caller passes a `pathExistsOnDisk` predicate so we can keep walking the
// counter without re-issuing fs calls outside this function. (The first call
// is via the `existingPathOnDisk` flag for the original path; subsequent
// counter checks defer to the predicate.)

export interface PickRestorePathOptions {
  /** Function the caller supplies to check if a candidate path is taken. */
  pathExistsOnDisk: (path: string) => boolean;
}

/**
 * Decide the path a trashed file should be restored to.
 *
 * Single-arg form (used in tests + by the design doc) tests only the original
 * path's collision via `existingPathOnDisk`. For deeper counter walks the
 * caller should use the options form.
 */
export function pickRestorePath(
  originalPath: string,
  existingPathOnDisk: boolean,
  options?: PickRestorePathOptions,
): string {
  if (!existingPathOnDisk) return originalPath;

  // Split into dir / stem / extension preserving everything before the LAST
  // dot as the stem. Files without an extension keep an empty `.ext`. We do
  // this with regex rather than depending on `path.parse` so this stays
  // framework-free.
  const lastSlash = Math.max(
    originalPath.lastIndexOf("/"),
    originalPath.lastIndexOf("\\"),
  );
  const dir = lastSlash >= 0 ? originalPath.slice(0, lastSlash + 1) : "";
  const fileName =
    lastSlash >= 0 ? originalPath.slice(lastSlash + 1) : originalPath;
  const dotIdx = fileName.lastIndexOf(".");
  const stem = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx) : "";

  // First candidate: `<stem> (restored)<ext>`
  const firstCandidate = `${dir}${stem} (restored)${ext}`;
  const exists = options?.pathExistsOnDisk;
  if (!exists) return firstCandidate;

  if (!exists(firstCandidate)) return firstCandidate;

  // Walk the counter: ` (restored 2)`, ` (restored 3)`, … up to a sane cap.
  // The cap is defensive — in practice users never hit double digits.
  for (let n = 2; n <= 1000; n++) {
    const candidate = `${dir}${stem} (restored ${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  // Fallback: append the timestamp so we never return a colliding path.
  return `${dir}${stem} (restored ${Date.now()})${ext}`;
}
