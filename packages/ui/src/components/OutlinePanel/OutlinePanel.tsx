import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import './OutlinePanel.css';

export interface HeadingEntry {
  level: number;
  text: string;
  /** Unique id for scrolling — used differently per mode */
  index: number;
}

interface OutlinePanelProps {
  visible: boolean;
  markdown: string;
  sourceMode: boolean;
  onHeadingClick: (heading: HeadingEntry) => void;
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 320;
const DEFAULT_WIDTH = 200;

/** Extract headings from raw markdown text */
function extractHeadings(markdown: string): HeadingEntry[] {
  const headings: HeadingEntry[] = [];
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  let headingIndex = 0;

  for (const line of lines) {
    // Track fenced code blocks
    if (/^```/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/\s+#+\s*$/, '').trim(), // Strip trailing hashes
        index: headingIndex++,
      });
    }
  }

  return headings;
}

export function OutlinePanel({
  visible,
  markdown,
  sourceMode,
  onHeadingClick,
}: OutlinePanelProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const headings = useMemo(() => extractHeadings(markdown), [markdown]);

  // Find the minimum heading level to normalize indentation
  const minLevel = useMemo(
    () => (headings.length > 0 ? Math.min(...headings.map(h => h.level)) : 1),
    [headings],
  );

  // Track which heading is "active" based on scroll position
  const [activeIndex, setActiveIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the outline list to keep the active item visible
  useEffect(() => {
    if (activeIndex < 0 || !listRef.current) return;
    const activeEl = listRef.current.querySelector('.outline-item--active') as HTMLElement | null;
    if (!activeEl) return;

    const list = listRef.current;
    const itemTop = activeEl.offsetTop;
    const itemBottom = itemTop + activeEl.offsetHeight;
    const listScrollTop = list.scrollTop;
    const listHeight = list.clientHeight;

    // Scroll into view if outside visible area with some padding
    if (itemTop < listScrollTop + 8) {
      list.scrollTo({ top: Math.max(0, itemTop - 8), behavior: 'smooth' });
    } else if (itemBottom > listScrollTop + listHeight - 8) {
      list.scrollTo({ top: itemBottom - listHeight + 8, behavior: 'smooth' });
    }
  }, [activeIndex]);

  // Observe scroll position to highlight active heading (WYSIWYG mode)
  useEffect(() => {
    if (!visible || sourceMode) return;

    const editorArea = document.querySelector('.app-editor-area');
    if (!editorArea) return;

    const updateActive = () => {
      const editorEl = document.querySelector('.ProseMirror') || document.querySelector('.editor-wrapper');
      if (!editorEl) return;

      const headingEls = editorEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
      if (headingEls.length === 0) return;

      const areaRect = editorArea.getBoundingClientRect();
      const threshold = areaRect.top + 80;

      let active = -1;
      headingEls.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold) {
          active = i;
        }
      });
      setActiveIndex(active);
    };

    editorArea.addEventListener('scroll', updateActive, { passive: true });
    updateActive();

    return () => {
      editorArea.removeEventListener('scroll', updateActive);
    };
  }, [visible, sourceMode, headings]);

  // Observe scroll position to highlight active heading (Source mode)
  // CM6 virtualizes its DOM — only visible lines exist as elements.
  // Use scroll fraction mapped to heading line positions instead.
  const headingLineNumbers = useMemo(() => {
    const lines = markdown.split('\n');
    const positions: number[] = [];
    let inCodeBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^```/.test(lines[i].trimStart())) { inCodeBlock = !inCodeBlock; continue; }
      if (inCodeBlock) continue;
      if (/^#{1,6}\s+/.test(lines[i])) positions.push(i);
    }
    return positions;
  }, [markdown]);

  useEffect(() => {
    if (!visible || !sourceMode) return;

    const cmScroller = document.querySelector('.source-editor-wrapper .cm-scroller') as HTMLElement | null;
    if (!cmScroller) return;

    const totalLines = markdown.split('\n').length;
    if (totalLines <= 1 || headingLineNumbers.length === 0) return;

    const updateActive = () => {
      const maxScroll = cmScroller.scrollHeight - cmScroller.clientHeight;
      if (maxScroll <= 0) { setActiveIndex(headingLineNumbers.length > 0 ? 0 : -1); return; }

      const scrollFraction = cmScroller.scrollTop / maxScroll;
      // Map scroll fraction to a line number
      const currentLine = scrollFraction * (totalLines - 1);

      let active = -1;
      for (let i = 0; i < headingLineNumbers.length; i++) {
        if (headingLineNumbers[i] <= currentLine + 2) {
          active = i;
        } else {
          break;
        }
      }
      setActiveIndex(active);
    };

    cmScroller.addEventListener('scroll', updateActive, { passive: true });
    const timer = setTimeout(updateActive, 100);

    return () => {
      cmScroller.removeEventListener('scroll', updateActive);
      clearTimeout(timer);
    };
  }, [visible, sourceMode, headings, headingLineNumbers, markdown]);

  // Resize logic
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startWidth = panelRef.current?.offsetWidth ?? DEFAULT_WIDTH;

    const handleMouseMove = (me: MouseEvent) => {
      // Dragging left edge, so invert
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth - (me.clientX - startX)));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  if (!visible) return null;

  return (
    <div className="outline-panel" ref={panelRef} style={{ width }}>
      <div
        className={`outline-resize-handle${resizing ? ' outline-resize-handle--active' : ''}`}
        onMouseDown={handleResizeStart}
      />
      <div className="outline-header">
        <span className="outline-title">Outline</span>
      </div>
      {headings.length > 0 ? (
        <div className="outline-list" ref={listRef}>
          {headings.map((h, i) => (
            <button
              key={`${h.index}-${h.text}`}
              className={`outline-item${activeIndex === i ? ' outline-item--active' : ''}`}
              style={{ paddingLeft: 12 + (h.level - minLevel) * 16 }}
              onClick={() => onHeadingClick(h)}
              title={h.text}
            >
              <span className="outline-item-indicator" data-level={h.level}>
                H{h.level}
              </span>
              <span className="outline-item-text">{h.text}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="outline-empty">
          <span className="outline-empty-text">No headings found</span>
          <span className="outline-empty-hint">
            Use # Heading syntax to create an outline
          </span>
        </div>
      )}
    </div>
  );
}
