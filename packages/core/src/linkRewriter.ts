// Pure planner for rewriting relative markdown links and image refs when a
// file or folder is moved/renamed inside a workspace. Lives in core so it can
// be unit-tested without fs/IPC. The desktop main process turns the returned
// updates into real writeFile operations after it has applied the move on
// disk.
//
// The whole computation is purely string + path math: given every .md file in
// the workspace (pre-move) plus the move itself, it produces the new content
// for any file whose links need to change. No fs, DOM, Electron, or node:path.

import { decodeImageUrlSpaces, encodeImageUrlSpaces } from "./assetNormalizer";
import {
  REF_DEF_RE,
  INLINE_URL_RE,
  dirname,
  joinPosix,
  relativeFromDir,
  isRelativeLink,
  splitFragment,
} from "./linkSyntax";

/** A single markdown file in the workspace. */
export interface WorkspaceFile {
  /** POSIX path relative to the workspace root, e.g. "notes/todo.md". */
  path: string;
  content: string;
}

export interface LinkMoveInput {
  /**
   * ALL .md files in the workspace BEFORE the move. Paths are POSIX and
   * relative to the workspace root.
   */
  files: WorkspaceFile[];
  /** Moved file or folder, relative to workspace root, POSIX, pre-move. */
  oldPath: string;
  /** Post-move relative path. */
  newPath: string;
  /** True when oldPath/newPath denote a folder (directory) move. */
  isDirectory: boolean;
}

export interface LinkRewriteResult {
  /**
   * One entry per file whose content actually changed. `path` is the file's
   * path AFTER the move has been applied on disk: a moved file reports its NEW
   * path, an unmoved referrer reports its unchanged path.
   */
  updates: { path: string; newContent: string }[];
  changed: boolean;
  /** Set when the move is illegal (folder moved into itself or a descendant). */
  error?: "self-into-descendant" | string;
}

// The link-syntax regexes (REF_DEF_RE, INLINE_URL_RE), the POSIX path helpers
// (dirname, joinPosix, relativeFromDir, and their internal segments /
// normalizePosix), and isRelativeLink / splitFragment now live in ./linkSyntax
// and are imported above so there is a single copy shared with linkScan.

/** True when `p` is exactly `prefix` or sits under `prefix` on a boundary. */
function isPathOrUnder(p: string, prefix: string): boolean {
  return p === prefix || p.startsWith(`${prefix}/`);
}

/** Strip a trailing `.md` (case-insensitive) to get a file's sidecar stem. */
function sidecarStem(mdPath: string): string {
  return mdPath.replace(/\.md$/i, "");
}

/**
 * The own-sidecar image folder that co-moves with a markdown file. For
 * `notes/a.md` this is `notes/a-md-images`. When the file is renamed/moved the
 * folder moves with it, so an image ref into it must be treated as co-moving.
 */
function sidecarDir(mdPath: string): string {
  return `${sidecarStem(mdPath)}-md-images`;
}

/**
 * Apply the move mapping to a target path (workspace-relative POSIX). Returns
 * the post-move path, or the unchanged path when the move does not touch it.
 *
 * For a folder move, any target inside the subtree is remapped on a segment
 * boundary so `old` does not match `older/x.md`.
 *
 * For a file (.md) move, the file's own `*-md-images` sidecar folder co-moves
 * with it, so targets under that sidecar are remapped too (the sidecar name is
 * derived from the basename, which may itself change on a rename).
 */
function mapMovedTarget(
  target: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string {
  if (isDirectory) {
    if (target === oldPath) return newPath;
    if (target.startsWith(`${oldPath}/`)) {
      return `${newPath}${target.slice(oldPath.length)}`;
    }
    return target;
  }
  if (target === oldPath) return newPath;
  const oldSidecar = sidecarDir(oldPath);
  if (target.startsWith(`${oldSidecar}/`)) {
    return `${sidecarDir(newPath)}${target.slice(oldSidecar.length)}`;
  }
  return target;
}

/**
 * Rewrite a single relative URL for a referrer. `referrerOldDir` is the
 * referrer's directory before the move, `referrerNewDir` after. Returns the
 * new URL, or null when nothing should change.
 */
function rewriteUrl(
  url: string,
  referrerOldDir: string,
  referrerNewDir: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string | null {
  if (!isRelativeLink(url)) return null;
  const { path: pathPart, frag } = splitFragment(url);
  if (pathPart === "") return null; // e.g. just "#frag" handled above, be safe

  // Resolve the link to a workspace-relative target (pre-move world).
  const oldTarget = joinPosix(referrerOldDir, pathPart);

  // Where does that target live after the move?
  const newTarget = mapMovedTarget(oldTarget, oldPath, newPath, isDirectory);

  // Recompute the relative path from the referrer's NEW directory.
  const newRel = relativeFromDir(referrerNewDir, newTarget);

  const newUrl = `${newRel}${frag}`;
  return newUrl === url ? null : newUrl;
}

/**
 * Rewrite every relative link in a file's content. `oldDir`/`newDir` are the
 * referrer's directory before and after the move (equal for an unmoved file).
 * Returns the new content (may be identical to the input).
 */
function rewriteContent(
  content: string,
  oldDir: string,
  newDir: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string {
  const decoded = decodeImageUrlSpaces(content);

  let next = decoded.replace(INLINE_URL_RE, (whole, prefix, src, suffix) => {
    const rewritten = rewriteUrl(
      src,
      oldDir,
      newDir,
      oldPath,
      newPath,
      isDirectory,
    );
    return rewritten === null ? whole : `${prefix}${rewritten}${suffix}`;
  });

  REF_DEF_RE.lastIndex = 0;
  next = next.replace(REF_DEF_RE, (whole, prefix, src, suffix) => {
    const rewritten = rewriteUrl(
      src,
      oldDir,
      newDir,
      oldPath,
      newPath,
      isDirectory,
    );
    if (rewritten === null) return whole;
    return `${prefix}${rewritten}${suffix ?? ""}`;
  });

  if (next === decoded) {
    // No link changed; return the ORIGINAL content untouched so we don't
    // re-encode spaces in files we never meaningfully edited.
    return content;
  }
  return encodeImageUrlSpaces(next);
}

/**
 * Map a referrer file's pre-move path to its post-move path. A file that is
 * itself moved (or sits inside a moved folder) reports its new path; every
 * other file is unchanged.
 */
function mapReferrerPath(
  filePath: string,
  oldPath: string,
  newPath: string,
  isDirectory: boolean,
): string {
  return mapMovedTarget(filePath, oldPath, newPath, isDirectory);
}

/**
 * Compute the content rewrites needed when `oldPath` moves to `newPath`.
 *
 * The algorithm is uniform: for every file, recompute each relative link from
 * the file's NEW directory to the link target's NEW location. This single pass
 * naturally covers all the required cases:
 *  - inbound links (unmoved referrer -> moved target): referrer dir unchanged,
 *    target remapped, so the relative path is recomputed.
 *  - outbound links (moved referrer -> unmoved target): referrer dir changes,
 *    target stays, so the relative path is recomputed from the new location.
 *  - links between two files that both move together (e.g. an own-sidecar
 *    image, or two files inside a moved folder): source and target shift by
 *    the same amount, so the recomputed relative path is identical and the
 *    link is left untouched.
 */
export function planLinkRewrite(input: LinkMoveInput): LinkRewriteResult {
  const { files, oldPath, newPath, isDirectory } = input;

  // Guard: a folder cannot be moved into itself or one of its descendants.
  if (isDirectory && isPathOrUnder(newPath, oldPath)) {
    return { updates: [], changed: false, error: "self-into-descendant" };
  }

  const updates: { path: string; newContent: string }[] = [];

  for (const file of files) {
    const oldDir = dirname(file.path);
    const newFilePath = mapReferrerPath(
      file.path,
      oldPath,
      newPath,
      isDirectory,
    );
    const newDir = dirname(newFilePath);

    const newContent = rewriteContent(
      file.content,
      oldDir,
      newDir,
      oldPath,
      newPath,
      isDirectory,
    );

    if (newContent !== file.content) {
      updates.push({ path: newFilePath, newContent });
    }
  }

  return { updates, changed: updates.length > 0 };
}
