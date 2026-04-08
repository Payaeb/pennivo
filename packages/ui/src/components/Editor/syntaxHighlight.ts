import { $prose } from '@milkdown/utils';
import { createHighlightPlugin } from 'prosemirror-highlight';
import { createParser } from 'prosemirror-highlight/lowlight';
import { createLowlight } from 'lowlight';
import { Plugin, PluginKey } from '@milkdown/prose/state';

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import markdown from 'highlight.js/lib/languages/markdown';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';

const lowlight = createLowlight();

lowlight.register('javascript', javascript);
lowlight.register('js', javascript);
lowlight.register('jsx', javascript);
lowlight.register('typescript', typescript);
lowlight.register('ts', typescript);
lowlight.register('tsx', typescript);
lowlight.register('python', python);
lowlight.register('py', python);
lowlight.register('html', xml);
lowlight.register('xml', xml);
lowlight.register('css', css);
lowlight.register('json', json);
lowlight.register('bash', bash);
lowlight.register('sh', bash);
lowlight.register('shell', bash);
lowlight.register('markdown', markdown);
lowlight.register('md', markdown);
lowlight.register('rust', rust);
lowlight.register('rs', rust);
lowlight.register('go', go);
lowlight.register('golang', go);

const lowlightParser = createParser(lowlight);

// Wrap parser to skip auto-detection when no language is specified
const parser: typeof lowlightParser = (options) => {
  if (!options.language) return [];
  return lowlightParser(options);
};

const refreshKey = new PluginKey('highlight-refresh');

export const syntaxHighlightPlugin = $prose(() =>
  createHighlightPlugin({
    parser,
    nodeTypes: ['code_block'],
    languageExtractor: (node) => node.attrs['language'] || null,
  }),
);

// Companion plugin: debounced refresh to ensure decorations update during live typing
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export const highlightRefreshPlugin = $prose(() =>
  new Plugin({
    key: refreshKey,
    view() {
      return {
        update(view, prevState) {
          if (!view.state.doc.eq(prevState.doc)) {
            let hasCodeBlock = false;
            view.state.doc.descendants((node) => {
              if (node.type.name === 'code_block' && node.attrs['language']) {
                hasCodeBlock = true;
                return false;
              }
            });
            if (hasCodeBlock) {
              if (debounceTimer) clearTimeout(debounceTimer);
              debounceTimer = setTimeout(() => {
                view.dispatch(
                  view.state.tr.setMeta('prosemirror-highlight-refresh', true)
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
