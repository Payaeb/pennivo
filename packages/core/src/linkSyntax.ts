// Shared pure primitives for scanning and rewriting markdown link syntax.
// These live in one place so linkRewriter (the move planner) and linkScan
// (the backlink finder) use exactly the same regexes and POSIX path math.
// No fs, DOM, Electron, or node:path: everything is string + path arithmetic.

// Reference-style link definitions: `[id]: ./path/to.md` optionally followed
// by a title. Anchored to the start of a line (allowing leading spaces). The
// URL is captured as group 2 so callers can rewrite or read only that part.
export const REF_DEF_RE = /^([ \t]*\[[^\]]+\]:\s*)(\S+)(\s.*)?$/gm;

// Inline image / link URL. Same shape as assetNormalizer's regex (kept in
// sync) so inline `[t](url)` and image `![t](url)` are matched uniformly.
export const INLINE_URL_RE = /(!?\[[^\]]*]\()([^)"]+?)((?:\s+"[^"]*")?\))/g;

// --- pure POSIX path helpers ------------------------------------------------

/** Split a POSIX path into non-empty segments. */
export function segments(p: string): string[] {
  return p.split("/").filter((s) => s.length > 0);
}

/**
 * Normalize a POSIX path, resolving `.` and `..` segments. Keeps it relative
 * (a leading `..` that escapes the root is preserved). Returns "" for the
 * current directory. Never returns a trailing slash.
 */
export function normalizePosix(p: string): string {
  const out: string[] = [];
  for (const seg of segments(p)) {
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else {
        out.push("..");
      }
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/** Directory portion of a file path (POSIX). "" for a root-level file. */
export function dirname(p: string): string {
  const norm = normalizePosix(p);
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "" : norm.slice(0, idx);
}

/** Join a base directory and a relative path, then normalize. */
export function joinPosix(base: string, rel: string): string {
  if (base === "") return normalizePosix(rel);
  return normalizePosix(`${base}/${rel}`);
}

/**
 * Compute the relative path from directory `fromDir` to file `toPath`, both
 * workspace-relative POSIX. The result is written the way markdown links
 * conventionally are: prefixed with `./` unless it already starts with `../`.
 */
export function relativeFromDir(fromDir: string, toPath: string): string {
  const from = segments(fromDir);
  const to = segments(toPath);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.length - i;
  const down = to.slice(i);
  const parts: string[] = [];
  for (let k = 0; k < up; k++) parts.push("..");
  for (const seg of down) parts.push(seg);
  if (parts.length === 0) return "./";
  const joined = parts.join("/");
  return joined.startsWith("..") ? joined : `./${joined}`;
}

/**
 * Decide whether a URL is a relative link we should rewrite or resolve.
 * External schemes, protocol-relative `//`, and absolute `/` paths are left
 * untouched. Anything starting with `./`, `../`, or a bare name is relative.
 */
export function isRelativeLink(url: string): boolean {
  if (url.startsWith("#")) return false; // pure anchor, no path
  if (url.startsWith("/")) return false; // absolute or protocol-relative `//`
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return false; // scheme: http, mailto, ...
  return true;
}

/** Split a URL into its path part and trailing `#fragment` (kept verbatim). */
export function splitFragment(url: string): { path: string; frag: string } {
  const hashIdx = url.indexOf("#");
  if (hashIdx === -1) return { path: url, frag: "" };
  return { path: url.slice(0, hashIdx), frag: url.slice(hashIdx) };
}
