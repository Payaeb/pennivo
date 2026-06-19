// ProseMirror plugin + helpers for FindReplace.
// Lives in a sibling file so FindReplace.tsx can stay component-only and
// satisfy react-refresh/only-export-components for fast refresh.

import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import type { EditorView } from "@milkdown/prose/view";

export interface FindReplaceState {
  query: string;
  useRegex: boolean;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

interface ProseMirrorNode {
  content: { size: number };
  descendants: (
    callback: (node: ProseMirrorNode, pos: number) => boolean | void,
  ) => void;
  isText: boolean;
  isBlock: boolean;
  text?: string;
}

export const findReplacePluginKey = new PluginKey<FindReplaceState>(
  "findReplace",
);

function buildMatches(
  doc: ProseMirrorNode,
  query: string,
  useRegex: boolean,
): Array<{ from: number; to: number }> {
  if (!query) return [];

  let fullText = "";
  const posMap: number[] = [];
  let prevBlockEnd = false;

  doc.descendants((node, pos) => {
    if (node.isBlock && fullText.length > 0 && !prevBlockEnd) {
      fullText += "\n";
      posMap.push(-1);
      prevBlockEnd = true;
    }
    if (node.isText && node.text) {
      prevBlockEnd = false;
      for (let i = 0; i < node.text.length; i++) {
        posMap.push(pos + i);
        fullText += node.text[i];
      }
    }
  });

  const matches: Array<{ from: number; to: number }> = [];

  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "gi");
    } catch {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      re = new RegExp(escaped, "gi");
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(fullText)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      const from = posMap[m.index];
      const to = posMap[m.index + m[0].length - 1] + 1;
      if (from >= 0 && to > 0) matches.push({ from, to });
    }
  } else {
    const lower = query.toLowerCase();
    const textLower = fullText.toLowerCase();
    let idx = 0;
    while ((idx = textLower.indexOf(lower, idx)) !== -1) {
      const from = posMap[idx];
      const to = posMap[idx + lower.length - 1] + 1;
      if (from >= 0 && to > 0) matches.push({ from, to });
      idx += lower.length;
    }
  }

  return matches;
}

// Locate the first occurrence of a plain (non-regex) query term in the doc and
// return its ProseMirror position range, or null if absent. Used by the global
// search jump-to-match path in WYSIWYG mode, where raw file offsets do not map
// 1:1 to ProseMirror positions so we re-find the term in the rendered document.
export function findFirstPmMatch(
  doc: ProseMirrorNode,
  query: string,
): { from: number; to: number } | null {
  const matches = buildMatches(doc, query, false);
  return matches.length > 0 ? matches[0] : null;
}

// Scroll a ProseMirror match into the editor viewport. Shared by FindReplace
// and the global-search jump-to-match path so both use the identical technique.
export function scrollToPmMatch(
  view: EditorView,
  match: { from: number; to: number },
) {
  const coords = view.coordsAtPos(match.from);
  const editorArea = view.dom.closest(".app-editor-area");
  if (!editorArea) return;

  const areaRect = editorArea.getBoundingClientRect();
  const relativeTop = coords.top - areaRect.top;
  const visibleHeight = areaRect.height;

  if (relativeTop < 60 || relativeTop > visibleHeight - 60) {
    editorArea.scrollTop += relativeTop - visibleHeight / 3;
  }
}

export function createFindReplacePlugin() {
  return new Plugin<FindReplaceState>({
    key: findReplacePluginKey,
    state: {
      init() {
        return { query: "", useRegex: false, matches: [], currentIndex: -1 };
      },
      apply(tr, prev) {
        const meta = tr.getMeta(findReplacePluginKey) as
          | Partial<FindReplaceState>
          | undefined;
        if (meta) {
          const next = { ...prev, ...meta };
          if (
            meta.query !== undefined ||
            meta.useRegex !== undefined ||
            tr.docChanged
          ) {
            next.matches = buildMatches(tr.doc, next.query, next.useRegex);
            if (next.currentIndex >= next.matches.length)
              next.currentIndex = next.matches.length > 0 ? 0 : -1;
            if (next.currentIndex === -1 && next.matches.length > 0)
              next.currentIndex = 0;
          }
          return next;
        }
        if (tr.docChanged && prev.query) {
          const matches = buildMatches(tr.doc, prev.query, prev.useRegex);
          const currentIndex =
            matches.length > 0
              ? Math.min(prev.currentIndex, matches.length - 1)
              : -1;
          return {
            ...prev,
            matches,
            currentIndex:
              currentIndex < 0 ? (matches.length > 0 ? 0 : -1) : currentIndex,
          };
        }
        return prev;
      },
    },
    props: {
      decorations(state) {
        const pluginState = findReplacePluginKey.getState(state);
        if (
          !pluginState ||
          !pluginState.query ||
          pluginState.matches.length === 0
        ) {
          return DecorationSet.empty;
        }

        const decos = pluginState.matches.map((m, i) => {
          const className =
            i === pluginState.currentIndex
              ? "find-match find-match--current"
              : "find-match";
          return Decoration.inline(m.from, m.to, { class: className });
        });

        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}
