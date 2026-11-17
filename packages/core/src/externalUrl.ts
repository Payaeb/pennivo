// Single guard for handing a URL to the operating system (shell.openExternal).
// Every path that opens a link outside the app must go through this, so the
// Ctrl+click handler and the right-click menu cannot drift apart again.
//
// Only http: and https: are allowed. Everything else is refused, including
// file:, UNC paths, javascript:, data:, ms-*: and search-ms: handlers, and
// mailto: (this path is for opening web pages; mail links are not opened).

const MAX_URL_LENGTH = 8192;
// Control characters (incl. tab and newline) and DEL. WHATWG URL parsing
// silently strips some of these, so they are rejected up front instead.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  // No leading/trailing whitespace: real link targets never carry it, and
  // WHATWG parsing would quietly trim it.
  if (url !== url.trim()) return false;
  if (CONTROL_CHARS.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.hostname.length > 0;
}
