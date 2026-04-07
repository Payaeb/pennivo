Build a Kanban board view for the Pennivo markdown editor. Users should be able to insert a Kanban board, see a visual preview of columns and cards, and open a structured editor panel to manage the board — all stored as a fenced code block in the markdown.

## What to build

### 1. Kanban data model (core package)
Create `packages/core/src/kanban.ts` with types and parser/serializer:
- `KanbanCard` — id, title, description, columnId, labels, dueDate, order
- `KanbanColumn` — id, title, cards array
- `KanbanData` — title, columns array
- `parseKanbanMarkdown(code)` — parse YAML-like code block text → KanbanData
- `kanbanDataToMarkdown(data)` — serialize KanbanData → code block text
- `createDefaultKanbanData()` — returns a starter board (To Do / In Progress / Done with sample cards)
- `generateCardId()` — unique ID helper
- Export everything from `packages/core/src/index.ts`

### 2. Code block format
Use a fenced code block with language `kanban`:
````
```kanban
title: Project Board
columns:
  - id: todo
    title: To Do
  - id: in-progress
    title: In Progress
  - id: done
    title: Done
cards:
  - id: card-1
    column: todo
    title: Design homepage
    description: Create mockups
    labels: design, urgent
  - id: card-2
    column: in-progress
    title: Implement API
```
````

### 3. Preview widget in the editor
Extend `packages/ui/src/components/Editor/mermaidPlugin.ts`:
- Detect code blocks with `language='kanban'`
- Render a visual preview showing columns as horizontal blocks with card titles listed underneath (not a full interactive board — just a clean read-only preview)
- Add an "Edit Board" button (same pattern as the Gantt "Edit Chart" button)
- Button click dispatches `CustomEvent('kanban-edit-request', { detail: { pos, code, rect } })`

### 4. Kanban editor panel
Create `packages/ui/src/components/KanbanEditor/KanbanEditorPanel.tsx` + `.css`:
- Fixed-position overlay panel (follow the GanttEditorPanel pattern exactly)
- Width ~800px to fit horizontal column layout
- Header: "Kanban" label + board title input + close button
- Body: horizontal scrollable columns, each containing:
  - Column title (editable)
  - Cards stacked vertically (title, optional labels/due date)
  - "Add card" button at the bottom of each column
  - Delete column button
- Footer: "Add Column" button
- Drag-and-drop cards between columns (use native HTML5 drag API — no extra dependencies)
- Drag to reorder cards within a column
- Click a card to expand inline editing (title, description, labels, due date)
- Delete card button on each card
- Every change calls `onUpdate(data)` immediately (real-time sync to markdown)
- Close on Escape or click outside

### 5. Toolbar + command palette integration
- Add `'kanban'` to `ToolbarAction` type in `packages/ui/src/components/Toolbar/Toolbar.tsx`
- Add tooltip: `kanban: { label: 'Kanban Board' }`
- Add toolbar button with a 3-column icon (after the table button, in the same group)
- Add to command palette: `{ id: 'kanban', label: 'Insert Kanban Board', category: 'Format', keywords: 'kanban board column card task' }`

### 6. App.tsx wiring
Follow the exact same pattern as the Gantt editor (packages/ui/src/App.tsx lines 492–570):
- State: `kanbanEditor` with `{ data, lastCode, anchorRect }`
- Listen for `kanban-edit-request` CustomEvent → parse code → open panel
- `handleKanbanUpdate`: serialize data → find the kanban code block in ProseMirror doc → replace it via transaction
- `handleKanbanClose`: close panel, refocus editor
- In `handleAction('kanban')`: insert a code block with `createDefaultKanbanData()` serialized, then open the editor panel
- Render `<KanbanEditorPanel>` conditionally

## Current codebase context

- **Gantt editor** (the template to follow): `packages/ui/src/components/GanttEditor/GanttEditorPanel.tsx` — floating panel with structured data editing that syncs back to a mermaid code block. The mermaid plugin dispatches `gantt-edit-request` events, App.tsx listens and opens the panel.
- **Mermaid plugin**: `packages/ui/src/components/Editor/mermaidPlugin.ts` — scans for code blocks, renders previews as ProseMirror widget decorations, adds edit buttons. Gantt detection is at line ~154.
- **Core gantt module**: `packages/core/src/gantt.ts` — parser, serializer, types. Export pattern in `packages/core/src/index.ts`.
- **App.tsx**: lines 492–570 for gantt state/events/handlers. Lines 1063 for gantt toolbar action. Lines 1479 for gantt panel render.
- **Toolbar**: `packages/ui/src/components/Toolbar/Toolbar.tsx` — `ToolbarAction` type at line 4, tooltips at line 18, button groups at line 80+, icons at line 137+.
- **Design tokens**: `packages/ui/src/styles/tokens.css` — `--bg-surface`, `--border-mid`, `--accent`, `--radius-md`, `--font-ui`, etc. All colors auto-adapt to light/dark/sepia/nord/rosepine themes.
- **Gantt panel CSS**: `packages/ui/src/components/GanttEditor/GanttEditorPanel.css` — floating panel styling pattern (position fixed, z-index 1000, box-shadow, animation).

## Design direction

- Minimal, clean layout — Notion/Linear style, not Trello
- Columns as vertical lanes with subtle borders, cards as compact rounded blocks
- Card hover: subtle elevation or border accent
- Drag ghost: semi-transparent card outline
- Use CSS custom properties from tokens.css for all colors
- Entrance animation: same as gantt panel (fade + translateY)
- Keep it lightweight — no external drag-and-drop libraries

## Approach

Follow the CLAUDE.md testing loop: build → typecheck → launch app → verify visually → repeat. Do NOT ask me to test — use devtools yourself to verify.

Build in this order:
1. Core data model + parser/serializer with round-trip tests
2. Mermaid plugin extension (preview widget + edit button)
3. Kanban editor panel UI (columns, cards, add/delete)
4. Drag-and-drop (cards between columns + reorder within)
5. App.tsx wiring (state, events, toolbar action, render)
6. Polish (animations, responsive, edge cases)
