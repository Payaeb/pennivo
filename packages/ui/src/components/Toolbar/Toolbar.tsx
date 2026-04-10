import { useState, useRef, useCallback, useEffect } from "react";
import "./Toolbar.css";

export type ToolbarAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "h1"
  | "h2"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "table"
  | "link"
  | "image"
  | "mermaid"
  | "gantt"
  | "kanban"
  | "code"
  | "typewriterMode"
  | "focusMode"
  | "toggleTheme"
  | "sourceMode";

/** Actions that can be customized (shown/hidden/reordered) */
export type ConfigurableAction = Exclude<
  ToolbarAction,
  "focusMode" | "toggleTheme" | "sourceMode"
>;

/** Category grouping for auto-divider insertion */
export const ACTION_CATEGORY: Record<ConfigurableAction, string> = {
  bold: "format",
  italic: "format",
  strikethrough: "format",
  h1: "heading",
  h2: "heading",
  bulletList: "list",
  orderedList: "list",
  taskList: "list",
  blockquote: "list",
  link: "insert",
  image: "insert",
  code: "insert",
  table: "insert",
  kanban: "insert",
  mermaid: "insert",
  gantt: "insert",
  typewriterMode: "mode",
};

/** All configurable actions in default order */
export const DEFAULT_TOOLBAR_CONFIG: ConfigurableAction[] = [
  "bold",
  "italic",
  "strikethrough",
  "h1",
  "h2",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "link",
  "image",
  "code",
  "table",
];

/** Complete set of all configurable actions (for the customizer "available" pool) */
export const ALL_CONFIGURABLE_ACTIONS: ConfigurableAction[] = [
  "bold",
  "italic",
  "strikethrough",
  "h1",
  "h2",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "link",
  "image",
  "code",
  "table",
  "kanban",
  "mermaid",
  "gantt",
  "typewriterMode",
];

interface TooltipInfo {
  label: string;
  shortcut?: string;
  syntax?: string;
}

export const TOOLTIP_DATA: Record<string, TooltipInfo> = {
  bold: { label: "Bold", shortcut: "Ctrl+B", syntax: "**text**" },
  italic: { label: "Italic", shortcut: "Ctrl+I", syntax: "*text*" },
  strikethrough: { label: "Strikethrough", syntax: "~~text~~" },
  h1: { label: "Heading 1", syntax: "# text" },
  h2: { label: "Heading 2", syntax: "## text" },
  bulletList: { label: "Bullet List", syntax: "- text" },
  orderedList: { label: "Ordered List", syntax: "1. text" },
  taskList: { label: "Task List", syntax: "- [ ] text" },
  blockquote: { label: "Blockquote", syntax: "> text" },
  table: { label: "Table", syntax: "| | |" },
  kanban: { label: "Kanban Board" },
  mermaid: { label: "Mermaid Diagram" },
  gantt: { label: "Gantt Chart" },
  link: { label: "Link", shortcut: "Ctrl+K", syntax: "[text](url)" },
  image: { label: "Image", syntax: "![alt](url)" },
  code: { label: "Code", syntax: "`inline` / ```block```" },
  typewriterMode: { label: "Typewriter Mode" },
  toggleTheme: { label: "Toggle Theme" },
  focusMode: { label: "Focus Mode", shortcut: "Ctrl+Shift+F" },
  sourceMode: { label: "Source Mode" },
};

interface ToolbarProps {
  activeFormats?: Set<ToolbarAction>;
  onAction?: (action: ToolbarAction) => void;
  sourceMode?: boolean;
  visibleActions?: ConfigurableAction[];
  onCustomize?: () => void;
}

export function Toolbar({
  activeFormats = new Set(),
  onAction,
  sourceMode = false,
  visibleActions,
  onCustomize,
}: ToolbarProps) {
  const [tooltip, setTooltip] = useState<{
    action: string;
    rect: DOMRect;
  } | null>(null);
  const [hiddenActions, setHiddenActions] = useState<Set<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  const [rovingIndex, setRovingIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leftRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Detect which buttons are clipped by overflow
  useEffect(() => {
    const container = leftRef.current;
    if (!container) return;
    const check = () => {
      const rect = container.getBoundingClientRect();
      const cutoff = rect.right;
      const hidden = new Set<string>();
      container.querySelectorAll<HTMLElement>(".tool-btn").forEach((btn) => {
        const btnRect = btn.getBoundingClientRect();
        if (btnRect.right > cutoff + 1) {
          const action = btn.getAttribute("aria-label");
          if (action) hidden.add(action);
        }
      });
      setHiddenActions(hidden);
    };
    const ro = new ResizeObserver(check);
    ro.observe(container);
    check();
    return () => ro.disconnect();
  }, []);

  // Close more dropdown on outside click
  useEffect(() => {
    if (!moreOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [moreOpen]);

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

  // Counter for roving tabIndex — reset each render
  let btnIndex = 0;
  const btn = (
    action: ToolbarAction,
    label: string,
    children: React.ReactNode,
    disabled = false,
  ) => {
    const idx = btnIndex++;
    return (
      <button
        key={action}
        className={`tool-btn${activeFormats.has(action) ? " tool-btn--active" : ""}${disabled ? " tool-btn--disabled" : ""}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!disabled) {
            onAction?.(action);
            hideTooltip();
          }
        }}
        tabIndex={idx === rovingIndex ? 0 : -1}
        aria-label={label}
        aria-pressed={activeFormats.has(action)}
        aria-disabled={disabled}
        onMouseEnter={(e) => showTooltip(action, e.currentTarget)}
        onMouseLeave={hideTooltip}
        onFocus={() => setRovingIndex(idx)}
      >
        {children}
      </button>
    );
  };

  const tip = TOOLTIP_DATA[tooltip?.action ?? ""];

  const d = sourceMode; // shorthand for disabled
  const config = visibleActions ?? DEFAULT_TOOLBAR_CONFIG;

  const allLeftItems: { action: ConfigurableAction; label: string }[] =
    config.map((a) => ({
      action: a,
      label: TOOLTIP_DATA[a]?.label ?? a,
    }));

  // aria-label → action lookup for hidden detection
  const labelToAction: Record<string, ConfigurableAction> = {};
  for (const item of allLeftItems) {
    labelToAction[item.label] = item.action;
  }

  const hiddenItems = allLeftItems.filter((item) => {
    for (const [ariaLabel, action] of Object.entries(labelToAction)) {
      if (action === item.action && hiddenActions.has(ariaLabel)) return true;
    }
    return false;
  });

  // Group config items by category and insert dividers between groups
  const groupedElements: React.ReactNode[] = [];
  let currentGroup: React.ReactNode[] = [];
  let lastCategory: string | null = null;
  let groupIdx = 0;

  for (const action of config) {
    const cat = ACTION_CATEGORY[action];
    if (lastCategory !== null && cat !== lastCategory) {
      if (currentGroup.length > 0) {
        groupedElements.push(
          <div className="toolbar-group" key={`g${groupIdx}`}>
            {currentGroup}
          </div>,
        );
        groupedElements.push(
          <div className="toolbar-divider" key={`d${groupIdx}`} />,
        );
        groupIdx++;
        currentGroup = [];
      }
    }
    currentGroup.push(renderActionButton(action, btn, d));
    lastCategory = cat;
  }
  if (currentGroup.length > 0) {
    groupedElements.push(
      <div className="toolbar-group" key={`g${groupIdx}`}>
        {currentGroup}
      </div>,
    );
  }

  // Roving tabIndex keyboard handler
  const handleToolbarKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const toolbar = toolbarRef.current;
      if (!toolbar) return;
      const buttons = Array.from(
        toolbar.querySelectorAll<HTMLElement>(".tool-btn"),
      );
      if (buttons.length === 0) return;

      let newIndex: number;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        newIndex = (rovingIndex + 1) % buttons.length;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        newIndex = (rovingIndex - 1 + buttons.length) % buttons.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        newIndex = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        newIndex = buttons.length - 1;
      } else {
        return;
      }
      setRovingIndex(newIndex);
      buttons[newIndex]?.focus();
    },
    [rovingIndex],
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onCustomize) return;
    e.preventDefault();
    onCustomize();
  };

  return (
    <div
      className="toolbar"
      role="toolbar"
      aria-label="Formatting"
      ref={toolbarRef}
      onKeyDown={handleToolbarKeyDown}
      onContextMenu={handleContextMenu}
    >
      <div className="toolbar-left" ref={leftRef}>
        {groupedElements}
      </div>

      {hiddenItems.length > 0 && (
        <div className="toolbar-more-wrap" ref={moreRef}>
          <button
            className={`tool-btn toolbar-more-btn${moreOpen ? " tool-btn--active" : ""}`}
            onClick={() => setMoreOpen((v) => !v)}
            onMouseDown={(e) => e.preventDefault()}
            tabIndex={-1}
            aria-label="More formatting"
            aria-expanded={moreOpen}
          >
            <MoreIcon />
          </button>
          {moreOpen && (
            <div className="toolbar-more-dropdown">
              {hiddenItems.map(({ action, label }) => (
                <button
                  key={action}
                  className={`toolbar-more-item${activeFormats.has(action) ? " toolbar-more-item--active" : ""}`}
                  onClick={() => {
                    onAction?.(action);
                    setMoreOpen(false);
                  }}
                  disabled={d}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="toolbar-spacer" />

      {btn("sourceMode", "Source mode", <SourceIcon />)}
      <div className="toolbar-divider" />
      {btn("toggleTheme", "Toggle theme", <ThemeIcon />)}
      {btn("focusMode", "Focus mode", <FocusIcon />)}

      {tooltip && tip && (
        <div
          className="toolbar-tooltip"
          style={{
            left: tooltip.rect.left + tooltip.rect.width / 2,
            top: tooltip.rect.top - 6,
          }}
        >
          <span className="toolbar-tooltip-label">{tip.label}</span>
          {tip.shortcut && (
            <span className="toolbar-tooltip-shortcut">{tip.shortcut}</span>
          )}
          {tip.syntax && (
            <span className="toolbar-tooltip-syntax">{tip.syntax}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Map action IDs to their icon elements and label for the btn() helper */
function renderActionButton(
  action: ConfigurableAction,
  btn: (
    action: ToolbarAction,
    label: string,
    children: React.ReactNode,
    disabled?: boolean,
  ) => React.ReactNode,
  disabled: boolean,
): React.ReactNode {
  switch (action) {
    case "bold":
      return btn("bold", "Bold", <b>B</b>, disabled);
    case "italic":
      return btn("italic", "Italic", <em>I</em>, disabled);
    case "strikethrough":
      return btn("strikethrough", "Strikethrough", <s>S</s>, disabled);
    case "h1":
      return btn(
        "h1",
        "Heading 1",
        <span className="tool-label-sm">H1</span>,
        disabled,
      );
    case "h2":
      return btn(
        "h2",
        "Heading 2",
        <span className="tool-label-sm">H2</span>,
        disabled,
      );
    case "bulletList":
      return btn("bulletList", "Bullet List", <BulletListIcon />, disabled);
    case "orderedList":
      return btn(
        "orderedList",
        "Ordered List",
        <span className="tool-label-sm">1.</span>,
        disabled,
      );
    case "taskList":
      return btn("taskList", "Task List", <TaskListIcon />, disabled);
    case "blockquote":
      return btn("blockquote", "Blockquote", <BlockquoteIcon />, disabled);
    case "link":
      return btn("link", "Link", <LinkIcon />, disabled);
    case "image":
      return btn("image", "Image", <ImageIcon />, disabled);
    case "code":
      return btn("code", "Code", <CodeIcon />, disabled);
    case "table":
      return btn("table", "Table", <TableIcon />, disabled);
    case "kanban":
      return btn("kanban", "Kanban Board", <KanbanIcon />, disabled);
    case "mermaid":
      return btn("mermaid", "Mermaid Diagram", <MermaidIcon />, disabled);
    case "gantt":
      return btn("gantt", "Gantt Chart", <GanttIcon />, disabled);
    case "typewriterMode":
      return btn("typewriterMode", "Typewriter Mode", <TypewriterIcon />);
    default:
      return null;
  }
}

function BulletListIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <circle cx="2.5" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="5.5" x2="14" y2="5.5" />
      <circle cx="2.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <line x1="6" y1="10.5" x2="14" y2="10.5" />
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
    >
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
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
    >
      <line x1="4" y1="4" x2="4" y2="12" />
      <line x1="7" y1="6.5" x2="13" y2="6.5" />
      <line x1="7" y1="9.5" x2="11" y2="9.5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5L7 4" />
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5L9 12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
      <path d="M2 10l3-2.5 2.5 2 2.5-3L14 10" />
      <circle cx="5.5" cy="7" r="1" fill="currentColor" stroke="none" />
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
    >
      <polyline points="5,5 2,8 5,11" />
      <polyline points="11,5 14,8 11,11" />
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
    <svg viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="13" cy="8" r="1.5" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.5" y="2.5" width="3.5" height="11" rx="0.8" />
      <rect x="6.25" y="2.5" width="3.5" height="8" rx="0.8" />
      <rect x="11" y="2.5" width="3.5" height="5.5" rx="0.8" />
    </svg>
  );
}

function ThemeIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
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
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3,6 3,3 6,3" />
      <polyline points="10,3 13,3 13,6" />
      <polyline points="13,10 13,13 10,13" />
      <polyline points="6,13 3,13 3,10" />
    </svg>
  );
}

function MermaidIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="2" width="4" height="3" rx="0.8" />
      <rect x="10" y="2" width="4" height="3" rx="0.8" />
      <rect x="6" y="11" width="4" height="3" rx="0.8" />
      <line x1="4" y1="5" x2="4" y2="8" />
      <line x1="12" y1="5" x2="12" y2="8" />
      <line x1="4" y1="8" x2="12" y2="8" />
      <line x1="8" y1="8" x2="8" y2="11" />
    </svg>
  );
}

function GanttIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="4" x2="9" y2="4" strokeWidth="2.5" />
      <line x1="4" y1="8" x2="12" y2="8" strokeWidth="2.5" />
      <line x1="3" y1="12" x2="7" y2="12" strokeWidth="2.5" />
    </svg>
  );
}

function TypewriterIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="3" width="12" height="7" rx="1.2" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" />
      <line x1="5" y1="7.5" x2="11" y2="7.5" />
      <line x1="4" y1="12.5" x2="12" y2="12.5" />
    </svg>
  );
}

function SourceIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5,3 2,8 5,13" />
      <polyline points="11,3 14,8 11,13" />
      <line x1="9.5" y1="2" x2="6.5" y2="14" />
    </svg>
  );
}
