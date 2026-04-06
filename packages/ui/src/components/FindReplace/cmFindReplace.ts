import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export interface CmFindState {
  query: string;
  useRegex: boolean;
  matches: Array<{ from: number; to: number }>;
  currentIndex: number;
}

function buildTextMatches(
  text: string,
  query: string,
  useRegex: boolean,
): Array<{ from: number; to: number }> {
  if (!query) return [];

  const matches: Array<{ from: number; to: number }> = [];

  if (useRegex) {
    let re: RegExp;
    try {
      re = new RegExp(query, 'gi');
    } catch {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp(escaped, 'gi');
    }
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      matches.push({ from: m.index, to: m.index + m[0].length });
    }
  } else {
    const lower = query.toLowerCase();
    const textLower = text.toLowerCase();
    let idx = 0;
    while ((idx = textLower.indexOf(lower, idx)) !== -1) {
      matches.push({ from: idx, to: idx + lower.length });
      idx += lower.length;
    }
  }

  return matches;
}

export const updateCmFind = StateEffect.define<Partial<CmFindState>>();

export const cmFindField = StateField.define<CmFindState>({
  create() {
    return { query: '', useRegex: false, matches: [], currentIndex: -1 };
  },
  update(prev, tr) {
    let state = prev;

    for (const e of tr.effects) {
      if (e.is(updateCmFind)) {
        state = { ...state, ...e.value };
        // Rebuild matches if query or regex changed
        if (e.value.query !== undefined || e.value.useRegex !== undefined) {
          state.matches = buildTextMatches(
            tr.state.doc.toString(),
            state.query,
            state.useRegex,
          );
          if (state.currentIndex >= state.matches.length) {
            state.currentIndex = state.matches.length > 0 ? 0 : -1;
          }
          if (state.currentIndex === -1 && state.matches.length > 0) {
            state.currentIndex = 0;
          }
        }
      }
    }

    // Rebuild matches when doc changes and there's an active query
    if (tr.docChanged && state.query) {
      const matches = buildTextMatches(
        tr.state.doc.toString(),
        state.query,
        state.useRegex,
      );
      const currentIndex = matches.length > 0
        ? Math.min(state.currentIndex, matches.length - 1)
        : -1;
      state = {
        ...state,
        matches,
        currentIndex: currentIndex < 0 ? (matches.length > 0 ? 0 : -1) : currentIndex,
      };
    }

    return state;
  },
});

const cmFindDecorations = EditorView.decorations.compute([cmFindField], (state) => {
  const findState = state.field(cmFindField);
  if (!findState.query || findState.matches.length === 0) {
    return Decoration.none;
  }

  const decos = findState.matches.map((m, i) => {
    const cls = i === findState.currentIndex
      ? 'find-match find-match--current'
      : 'find-match';
    return Decoration.mark({ class: cls }).range(m.from, m.to);
  });

  return Decoration.set(decos);
});

export function cmFindExtension() {
  return [cmFindField, cmFindDecorations];
}
