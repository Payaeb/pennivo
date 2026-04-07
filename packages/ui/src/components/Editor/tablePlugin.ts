import { $prose } from '@milkdown/utils';
import { Plugin, PluginKey, Selection } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import type { Node } from '@milkdown/prose/model';
import { goToNextCell, addRowAfter } from 'prosemirror-tables';

const tablePluginKey = new PluginKey('table-controls');

// Custom isInTable — prosemirror-tables' version doesn't recognise
// Milkdown's table_header_row, causing the toolbar to miss first clicks.
function isInTable(state: import('@milkdown/prose/state').EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 0; d--) {
    if ($from.node(d).type.name === 'table') return true;
  }
  return false;
}

// Module-level ref so TableToolbar can read the active table element
let activeTableEl: HTMLElement | null = null;

export function getActiveTableElement(): HTMLElement | null {
  return activeTableEl;
}

export type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColLeft'
  | 'addColRight'
  | 'deleteRow'
  | 'deleteCol'
  | 'alignLeft'
  | 'alignCenter'
  | 'alignRight'
  | 'deleteTable';

// Find table info from cursor position
function findTableContext(state: import('@milkdown/prose/state').EditorState) {
  const { $from } = state.selection;
  let tableDepth = -1;
  let rowDepth = -1;
  let cellDepth = -1;

  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'table') tableDepth = d;
    if (name === 'table_row' || name === 'table_header_row') rowDepth = d;
    if (name === 'table_cell' || name === 'table_header') cellDepth = d;
  }

  if (tableDepth < 0) return null;

  const table = $from.node(tableDepth);
  const tablePos = $from.before(tableDepth);

  // Find which column the cursor is in
  let colIndex = -1;
  if (rowDepth >= 0 && cellDepth >= 0) {
    const row = $from.node(rowDepth);
    const cellStart = $from.before(cellDepth);
    let offset = $from.before(rowDepth) + 1; // start of row content
    row.forEach((cell, _off, idx) => {
      if (offset === cellStart) colIndex = idx;
      offset += cell.nodeSize;
    });
  }

  return { table, tablePos, tableDepth, rowDepth, cellDepth, colIndex };
}

export function executeTableAction(view: EditorView, action: TableAction): void {
  const { state, dispatch } = view;

  switch (action) {
    // Row add operations are handled via Milkdown commands in App.tsx
    case 'addRowAbove':
    case 'addRowBelow':
      break;

    // Custom column add — prosemirror-tables & Milkdown commands fail
    // on 1-column tables because of the table_header_row schema.
    case 'addColRight':
    case 'addColLeft': {
      const ctx = findTableContext(state);
      if (!ctx || ctx.colIndex < 0) break;

      const { table, tablePos, colIndex } = ctx;
      const insertAfter = action === 'addColRight';

      let tr = state.tr;
      const rows: { node: Node; pos: number }[] = [];
      table.forEach((row, offset) => {
        rows.push({ node: row, pos: tablePos + 1 + offset });
      });

      // Process in reverse so inserts don't shift later positions
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        const isHeaderRow = row.node.type.name === 'table_header_row';
        const cellType = isHeaderRow
          ? state.schema.nodes['table_header']
          : state.schema.nodes['table_cell'];

        // Find the target cell position
        let insertPos = -1;
        row.node.forEach((cell, off, idx) => {
          if (idx === colIndex) {
            const cellPos = row.pos + 1 + off;
            insertPos = insertAfter ? cellPos + cell.nodeSize : cellPos;
          }
        });

        if (insertPos >= 0 && cellType) {
          const emptyPara = state.schema.nodes['paragraph'].create();
          const newCell = cellType.create(null, emptyPara);
          tr = tr.insert(insertPos, newCell);
        }
      }

      // Place cursor in the new cell of the current row
      dispatch(tr);
      break;
    }

    case 'deleteRow': {
      const ctx = findTableContext(state);
      if (!ctx || ctx.rowDepth < 0) break;

      const { table, tablePos, rowDepth } = ctx;
      const { $from } = state.selection;
      const rowNode = $from.node(rowDepth);

      // Count data rows (everything except table_header_row)
      const dataRowCount = table.childCount - 1;

      // If cursor is in header row, target the last data row instead
      if (rowNode.type.name === 'table_header_row') {
        if (dataRowCount <= 1) {
          const tr = state.tr.delete(tablePos, tablePos + table.nodeSize);
          const para = state.schema.nodes['paragraph'].create();
          tr.insert(tablePos, para);
          tr.setSelection(Selection.near(tr.doc.resolve(tablePos + 1)));
          dispatch(tr);
        } else {
          let lastRowPos = tablePos + 1;
          let lastRowSize = 0;
          table.forEach((row, offset) => {
            if (row.type.name !== 'table_header_row') {
              lastRowPos = tablePos + 1 + offset;
              lastRowSize = row.nodeSize;
            }
          });
          const tr = state.tr.delete(lastRowPos, lastRowPos + lastRowSize);
          dispatch(tr);
        }
        break;
      }

      // If this is the last data row, delete the entire table
      if (dataRowCount <= 1) {
        const tr = state.tr.delete(tablePos, tablePos + table.nodeSize);
        const para = state.schema.nodes['paragraph'].create();
        tr.insert(tablePos, para);
        tr.setSelection(Selection.near(tr.doc.resolve(tablePos + 1)));
        dispatch(tr);
        break;
      }

      // Delete the current data row
      const rowPos = $from.before(rowDepth);
      const tr = state.tr.delete(rowPos, rowPos + rowNode.nodeSize);
      tr.setSelection(Selection.near(tr.doc.resolve(Math.min(rowPos, tr.doc.content.size - 1))));
      dispatch(tr);
      break;
    }

    case 'deleteCol': {
      const ctx = findTableContext(state);
      if (!ctx || ctx.colIndex < 0) break;

      const { table, tablePos, colIndex } = ctx;
      const firstRow = table.firstChild;
      if (!firstRow) break;
      const colCount = firstRow.childCount;

      // If only one column, delete the entire table
      if (colCount <= 1) {
        const tr = state.tr.delete(tablePos, tablePos + table.nodeSize);
        const para = state.schema.nodes['paragraph'].create();
        tr.insert(tablePos, para);
        tr.setSelection(Selection.near(tr.doc.resolve(tablePos + 1)));
        dispatch(tr);
        break;
      }

      // Delete the column cell from each row (in reverse to preserve positions)
      let tr = state.tr;
      const rows: { node: Node; pos: number }[] = [];
      table.forEach((row, offset) => {
        rows.push({ node: row, pos: tablePos + 1 + offset });
      });

      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        let targetCellPos = -1;
        let targetCellSize = 0;

        row.node.forEach((cell, off, idx) => {
          if (idx === colIndex) {
            targetCellPos = row.pos + 1 + off;
            targetCellSize = cell.nodeSize;
          }
        });

        if (targetCellPos >= 0) {
          tr = tr.delete(targetCellPos, targetCellPos + targetCellSize);
        }
      }

      tr.setSelection(
        Selection.near(tr.doc.resolve(Math.min(tablePos + 2, tr.doc.content.size - 1))),
      );
      dispatch(tr);
      break;
    }

    case 'deleteTable': {
      const ctx = findTableContext(state);
      if (!ctx) break;
      const { tablePos, table } = ctx;
      const tr = state.tr.delete(tablePos, tablePos + table.nodeSize);
      const para = state.schema.nodes['paragraph'].create();
      tr.insert(tablePos, para);
      tr.setSelection(Selection.near(tr.doc.resolve(tablePos + 1)));
      dispatch(tr);
      break;
    }

    // Alignment is handled via Milkdown's setAlignCommand in App.tsx
    case 'alignLeft':
    case 'alignCenter':
    case 'alignRight':
      break;
  }
  view.focus();
}

export const tablePlugin = $prose(() => {
  let wasInTable = false;

  function dispatchToolbarUpdate(visible: boolean) {
    document.dispatchEvent(
      new CustomEvent('table-toolbar-update', {
        detail: { visible },
      }),
    );
  }

  function checkTableState(view: EditorView) {
    const inTable = isInTable(view.state);

    if (inTable) {
      const { $from } = view.state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === 'table') {
          const tablePos = $from.before(d);
          const dom = view.nodeDOM(tablePos) as HTMLElement | null;
          if (dom) {
            activeTableEl = dom;
            dispatchToolbarUpdate(true);
          }
          break;
        }
      }
      wasInTable = true;
    } else if (wasInTable) {
      activeTableEl = null;
      dispatchToolbarUpdate(false);
      wasInTable = false;
    }
  }

  return new Plugin({
    key: tablePluginKey,
    props: {
      handleKeyDown: (view, event) => {
        if (event.key !== 'Tab') return false;
        if (!isInTable(view.state)) return false;
        event.preventDefault();

        const dir = event.shiftKey ? -1 : 1;

        if (goToNextCell(dir)(view.state, view.dispatch)) {
          return true;
        }

        // Tab at last cell of last row → add row and move into it
        if (dir === 1) {
          addRowAfter(view.state, view.dispatch);
          goToNextCell(1)(view.state, view.dispatch);
        }

        return true;
      },
      // DOM-level table detection — fires before ProseMirror fully
      // resolves the selection, so the toolbar appears on the very
      // first click instead of requiring two.
      handleDOMEvents: {
        mousedown: (_view, event) => {
          const target = event.target as HTMLElement;
          const tableEl = target.closest('table');
          if (tableEl && tableEl.closest('.ProseMirror')) {
            activeTableEl = tableEl as HTMLElement;
            dispatchToolbarUpdate(true);
            wasInTable = true;
          }
          return false;
        },
      },
    },
    view() {
      return {
        update(view) {
          checkTableState(view);
        },
        destroy() {
          if (wasInTable) {
            activeTableEl = null;
            dispatchToolbarUpdate(false);
          }
        },
      };
    },
  });
});
