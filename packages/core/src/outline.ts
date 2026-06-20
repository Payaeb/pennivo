// Pure ATX-heading outline extractor. A light string scan (no markdown AST)
// that lists every `#`..`######` heading with its level, text, and 1-based
// line number. Lives in core so it can be unit-tested without fs/DOM. Fenced
// code blocks are tracked so a `#` inside a ``` or ~~~ fence is never mistaken
// for a heading.

/** One ATX heading discovered by extractOutline. */
export interface OutlineHeading {
  /** Heading level 1..6 (number of leading `#`). */
  level: number;
  /** Trimmed heading text with any trailing `#` run stripped. */
  text: string;
  /** 1-based line number of the heading. */
  line: number;
}

// A fence opener/closer: a line that is only ``` or ~~~ (3+), optionally
// indented, optionally followed by an info string on an opener.
const FENCE_RE = /^\s*(```|~~~)/;

// An ATX heading: 1..6 `#` then at least one space, then the heading text.
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/**
 * Extract the ATX-heading outline from markdown `content`. Headings inside an
 * open fenced code block are ignored. Trailing `#` characters on a heading (the
 * optional closing sequence) are stripped from the text.
 */
export function extractOutline(content: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = content.split("\n");
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (FENCE_RE.test(line)) {
      // Toggle fence state on any fence marker line. We do not require the
      // closing fence to use the same character as the opener; this light scan
      // treats any ``` or ~~~ line as a toggle, which is enough to keep `#`
      // inside code from being read as a heading.
      inFence = !inFence;
      continue;
    }

    if (inFence) continue;

    const m = HEADING_RE.exec(line);
    if (!m) continue;

    const level = m[1].length;
    const text = m[2].replace(/\s*#+\s*$/, "").trim();
    headings.push({ level, text, line: i + 1 });
  }

  return headings;
}
