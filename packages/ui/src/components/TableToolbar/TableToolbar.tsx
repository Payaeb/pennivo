import { useRef, useEffect, useReducer } from 'react';
import { getActiveTableElement, type TableAction } from '../Editor/tablePlugin';
import './TableToolbar.css';

interface TableToolbarProps {
  onAction: (action: TableAction) => void;
}

export function TableToolbar({ onAction }: TableToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const pos = (() => {
    const table = getActiveTableElement();
    const el = ref.current;
    if (!table || !el) return null;

    const rect = table.getBoundingClientRect();
    const toolbarW = el.offsetWidth || 300; // fallback for first render
    const toolbarH = el.offsetHeight || 34;

    // Minimum top = below the app titlebar + toolbar
    const editorArea = document.querySelector('.app-editor-area');
    const minTop = editorArea
      ? editorArea.getBoundingClientRect().top + 4
      : 80;

    let top = rect.top - toolbarH - 6;

    // If above the editor area, pin just below the app toolbar
    if (top < minTop) {
      top = minTop;
    }

    // If the pinned position overlaps the table bottom, hide
    // (table is scrolled mostly out of view)
    if (top > rect.bottom - 8) return null;

    let left = rect.left + (rect.width - toolbarW) / 2;

    // Clamp horizontally
    if (left < 8) left = 8;
    if (left + toolbarW > window.innerWidth - 8) {
      left = window.innerWidth - toolbarW - 8;
    }

    return { top, left };
  })();

  useEffect(() => {
    const scrollEl = document.querySelector('.app-editor-area');
    const handler = () => forceUpdate();
    scrollEl?.addEventListener('scroll', handler, { passive: true });
    window.addEventListener('resize', handler, { passive: true });
    return () => {
      scrollEl?.removeEventListener('scroll', handler);
      window.removeEventListener('resize', handler);
    };
  }, []);

  const btn = (action: TableAction, title: string, icon: React.ReactNode, className = '') => (
    <button
      className={`table-tb-btn ${className}`.trim()}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onAction(action)}
    >
      {icon}
    </button>
  );

  return (
    <div
      ref={ref}
      className="table-toolbar"
      style={pos ? { top: pos.top, left: pos.left, opacity: 1 } : { top: -9999, left: 0, opacity: 0 }}
    >
      <div className="table-tb-group">
        {btn('addRowAbove', 'Add row above', <RowAboveIcon />)}
        {btn('addRowBelow', 'Add row below', <RowBelowIcon />)}
        {btn('addColLeft', 'Add column left', <ColLeftIcon />)}
        {btn('addColRight', 'Add column right', <ColRightIcon />)}
      </div>
      <div className="table-tb-sep" />
      <div className="table-tb-group">
        {btn('deleteRow', 'Delete row', <DeleteRowIcon />, 'table-tb-btn--danger')}
        {btn('deleteCol', 'Delete column', <DeleteColIcon />, 'table-tb-btn--danger')}
      </div>
      <div className="table-tb-sep" />
      <div className="table-tb-group">
        {btn('alignLeft', 'Align left', <AlignLeftIcon />)}
        {btn('alignCenter', 'Align center', <AlignCenterIcon />)}
        {btn('alignRight', 'Align right', <AlignRightIcon />)}
      </div>
      <div className="table-tb-sep" />
      {btn('deleteTable', 'Delete table', <TrashIcon />, 'table-tb-btn--danger')}
    </div>
  );
}

/* ── Icons ── */

function RowAboveIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="8" width="12" height="5" rx="1" />
      <line x1="8" y1="8" x2="8" y2="13" />
      <line x1="8" y1="2" x2="8" y2="5.5" />
      <line x1="6.2" y1="3.8" x2="8" y2="2" />
      <line x1="9.8" y1="3.8" x2="8" y2="2" />
    </svg>
  );
}

function RowBelowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="3" width="12" height="5" rx="1" />
      <line x1="8" y1="3" x2="8" y2="8" />
      <line x1="8" y1="10.5" x2="8" y2="14" />
      <line x1="6.2" y1="12.2" x2="8" y2="14" />
      <line x1="9.8" y1="12.2" x2="8" y2="14" />
    </svg>
  );
}

function ColLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="6" y="2" width="8" height="12" rx="1" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="1" y1="8" x2="4" y2="8" />
      <line x1="2.8" y1="6.2" x2="1" y2="8" />
      <line x1="2.8" y1="9.8" x2="1" y2="8" />
    </svg>
  );
}

function ColRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="2" width="8" height="12" rx="1" />
      <line x1="2" y1="8" x2="10" y2="8" />
      <line x1="12" y1="8" x2="15" y2="8" />
      <line x1="13.2" y1="6.2" x2="15" y2="8" />
      <line x1="13.2" y1="9.8" x2="15" y2="8" />
    </svg>
  );
}

function DeleteRowIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="5" width="12" height="6" rx="1" />
      <line x1="6" y1="7" x2="10" y2="11" />
      <line x1="10" y1="7" x2="6" y2="11" />
    </svg>
  );
}

function DeleteColIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="5" y="2" width="6" height="12" rx="1" />
      <line x1="6.5" y1="6" x2="9.5" y2="10" />
      <line x1="9.5" y1="6" x2="6.5" y2="10" />
    </svg>
  );
}

function AlignLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="2" y1="8" x2="10" y2="8" />
      <line x1="2" y1="12" x2="12" y2="12" />
    </svg>
  );
}

function AlignCenterIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="4" y1="8" x2="12" y2="8" />
      <line x1="3" y1="12" x2="13" y2="12" />
    </svg>
  );
}

function AlignRightIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="4" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="4.5" x2="13" y2="4.5" />
      <path d="M5.5 4.5V3.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1" />
      <path d="M4.5 4.5l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8" />
    </svg>
  );
}
