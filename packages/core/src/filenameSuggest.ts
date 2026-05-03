// Derive a sensible default filename from the first line of a markdown
// document. Used for the desktop "Save As" dialog so a brand-new file is
// suggested as e.g. "Project Plan.md" instead of "untitled.md".
//
// Rules:
//   - First non-empty line wins.
//   - If it's an ATX heading (`#` through `######`), the heading marks and
//     the following space are stripped.
//   - Filesystem-unsafe characters are removed: / \ : * ? " < > | and any
//     control char (0x00-0x1F, 0x7F). Cross-platform-safe — Windows is the
//     strictest of the three OSes Pennivo runs on.
//   - Leading/trailing whitespace and dots are trimmed (Windows rejects
//     trailing dots, and a leading dot on POSIX makes the file hidden).
//   - Truncated to 60 chars (leaves room for ".md" within typical 255-byte
//     filename limits and keeps the suggestion glanceable).
//   - Empty result falls back to "Untitled".
//
// Always returns a BASE NAME without extension. The caller appends ".md".

// Intentional: stripping control chars (0x00-0x1F, 0x7F) from a candidate filename.
// eslint-disable-next-line no-control-regex
const FS_UNSAFE = /[/\\:*?"<>|\x00-\x1f\x7f]/g;
const MAX_LEN = 60;
const FALLBACK = "Untitled";

export function suggestFilenameFromContent(markdown: string): string {
  if (typeof markdown !== "string" || markdown.length === 0) return FALLBACK;

  const lines = markdown.split(/\r?\n/);
  let candidate = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    candidate = stripHeadingMarks(line);
    candidate = candidate.trim();
    if (candidate) break;
  }
  if (!candidate) return FALLBACK;

  const cleaned = candidate
    .replace(FS_UNSAFE, "")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");

  if (!cleaned) return FALLBACK;

  return cleaned.length > MAX_LEN ? cleaned.slice(0, MAX_LEN).trimEnd() : cleaned;
}

function stripHeadingMarks(line: string): string {
  // Match an ATX heading: 1-6 `#`s followed by either whitespace + text, or
  // end of line. The latter handles "# " (trim drops the trailing space) so
  // an empty heading falls through to the next line via the empty result.
  const m = /^(#{1,6})(?:\s+(.*)|)$/.exec(line);
  return m ? m[2] ?? "" : line;
}
