import { useState, useRef, useCallback } from 'react';
import './Toolbar.css';

export type ToolbarAction =
  | 'bold' | 'italic' | 'strikethrough'
  | 'h1' | 'h2'
  | 'bulletList' | 'orderedList' | 'taskList' | 'blockquote'
  | 'table'
  | 'link' | 'image' | 'mermaid' | 'code'
  | 'focusMode' | 'toggleTheme' | 'sourceMode';

interface TooltipInfo {
  label: string;
  shortcut?: string;
  syntax?: string;
}

const TOOLTIP_DATA: Record<string, TooltipInfo> = {
  bold:          { label: 'Bold',          shortcut: 'Ctrl+B',       syntax: '**text**' },
  italic:        { label: 'Italic',        shortcut: 'Ctrl+I',       syntax: '*text*' },
  strikethrough: { label: 'Strikethrough',                            syntax: '~~text~~' },
  h1:            { label: 'Heading 1',                                syntax: '# text' },
  h2:            { label: 'Heading 2',                                syntax: '## text' },
  bulletList:    { label: 'Bullet List',                              syntax: '- text' },
  orderedList:   { label: 'Ordered List',                             syntax: '1. text' },
  taskList:      { label: 'Task List',                                syntax: '- [ ] text' },
  blockquote:    { label: 'Blockquote',                               syntax: '> text' },
  table:         { label: 'Table',                                    syntax: '| | |' },
  link:          { label: 'Link',          shortcut: 'Ctrl+K',       syntax: '[text](url)' },
  image:         { label: 'Image',                                    syntax: '![alt](url)' },
  code:          { label: 'Code',                                      syntax: '`inline` / ```block```' },
  toggleTheme:   { label: 'Toggle Theme' },
  focusMode:     { label: 'Focus Mode',    shortcut: 'Ctrl+Shift+F' },
  sourceMode:    { label: 'Source Mode' },
};

interface ToolbarProps {
  activeFormats?: Set<ToolbarAction>;
  onAction?: (action: ToolbarAction) => void;
  sourceMode?: boolean;
}

export function Toolbar({ activeFormats = new Set(), onAction, sourceMode = false }: ToolbarProps) {
  const [tooltip, setTooltip] = useState<{ action: string; rect: DOMRect } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showTooltip = useCallback((action: string, el: HTMLElement) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTooltip({ action, rect: el.getBoundingClientRect() });
    }, 400);
  }, []);

  const hideTooltip = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltip(null);
  }, []);

  const btn = (action: ToolbarAction, label: string, children: React.ReactNode, disabled = false) => (
    <button
      key={action}
      className={`tool-btn${activeFormats.has(action) ? ' tool-btn--active' : ''}${disabled ? ' tool-btn--disabled' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => { if (!disabled) { onAction?.(action); hideTooltip(); } }}
      tabIndex={-1}
      aria-label={label}
      aria-pressed={activeFormats.has(action)}
      aria-disabled={disabled}
      onMouseEnter={(e) => showTooltip(action, e.currentTarget)}
      onMouseLeave={hideTooltip}
    >
      {children}
    </button>
  );

  const tip = TOOLTIP_DATA[tooltip?.action ?? ''];

  const d = sourceMode; // shorthand for disabled

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <div className="toolbar-group">
        {btn('bold',          'Bold',          <b>B</b>, d)}
        {btn('italic',        'Italic',        <em>I</em>, d)}
        {btn('strikethrough', 'Strikethrough', <s>S</s>, d)}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {btn('h1', 'Heading 1', <span className="tool-label-sm">H1</span>, d)}
        {btn('h2', 'Heading 2', <span className="tool-label-sm">H2</span>, d)}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {btn('bulletList',   'Bullet list',   <BulletListIcon />, d)}
        {btn('orderedList',  'Ordered list',  <span className="tool-label-sm">1.</span>, d)}
        {btn('taskList',     'Task list',     <TaskListIcon />, d)}
        {btn('blockquote',   'Blockquote',    <BlockquoteIcon />, d)}
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        {btn('link',  'Link',       <LinkIcon />, d)}
        {btn('image', 'Image',      <ImageIcon />, d)}
        {btn('code',  'Code',       <CodeIcon />, d)}
        {btn('table', 'Table',      <TableIcon />, d)}
      </div>

      <div className="toolbar-spacer" />

      {btn('sourceMode', 'Source mode', <SourceIcon />)}
      <div className="toolbar-divider" />
      {btn('toggleTheme', 'Toggle theme', <ThemeIcon />)}
      {btn('focusMode',   'Focus mode',   <FocusIcon />)}

      {tooltip && tip && (
        <div
          className="toolbar-tooltip"
          style={{
            left: tooltip.rect.left + tooltip.rect.width / 2,
            top: tooltip.rect.top - 6,
          }}
        >
          <span className="toolbar-tooltip-label">{tip.label}</span>
          {tip.shortcut && <span className="toolbar-tooltip-shortcut">{tip.shortcut}</span>}
          {tip.syntax && <span className="toolbar-tooltip-syntax">{tip.syntax}</span>}
        </div>
      )}
    </div>
  );
}

function BulletListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <circle cx="2.5" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="5.5" x2="14" y2="5.5" />
      <circle cx="2.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="10.5" x2="14" y2="10.5" />
    </svg>
  );
}

function TaskListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="4" width="4" height="4" rx="0.8" />
      <polyline points="2.5,6.2 3.3,7 4.8,5" />
      <line x1="8" y1="6" x2="14" y2="6" />
      <rect x="1.5" y="9.5" width="4" height="4" rx="0.8" />
      <line x1="8" y1="11.5" x2="14" y2="11.5" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="4" y1="4" x2="4" y2="12" />
      <line x1="7" y1="6.5" x2="13" y2="6.5" />
      <line x1="7" y1="9.5" x2="11" y2="9.5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2 10l3-2.5 2.5 2 2.5-3L14 10" />
      <circle cx="5.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
      <line x1="1.5" y1="10.5" x2="14.5" y2="10.5" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
      <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="3" />
      <line x1="8" y1="1.5" x2="8" y2="3" />
      <line x1="8" y1="13" x2="8" y2="14.5" />
      <line x1="1.5" y1="8" x2="3" y2="8" />
      <line x1="13" y1="8" x2="14.5" y2="8" />
      <line x1="3.5" y1="3.5" x2="4.5" y2="4.5" />
      <line x1="11.5" y1="11.5" x2="12.5" y2="12.5" />
      <line x1="12.5" y1="3.5" x2="11.5" y2="4.5" />
      <line x1="4.5" y1="11.5" x2="3.5" y2="12.5" />
    </svg>
  );
}

function FocusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,6 3,3 6,3" />
      <polyline points="10,3 13,3 13,6" />
      <polyline points="13,10 13,13 10,13" />
      <polyline points="6,13 3,13 3,10" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5,3 2,8 5,13" />
      <polyline points="11,3 14,8 11,13" />
      <line x1="9.5" y1="2" x2="6.5" y2="14" />
    </svg>
  );
}
