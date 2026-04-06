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

  // Observe scroll position to highlight active heading
  useEffect(() => {
    if (!visible || sourceMode) {
      setActiveIndex(-1);
      return;
    }

    const editorArea = document.querySelector('.app-editor-area');
    if (!editorArea) return;

    const updateActive = () => {
      // Find all heading elements in the ProseMirror editor
      // Try multiple selectors since Milkdown wraps as .milkdown > .editor > .ProseMirror
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
        <div className="outline-list">
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
