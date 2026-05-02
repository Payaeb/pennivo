import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./ContextMenu.css";

export type ContextMenuEntry =
  | {
      type: "item";
      label: string;
      icon?: ReactNode;
      onClick: () => void;
      danger?: boolean;
      disabled?: boolean;
    }
  | { type: "separator" };

export interface ContextMenuProps {
  /** Viewport x position where the menu was triggered. */
  x: number;
  /** Viewport y position where the menu was triggered. */
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
  /** Optional ARIA label for the menu region. */
  ariaLabel?: string;
}

const VIEWPORT_PADDING = 8;

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number }>({
    top: y,
    left: x,
  });
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Indices of focusable (non-separator, non-disabled) items
  const focusableIndices = items
    .map((item, idx) => (item.type === "item" && !item.disabled ? idx : -1))
    .filter((i) => i >= 0);

  // Flip the menu to fit inside the viewport
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let nextLeft = x;
    let nextTop = y;
    if (x + rect.width > window.innerWidth - VIEWPORT_PADDING) {
      nextLeft = Math.max(VIEWPORT_PADDING, x - rect.width);
    }
    if (y + rect.height > window.innerHeight - VIEWPORT_PADDING) {
      nextTop = Math.max(VIEWPORT_PADDING, y - rect.height);
    }
    if (nextLeft !== position.left || nextTop !== position.top) {
      setPosition({ top: nextTop, left: nextLeft });
    }
    // Intentionally only on (x, y) change — not position; would loop otherwise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  // Close on outside click
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer attaching by one tick so the triggering click doesn't immediately
    // re-fire and close the menu we just opened
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointer);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [onClose]);

  // Auto-focus the menu so keyboard nav works immediately
  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const moveFocus = useCallback(
    (delta: 1 | -1) => {
      if (focusableIndices.length === 0) return;
      const currentSlot =
        focusedIndex < 0
          ? delta === 1
            ? -1
            : focusableIndices.length
          : focusableIndices.indexOf(focusedIndex);
      const nextSlot =
        (currentSlot + delta + focusableIndices.length) %
        focusableIndices.length;
      setFocusedIndex(focusableIndices[nextSlot]);
    },
    [focusableIndices, focusedIndex],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          moveFocus(1);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1);
          break;
        case "Home":
          e.preventDefault();
          if (focusableIndices.length > 0) setFocusedIndex(focusableIndices[0]);
          break;
        case "End":
          e.preventDefault();
          if (focusableIndices.length > 0) {
            setFocusedIndex(focusableIndices[focusableIndices.length - 1]);
          }
          break;
        case "Enter":
        case " ": {
          const item = items[focusedIndex];
          if (item && item.type === "item" && !item.disabled) {
            e.preventDefault();
            item.onClick();
            onClose();
          }
          break;
        }
      }
    },
    [focusableIndices, focusedIndex, items, moveFocus, onClose],
  );

  // Move DOM focus to the focused item button when index changes
  useEffect(() => {
    if (focusedIndex < 0 || !menuRef.current) return;
    const buttons = menuRef.current.querySelectorAll<HTMLButtonElement>(
      "[data-context-menu-index]",
    );
    for (const btn of buttons) {
      if (Number(btn.dataset.contextMenuIndex) === focusedIndex) {
        btn.focus();
        break;
      }
    }
  }, [focusedIndex]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={ariaLabel}
      tabIndex={-1}
      style={{ top: position.top, left: position.left }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, idx) => {
        if (item.type === "separator") {
          return (
            <div
              key={`sep-${idx}`}
              className="context-menu-separator"
              role="separator"
            />
          );
        }
        return (
          <button
            key={`item-${idx}-${item.label}`}
            type="button"
            role="menuitem"
            data-context-menu-index={idx}
            disabled={item.disabled}
            className={`context-menu-item${item.danger ? " context-menu-item--danger" : ""}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            onMouseEnter={() => setFocusedIndex(idx)}
          >
            {item.icon && (
              <span className="context-menu-item-icon">{item.icon}</span>
            )}
            <span className="context-menu-item-label">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
