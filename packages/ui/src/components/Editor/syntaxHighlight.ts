import { $prose } from "@milkdown/utils";
import { createHighlightPlugin } from "prosemirror-highlight";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

// ---------------------------------------------------------------------------
// Lazy lowlight + highlight.js grammars
// ---------------------------------------------------------------------------
// `lowlight` + the 10 registered highlight.js grammars add up to roughly
// 65 KB raw / 20 KB gzipped, and are only needed once the user opens a
// document that actually contains a fenced code block with a recognised
// language. We therefore defer the import until the first decoration
// request arrives — mirroring the pattern used by `mermaidPlugin.ts`.
//
// The heavy work lives in `./syntaxHighlightLazy.ts` so that we can reach
// it via a single `import("./syntaxHighlightLazy")`. Pulling individual
// named exports via static imports inside that helper lets rollup
// tree-shake `lowlight`'s `all` + `common` grammar barrels (dynamic
// `import("lowlight")` from this file does NOT, because the bundler has
// to preserve the whole namespace of a dynamic import).
//
// Until the real parser is ready, the wrapper returns `[]` (no
// decorations) so the editor renders instantly. When lowlight finishes
// loading, we dispatch the `prosemirror-highlight-refresh` meta on every
// attached view to repaint the code blocks.

import type { HighlightParser } from "./syntaxHighlightLazy";

let realParser: HighlightParser | null = null;
let loading: Promise<void> | null = null;

// All views currently hosting the plugin — we notify them once lowlight
// finishes loading so they can repaint without waiting for the next doc
// change.
const attachedViews = new Set<EditorView>();

function refreshAllViews() {
  for (const view of attachedViews) {
    view.dispatch(
      view.state.tr.setMeta("prosemirror-highlight-refresh", true),
    );
  }
}

function ensureLowlight(): void {
  if (realParser || loading) return;
  loading = import("./syntaxHighlightLazy").then((mod) => {
    realParser = mod.buildLowlightParser();
    refreshAllViews();
  });
}

// Parser handed to prosemirror-highlight. Synchronous (prosemirror-highlight
// expects a sync response), so while lowlight is loading we just return []
// and kick off the import. Once the real parser is ready, this delegates
// to it.
const parser: HighlightParser = (options) => {
  if (!realParser) {
    // Only trigger the import if we actually have a language worth
    // highlighting — avoids loading ~60 KB for a document full of plain
    // fenced blocks.
    if (options.language) ensureLowlight();
    return [];
  }
  return realParser(options);
};

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

const refreshKey = new PluginKey("highlight-refresh");
const viewTrackerKey = new PluginKey("highlight-view-tracker");

export const syntaxHighlightPlugin = $prose(() =>
  createHighlightPlugin({
    parser: parser as Parameters<typeof createHighlightPlugin>[0]["parser"],
    nodeTypes: ["code_block"],
    languageExtractor: (node) => node.attrs["language"] || null,
  }),
);

// Tracks which EditorViews are alive so we can dispatch a refresh to each
// once lowlight finishes loading.
export const highlightViewTrackerPlugin = $prose(
  () =>
    new Plugin({
      key: viewTrackerKey,
      view(view) {
        attachedViews.add(view);
        return {
          destroy() {
            attachedViews.delete(view);
          },
        };
      },
    }),
);

// Companion plugin: debounced refresh to ensure decorations update during
// live typing.
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export const highlightRefreshPlugin = $prose(
  () =>
    new Plugin({
      key: refreshKey,
      view() {
        return {
          update(view, prevState) {
            if (!view.state.doc.eq(prevState.doc)) {
              let hasCodeBlock = false;
              view.state.doc.descendants((node) => {
                if (node.type.name === "code_block" && node.attrs["language"]) {
                  hasCodeBlock = true;
                  return false;
                }
              });
              if (hasCodeBlock) {
                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                  view.dispatch(
                    view.state.tr.setMeta(
                      "prosemirror-highlight-refresh",
                      true,
                    ),
                  );
                }, 300);
              }
            }
          },
          destroy() {
            if (debounceTimer) clearTimeout(debounceTimer);
          },
        };
      },
    }),
);
