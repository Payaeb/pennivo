// Pure planner for the asset-folder normalizer. Lives in core so it can be
// unit-tested without fs/IPC. The desktop main process turns the plan into
// real fs operations (rename, copy, rm, writeFile) and verifies the result
// against an updated disk listing before committing.

export interface NormalizePlanInput {
  /** Markdown content of the file. */
  content: string;
  /** Names of *-md-images folders sitting next to the file on disk. */
  onDiskFolders: string[];
  /** Canonical folder name for the file's current basename. */
  desiredFolder: string;
}

export interface NormalizePlan {
  /** Folder to rename into the desiredFolder (or null if nothing to promote). */
  promote: { from: string; to: string } | null;
  /** Other folders whose contents should be merged into desiredFolder. */
  mergeFrom: string[];
  /** Rewritten content reflecting the planned moves and any Step-3b heal. */
  newContent: string;
  /**
   * If the plan would change anything (folder ops or content changes).
   * False = no-op, callers can short-circuit.
   */
  changed: boolean;
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

function escapeForRegex(s: string): string {
  return s.replace(ESCAPE_RE, "\\$&");
}

/**
 * Build a regex that matches `${folderName}/` only when preceded by a path
 * boundary character — start-of-line, whitespace, `/`, `(`, or `[`. This
 * stops a short folder name from accidentally matching inside an unrelated
 * word or inside a longer folder name. The boundary is captured as $1 so
 * callers can preserve it on replacement.
 */
function boundaryRefRegex(folderName: string, flags: string): RegExp {
  return new RegExp(`(^|[\\s/([])${escapeForRegex(folderName)}/`, flags);
}

const ANY_REF_RE = /(?:^|[\s/([])([^/()[\]\n]+-md-images)\//gm;

// Markdown image / link URL — used when we need to encode/decode just the
// URL portion without touching surrounding prose. Same shape as the regex
// in `packages/ui/src/utils/imagePaths.ts` but kept self-contained because
// `@pennivo/core` can't import from `@pennivo/ui`.
const MD_IMAGE_OR_LINK_URL_RE = /(!?\[[^\]]*]\()([^)"]+?)((?:\s+"[^"]*")?\))/g;

/**
 * Replace `%20` with literal spaces inside image/link URLs only — never
 * touches body text. Use this before passing content to `planNormalize`
 * so its boundary regex (which expects on-disk folder names with literal
 * spaces) can match references that were saved in the canonical
 * `%20`-encoded form.
 */
export function decodeImageUrlSpaces(content: string): string {
  return content.replace(MD_IMAGE_OR_LINK_URL_RE, (_, prefix, src, suffix) => {
    return `${prefix}${src.replace(/%20/g, " ")}${suffix}`;
  });
}

/**
 * Inverse of `decodeImageUrlSpaces`. Use after planning to write content
 * back to disk with portable `%20`-encoded URLs.
 */
export function encodeImageUrlSpaces(content: string): string {
  return content.replace(MD_IMAGE_OR_LINK_URL_RE, (_, prefix, src, suffix) => {
    return `${prefix}${src.replace(/ /g, "%20")}${suffix}`;
  });
}

/**
 * Extract every `*-md-images` folder name referenced by the content, with
 * the same boundary anchoring used elsewhere — so we don't pick up names
 * embedded in unrelated text.
 */
export function extractReferencedFolders(content: string): Set<string> {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  ANY_REF_RE.lastIndex = 0;
  while ((m = ANY_REF_RE.exec(content)) !== null) {
    out.add(m[1]);
  }
  return out;
}

export function planNormalize(input: NormalizePlanInput): NormalizePlan {
  const { content, onDiskFolders, desiredFolder } = input;

  // Discovery — which on-disk folders does the content actually reference?
  // Iterate longest-first and strip matches as we go so a short name that's
  // a suffix of a long one doesn't get falsely credited.
  const sortedFolders = [...onDiskFolders].sort((a, b) => b.length - a.length);
  const referenced = new Set<string>();
  let scan = content;
  for (const folder of sortedFolders) {
    if (boundaryRefRegex(folder, "m").test(scan)) {
      referenced.add(folder);
      scan = scan.replace(
        boundaryRefRegex(folder, "gm"),
        "$1__pennivo_match__/",
      );
    }
  }

  // Folders we own = canonical (if it's on disk) + anything content-referenced
  // that's also on disk. We never claim an on-disk folder that's not ours.
  const onDiskSet = new Set(onDiskFolders);
  const owned = new Set<string>();
  for (const name of onDiskFolders) {
    if (name === desiredFolder || referenced.has(name)) owned.add(name);
  }

  const otherOwned = [...owned].filter((n) => n !== desiredFolder);
  const referencedNonCanonical = [...referenced].filter(
    (n) => n !== desiredFolder,
  );

  // Promote = first otherOwned → desiredFolder, only when canonical isn't
  // already on disk. Remaining otherOwned merge in afterward.
  let promote: NormalizePlan["promote"] = null;
  let mergeFrom = otherOwned;
  if (!owned.has(desiredFolder) && otherOwned.length > 0) {
    promote = { from: otherOwned[0], to: desiredFolder };
    mergeFrom = otherOwned.slice(1);
  }

  // Step 3 — rewrite content references to canonical.
  let newContent = content;
  const sortedNonCanonical = [...referencedNonCanonical].sort(
    (a, b) => b.length - a.length,
  );
  for (const refName of sortedNonCanonical) {
    newContent = newContent.replace(
      boundaryRefRegex(refName, "gm"),
      `$1${desiredFolder}/`,
    );
  }

  // Step 3b — heal already-corrupted refs (the doubled-prefix pattern from
  // the old buggy regex). If a reference's folder name doesn't exist on disk
  // but ends with ` <on-disk-folder>` (boundary = space), rewrite to the
  // on-disk folder name. We use the ORIGINAL onDiskSet here because that's
  // the source of truth for what real folders exist.
  newContent = newContent.replace(
    ANY_REF_RE,
    (whole, folderName: string, offset: number) => {
      if (onDiskSet.has(folderName)) return whole;
      // Recover the boundary char that the regex consumed (offset points at
      // the start of the WHOLE match including the boundary).
      const boundary =
        offset === 0
          ? ""
          : whole.startsWith(folderName)
            ? ""
            : whole.slice(0, whole.length - folderName.length - 1);
      for (const realName of sortedFolders) {
        if (
          folderName.length > realName.length &&
          folderName.endsWith(` ${realName}`)
        ) {
          return `${boundary}${realName}/`;
        }
      }
      return whole;
    },
  );

  return {
    promote,
    mergeFrom,
    newContent,
    changed: newContent !== content || promote !== null || mergeFrom.length > 0,
  };
}
