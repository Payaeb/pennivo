// Pure backlink finder. Given a target file and every markdown file in the
// workspace, it reports every inbound relative link or image that resolves to
// the target. Lives in core so it can be unit-tested without fs/IPC. The MCP
// server enumerates the workspace and hands the file list in; this module does
// only string + POSIX path math (no fs, DOM, Electron, or node:path).

import {
  REF_DEF_RE,
  INLINE_URL_RE,
  normalizePosix,
  dirname,
  joinPosix,
  isRelativeLink,
  splitFragment,
} from "./linkSyntax";

/** A markdown file scanned for inbound links. Paths are workspace-relative POSIX. */
export interface ScanFile {
  path: string;
  content: string;
}

/** One inbound link discovered by findInboundLinks. */
export interface InboundLink {
  /** Path of the referring file (workspace-relative POSIX). */
  path: string;
  /** 1-based line number where the link appears. */
  line: number;
  /** The `[text]` portion of the link, or "" for reference defs / bare images. */
  linkText: string;
  /** The raw URL exactly as written in the source. */
  url: string;
}

/** 1-based line number of a character offset within `content`. */
function lineAt(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

/**
 * Resolve a raw relative URL (as written in `referrerDir`) to a normalized
 * workspace-relative target path, or null when it is not a relative link we
 * can resolve to a file (external, absolute, protocol-relative, or a pure
 * anchor). The trailing `#fragment` is stripped before resolution.
 */
function resolveTarget(url: string, referrerDir: string): string | null {
  if (!isRelativeLink(url)) return null;
  const { path: pathPart } = splitFragment(url);
  if (pathPart === "") return null; // pure anchor, nothing to resolve
  return joinPosix(referrerDir, pathPart);
}

/**
 * Find every inbound link/image/reference-definition across `files` that
 * resolves to `targetPath`. `targetPath` and each `file.path` are
 * workspace-relative POSIX. A file backlinks to the target only when it
 * genuinely links to that resolved path; resolution is on segment boundaries
 * (via POSIX normalization), so a link to "notes" never matches "notes-archive".
 */
export function findInboundLinks(
  targetPath: string,
  files: ScanFile[],
): InboundLink[] {
  const target = normalizePosix(targetPath);
  const out: InboundLink[] = [];

  for (const file of files) {
    const referrerDir = dirname(file.path);
    const { content } = file;

    // Inline links and images: ![text](url) / [text](url). The capture groups
    // are prefix (`![text](` or `[text](`), the url, and a closing suffix.
    INLINE_URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = INLINE_URL_RE.exec(content)) !== null) {
      const prefix = m[1];
      const url = m[2];
      const resolved = resolveTarget(url, referrerDir);
      if (resolved !== null && resolved === target) {
        // Pull the bracket text out of the prefix: strip a leading `!`, the
        // opening `[`, and the trailing `](`.
        const textMatch = /^!?\[([^\]]*)]\($/.exec(prefix);
        const linkText = textMatch ? textMatch[1] : "";
        out.push({
          path: file.path,
          line: lineAt(content, m.index),
          linkText,
          url,
        });
      }
    }

    // Reference-style definitions: `[id]: url`. group 2 is the url. The bracket
    // here is an identifier, not display text, so linkText is "".
    REF_DEF_RE.lastIndex = 0;
    while ((m = REF_DEF_RE.exec(content)) !== null) {
      const url = m[2];
      const resolved = resolveTarget(url, referrerDir);
      if (resolved !== null && resolved === target) {
        out.push({
          path: file.path,
          line: lineAt(content, m.index),
          linkText: "",
          url,
        });
      }
    }
  }

  return out;
}
