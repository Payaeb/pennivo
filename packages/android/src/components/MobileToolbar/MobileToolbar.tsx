import { useState, useEffect, useCallback } from "react";
import "./MobileToolbar.css";

export type MobileToolbarAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "h1"
  | "h2"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "indent"
  | "outdent"
  | "code"
  | "blockquote"
  | "table";

interface MobileToolbarProps {
  onAction: (action: string) => void;
  activeFormats?: Set<string>;
  visible?: boolean;
}

/** Primary row actions (always visible) */
const PRIMARY_ACTIONS: {
  action: MobileToolbarAction;
  label: string;
  icon: React.ReactNode;
}[] = [
  { action: "bold", label: "Bold", icon: <b>B</b> },
  { action: "italic", label: "Italic", icon: <em>I</em> },
  { action: "strikethrough", label: "Strikethrough", icon: <s>S</s> },
  {
    action: "h1",
    label: "Heading 1",
    icon: <span className="mobile-toolbar__label-sm">H1</span>,
  },
  {
    action: "h2",
    label: "Heading 2",
    icon: <span className="mobile-toolbar__label-sm">H2</span>,
  },
  { action: "bulletList", label: "Bullet List", icon: <BulletListIcon /> },
  { action: "orderedList", label: "Ordered List", icon: <OrderedListIcon /> },
  { action: "taskList", label: "Task List", icon: <TaskListIcon /> },
  { action: "outdent", label: "Outdent", icon: <OutdentIcon /> },
  { action: "indent", label: "Indent", icon: <IndentIcon /> },
  { action: "code", label: "Code", icon: <CodeIcon /> },
];

/** Secondary row actions (visible when "More" is toggled) */
const SECONDARY_ACTIONS: {
  action: MobileToolbarAction;
  label: string;
  icon: React.ReactNode;
}[] = [
  { action: "blockquote", label: "Blockquote", icon: <BlockquoteIcon /> },
  { action: "table", label: "Table", icon: <TableIcon /> },
];

export function MobileToolbar({
  onAction,
  activeFormats = new Set(),
  visible = true,
}: MobileToolbarProps) {
  const [expanded, setExpanded] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Detect soft keyboard via Capacitor Keyboard plugin
  useEffect(() => {
    let showHandle: { remove: () => void } | undefined;
    let hideHandle: { remove: () => void } | undefined;
    let cancelled = false;

    (async () => {
      try {
        const { Keyboard } = await import("@capacitor/keyboard");
        if (cancelled) return;

        const showResult = await Keyboard.addListener(
          "keyboardWillShow",
          () => {
            setKeyboardVisible(true);
          },
        );
        const hideResult = await Keyboard.addListener(
          "keyboardWillHide",
          () => {
            setKeyboardVisible(false);
            setExpanded(false);
          },
        );

        if (cancelled) {
          showResult.remove();
          hideResult.remove();
        } else {
          showHandle = showResult;
          hideHandle = hideResult;
        }
      } catch {
        // Running in browser/dev -- keyboard detection not available
      }
    })();

    return () => {
      cancelled = true;
      showHandle?.remove();
      hideHandle?.remove();
    };
  }, []);

  const handleAction = useCallback(
    (action: string) => {
      onAction(action);
    },
    [onAction],
  );

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  if (!visible) return null;

  const toolbarClass = [
    "mobile-toolbar",
    keyboardVisible ? "mobile-toolbar--keyboard" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inList =
    activeFormats.has("bulletList") ||
    activeFormats.has("orderedList") ||
    activeFormats.has("taskList");

  const isIndentAction = (a: MobileToolbarAction) =>
    a === "indent" || a === "outdent";

  return (
    <div className={toolbarClass} role="toolbar" aria-label="Formatting">
      {/* Primary row */}
      <div className="mobile-toolbar__row">
        {PRIMARY_ACTIONS.map(({ action, label, icon }) => {
          const indentBtn = isIndentAction(action);
          const dimmed = indentBtn && !inList;
          return (
            <button
              key={`primary-${action}`}
              className={`mobile-toolbar__btn${activeFormats.has(action) ? " mobile-toolbar__btn--active" : ""}${dimmed ? " mobile-toolbar__btn--dimmed" : ""}`}
              onClick={() => handleAction(action)}
              onMouseDown={(e) => e.preventDefault()}
              aria-label={label}
              aria-pressed={indentBtn ? undefined : activeFormats.has(action)}
              aria-disabled={dimmed || undefined}
              type="button"
            >
              {icon}
            </button>
          );
        })}
        <button
          className={`mobile-toolbar__btn mobile-toolbar__btn-more${expanded ? " mobile-toolbar__btn--active" : ""}`}
          onClick={toggleExpanded}
          onMouseDown={(e) => e.preventDefault()}
          aria-label="More formatting options"
          aria-expanded={expanded}
          type="button"
        >
          <MoreIcon />
        </button>
      </div>

      {/* Secondary row (expanded) */}
      {expanded && (
        <div className="mobile-toolbar__row mobile-toolbar__row--secondary">
          {SECONDARY_ACTIONS.map(({ action, label, icon }) => (
            <button
              key={`secondary-${action}`}
              className={`mobile-toolbar__btn${activeFormats.has(action) ? " mobile-toolbar__btn--active" : ""}`}
              onClick={() => handleAction(action)}
              onMouseDown={(e) => e.preventDefault()}
                aria-label={label}
              aria-pressed={activeFormats.has(action)}
              type="button"
            >
              {icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline SVG icons — compact, matching the desktop toolbar style    */
/* ------------------------------------------------------------------ */

function BulletListIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="2.5" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="5.5" x2="14" y2="5.5" />
      <circle cx="2.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="10.5" x2="14" y2="10.5" />
    </svg>
  );
}

function OrderedListIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" stroke="none" aria-hidden="true">
      <text x="1" y="7" fontSize="6" fontWeight="700" fontFamily="sans-serif">
        1.
      </text>
      <rect x="6" y="4.5" width="8" height="1.5" rx="0.5" />
      <text
        x="1"
        y="12.5"
        fontSize="6"
        fontWeight="700"
        fontFamily="sans-serif"
      >
        2.
      </text>
      <rect x="6" y="10" width="8" height="1.5" rx="0.5" />
    </svg>
  );
}

function TaskListIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="4" width="4" height="4" rx="0.8" />
      <polyline points="2.5,6.2 3.3,7 4.8,5" />
      <line x1="8" y1="6" x2="14" y2="6" />
      <rect x="1.5" y="9.5" width="4" height="4" rx="0.8" />
      <line x1="8" y1="11.5" x2="14" y2="11.5" />
    </svg>
  );
}

function IndentIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="2" y1="3.5" x2="14" y2="3.5" />
      <line x1="7" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12.5" x2="14" y2="12.5" />
      <polyline points="2,6 4.5,8 2,10" fill="currentColor" stroke="none" />
    </svg>
  );
}

function OutdentIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="2" y1="3.5" x2="14" y2="3.5" />
      <line x1="7" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12.5" x2="14" y2="12.5" />
      <polyline points="6,6 3.5,8 6,10" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
    </svg>
  );
}

function BlockquoteIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="4" y1="4" x2="4" y2="12" />
      <line x1="7" y1="6.5" x2="13" y2="6.5" />
      <line x1="7" y1="9.5" x2="11" y2="9.5" />
    </svg>
  );
}

function TableIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
      <line x1="1.5" y1="10.5" x2="14.5" y2="10.5" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" />
      <line x1="10.5" y1="2.5" x2="10.5" y2="13.5" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}
