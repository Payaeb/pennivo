// Tiny markdown-to-React renderer scoped to the subset used by the
// privacy notice: H1, H2, paragraphs, unordered lists (with two-space
// nesting), bold (**text**), inline code (`text`), and links ([t](url)).
//
// Why a hand-rolled parser instead of pulling in `marked` / `remark`:
//   - The privacy doc is the only in-app markdown surface that isn't
//     already handled by Milkdown. Adding a 100kb-class markdown lib for
//     a single static document is overkill.
//   - We never produce raw HTML — every node is a React element. There's
//     no XSS surface to worry about even for arbitrary input, and we
//     avoid the DOMPurify round-trip the editor uses elsewhere.
//
// Restrictions:
//   - No tables, no images, no headings beyond H2, no ordered lists, no
//     blockquotes. The privacy doc doesn't use them; if it ever needs
//     them, extend this file (and add tests).

import { type ReactNode, type JSX } from "react";

export type OpenLink = (url: string) => void;

interface ListItem {
  text: string;
  children: ListItem[];
}

/** Render the privacy markdown into a tree of React nodes. */
export function renderPrivacyMarkdown(
  source: string,
  openLink: OpenLink,
): ReactNode {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const nextKey = () => `priv-${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Headings.
    if (line.startsWith("# ")) {
      nodes.push(
        <h1 key={nextKey()} className="privacy-h1">
          {renderInline(line.slice(2), openLink, nextKey)}
        </h1>,
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      nodes.push(
        <h2 key={nextKey()} className="privacy-h2">
          {renderInline(line.slice(3), openLink, nextKey)}
        </h2>,
      );
      i++;
      continue;
    }

    // Unordered list — collect contiguous lines starting with "- " or
    // indented "  - " for nesting.
    if (/^- /.test(line)) {
      const { items, consumed } = collectList(lines, i, 0);
      nodes.push(
        <ul key={nextKey()} className="privacy-list">
          {renderListItems(items, openLink, nextKey)}
        </ul>,
      );
      i += consumed;
      continue;
    }

    // Paragraph — collect contiguous non-empty, non-block lines.
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("# ") &&
      !lines[i].startsWith("## ") &&
      !/^- /.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    nodes.push(
      <p key={nextKey()} className="privacy-p">
        {renderInline(paraLines.join(" "), openLink, nextKey)}
      </p>,
    );
  }

  return nodes;
}

/** Collect a list block. Returns the parsed items + how many lines were used. */
function collectList(
  lines: string[],
  start: number,
  indent: number,
): { items: ListItem[]; consumed: number } {
  const items: ListItem[] = [];
  let i = start;
  const indentStr = " ".repeat(indent);
  const itemRe = new RegExp(`^${indentStr}- (.*)$`);
  const childIndent = indent + 2;
  const childRe = new RegExp(`^${" ".repeat(childIndent)}- `);

  while (i < lines.length) {
    const line = lines[i];
    const m = itemRe.exec(line);
    if (!m) break;
    const item: ListItem = { text: m[1], children: [] };
    i++;
    // Children?
    if (i < lines.length && childRe.test(lines[i])) {
      const child = collectList(lines, i, childIndent);
      item.children = child.items;
      i += child.consumed;
    }
    items.push(item);
  }

  return { items, consumed: i - start };
}

function renderListItems(
  items: ListItem[],
  openLink: OpenLink,
  nextKey: () => string,
): ReactNode[] {
  return items.map((item) => (
    <li key={nextKey()} className="privacy-li">
      {renderInline(item.text, openLink, nextKey)}
      {item.children.length > 0 && (
        <ul className="privacy-list privacy-list--nested">
          {renderListItems(item.children, openLink, nextKey)}
        </ul>
      )}
    </li>
  ));
}

/**
 * Inline pass — handles bold (**text**), inline code (`text`), and
 * markdown links ([text](url)). Returns an array of React nodes (strings
 * for plain runs, JSX for the formatted spans).
 *
 * The order of handling matters: links are matched first (they may
 * contain bold inside their label, but the privacy doc never uses that),
 * then bold, then code. If any future privacy edit needs interaction
 * between these, this function should be replaced with a real lexer.
 */
export function renderInline(
  text: string,
  openLink: OpenLink,
  nextKey: () => string,
): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = text;

  // Tokenize linearly. Find the earliest of: link, bold, code; emit the
  // prefix as plain text, emit the matched span as JSX, then continue.
  while (buf.length > 0) {
    const linkMatch = /\[([^\]]+)\]\(([^)]+)\)/.exec(buf);
    const boldMatch = /\*\*([^*]+)\*\*/.exec(buf);
    const codeMatch = /`([^`]+)`/.exec(buf);

    const candidates: Array<{
      kind: "link" | "bold" | "code";
      m: RegExpExecArray;
    }> = [];
    if (linkMatch) candidates.push({ kind: "link", m: linkMatch });
    if (boldMatch) candidates.push({ kind: "bold", m: boldMatch });
    if (codeMatch) candidates.push({ kind: "code", m: codeMatch });

    if (candidates.length === 0) {
      out.push(buf);
      break;
    }

    candidates.sort((a, b) => a.m.index - b.m.index);
    const winner = candidates[0];
    if (winner.m.index > 0) {
      out.push(buf.slice(0, winner.m.index));
    }

    const tag: JSX.Element =
      winner.kind === "link" ? (
        <a
          key={nextKey()}
          className="privacy-link"
          href={winner.m[2]}
          onClick={(e) => {
            e.preventDefault();
            openLink(winner.m[2]);
          }}
        >
          {winner.m[1]}
        </a>
      ) : winner.kind === "bold" ? (
        <strong key={nextKey()} className="privacy-strong">
          {winner.m[1]}
        </strong>
      ) : (
        <code key={nextKey()} className="privacy-code">
          {winner.m[1]}
        </code>
      );

    out.push(tag);
    buf = buf.slice(winner.m.index + winner.m[0].length);
  }

  return out;
}
