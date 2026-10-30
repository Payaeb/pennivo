import type { Node as PmNode } from "@milkdown/prose/model";

/** Identifies one list item in the document by its text, kind and ordinal. */
export interface ListItemTarget {
  /** Verbatim item text after the marker/checkbox (TaskItem/LabeledItem.rawText). */
  text: string;
  kind: "task" | "plain";
  /** 0-based index among same-kind, same-normalized-text items, in document order. */
  occurrence: number;
}

/**
 * Collapse whitespace runs, trim, and strip a leading `&#x20;` entity / space
 * (markdown escape for a leading space). Label chips and due chips are
 * decorations over the real text, so doc textContent keeps `#label` and
 * `[due:: ...]` verbatim and needs no other rewriting.
 */
export function normalizeListItemText(text: string): string {
  return text
    .replace(/^(?:&#x20;|\s)+/i, "")
    .replace(/&#x20;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Approximate the plain text ProseMirror shows for a raw markdown inline
 * string: images -> alt, links -> text, autolinks -> URL, code spans -> inner
 * text, ** __ ~~ removed, single * _ removed only when wrapping a word, and
 * backslash escapes unescaped.
 */
export function stripInlineMarkdown(raw: string): string {
  // Protect escapes and code spans so their contents are not re-interpreted.
  const stash: string[] = [];
  const hold = (t: string) => `\uE000${stash.push(t) - 1}\uE000`;
  let t = raw.replace(
    /\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g,
    (_m, c: string) => hold(c),
  );
  t = t.replace(
    /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g,
    (_m, _b, inner: string) => hold(inner.replace(/^ (.*) $/, "$1")),
  );
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");
  t = t.replace(/<((?:https?|mailto):[^>\s]+)>/gi, "$1");
  t = t.replace(/(\*\*|__|~~)/g, "");
  // Single emphasis only when it wraps a word at word boundaries.
  t = t.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])/g, "$1$2");
  t = t.replace(/(^|[^\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, "$1$2");
  return t.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => stash[Number(i)]);
}

/** Normalization shared by the locator's stripped pass and occurrence counting. */
export function normalizeListItemKey(text: string): string {
  return normalizeListItemText(stripInlineMarkdown(text));
}

export interface ListItemLocation {
  /** Position of the list_item node. */
  pos: number;
  /** Position of its first child paragraph. */
  paraPos: number;
  /** Content range of that paragraph. */
  from: number;
  to: number;
}

/** Locate the list_item matching `target`; first match if occurrence is out of range, null if none. */
export function findListItemByText(
  doc: PmNode,
  target: ListItemTarget,
): ListItemLocation | null {
  const exact = collect(doc, target, normalizeListItemText(target.text));
  const matches = exact.length
    ? exact
    : collect(
        doc,
        target,
        normalizeListItemText(stripInlineMarkdown(target.text)),
      );
  if (matches.length === 0) return null;
  return matches[target.occurrence] ?? matches[0];
}

function collect(
  doc: PmNode,
  target: ListItemTarget,
  wanted: string,
): ListItemLocation[] {
  const matches: ListItemLocation[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "list_item") return;
    const isTask = node.attrs["checked"] != null;
    if (isTask !== (target.kind === "task")) return;
    const first = node.firstChild;
    if (!first || first.type.name !== "paragraph") return;
    if (normalizeListItemText(first.textContent) !== wanted) return;
    const paraPos = pos + 1;
    matches.push({
      pos,
      paraPos,
      from: paraPos + 1,
      to: paraPos + 1 + first.content.size,
    });
  });
  return matches;
}
