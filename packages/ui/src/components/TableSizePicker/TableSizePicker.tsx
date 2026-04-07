import { useState, useRef, useEffect, useCallback } from 'react';
import './TableSizePicker.css';

interface TableSizePickerProps {
  anchorRect: { top: number; left: number; bottom: number };
  onSelect: (rows: number, cols: number) => void;
  onClose: () => void;
}

export function TableSizePicker({ anchorRect, onSelect, onClose }: TableSizePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ row: number; col: number } | null>(null);
  const [gridSize, setGridSize] = useState({ rows: 5, cols: 6 });

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use setTimeout to avoid catching the triggering click
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleCellHover = useCallback((row: number, col: number) => {
    setHover({ row, col });
    // Expand grid when hovering near edges
    setGridSize((prev) => ({
      rows: Math.max(prev.rows, Math.min(row + 2, 10)),
      cols: Math.max(prev.cols, Math.min(col + 2, 10)),
    }));
  }, []);

  const handleClick = useCallback(
    (row: number, col: number) => {
      onSelect(row + 1, col + 1);
    },
    [onSelect],
  );

  // Position below anchor, clamp to viewport
  const style: React.CSSProperties = {
    top: anchorRect.bottom + 4,
    left: anchorRect.left,
  };

  if (ref.current) {
    const w = ref.current.offsetWidth;
    if (anchorRect.left + w > window.innerWidth - 16) {
      style.left = window.innerWidth - w - 16;
    }
    if ((style.left as number) < 8) style.left = 8;
  }

  const label = hover ? `${hover.col + 1} × ${hover.row + 1}` : 'Select table size';

  return (
    <div
      ref={ref}
      className="table-size-picker"
      style={style}
      onMouseLeave={() => setHover(null)}
    >
      <div className="table-size-grid">
        {Array.from({ length: gridSize.rows }, (_, row) => (
          <div key={row} className="table-size-row">
            {Array.from({ length: gridSize.cols }, (_, col) => (
              <div
                key={col}
                className={`table-size-cell${
                  hover && row <= hover.row && col <= hover.col
                    ? ' table-size-cell--active'
                    : ''
                }`}
                onMouseEnter={() => handleCellHover(row, col)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleClick(row, col);
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="table-size-label">{label}</div>
    </div>
  );
}
