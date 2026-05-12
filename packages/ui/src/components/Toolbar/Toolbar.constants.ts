// Constants and types for Toolbar.
// Lives in a sibling file so Toolbar.tsx can stay component-only and satisfy
// react-refresh/only-export-components for fast refresh.

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
