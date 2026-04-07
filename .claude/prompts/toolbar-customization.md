Build toolbar customization for Pennivo. Users should be able to choose which formatting buttons appear in the toolbar, with sensible defaults. The setting should persist across sessions.

## What to build

### 1. Toolbar configuration data model
Create a toolbar config type and defaults:
- `ToolbarConfig` — ordered array of `ToolbarAction` IDs that are visible
- Default set: `bold`, `italic`, `strikethrough`, `h1`, `h2`, `bulletList`, `orderedList`, `taskList`, `blockquote`, `link`, `image`, `code`, `table`, `kanban`
- Right-side items (`sourceMode`, `toggleTheme`, `focusMode`) are always shown and not configurable
- Dividers between groups should be auto-inserted based on logical grouping

### 2. Persistence via Electron IPC
- Store toolbar config in `electron-store` or a JSON file in the app data directory (same pattern as other persisted settings if any exist)
- Add IPC channels: `toolbar-config:get`, `toolbar-config:set`
- Load config on app startup and pass to the renderer
- Save whenever the user changes the config
- If no saved config exists, use the default set

### 3. Toolbar customization UI
Create a "Customize Toolbar" panel/dialog:
- Accessible from: right-click context menu on the toolbar, and/or a menu item in the hamburger menu (Edit or View category), and/or command palette
- Two-column layout:
  - **Left: "Available"** — all toolbar actions not currently in the toolbar
  - **Right: "Toolbar"** — current toolbar items in order
- Each item shows its icon + label
- Drag to reorder items in the toolbar list
- Click to move items between available ↔ toolbar lists (or use add/remove buttons)
- "Reset to defaults" button
- Changes apply immediately (live preview in the toolbar behind the dialog)
- Close with Escape or close button

### 4. Toolbar component changes
- `Toolbar` component receives the ordered list of visible actions from config
- Render only the configured actions (in configured order)
- Groups/dividers are auto-determined based on action categories:
  - Text formatting: `bold`, `italic`, `strikethrough`
  - Headings: `h1`, `h2`
  - Lists/blocks: `bulletList`, `orderedList`, `taskList`, `blockquote`
  - Insert: `link`, `image`, `code`, `table`, `kanban`
- The existing overflow `⋯` menu should still work — it detects which configured items are clipped
- Right-click on toolbar → "Customize Toolbar…"

### 5. App.tsx / state wiring
- Load toolbar config on mount via IPC
- Pass config to `<Toolbar>`
- Handle config updates from the customization panel
- Save config changes via IPC
- Add "Customize Toolbar" to command palette

## Current codebase context

- **Toolbar**: `packages/ui/src/components/Toolbar/Toolbar.tsx` — `ToolbarAction` type (line 4), button rendering with `btn()` helper, overflow detection with ResizeObserver, `⋯` dropdown for hidden items. Groups are hardcoded in JSX.
- **Toolbar CSS**: `packages/ui/src/components/Toolbar/Toolbar.css` — includes overflow menu styles.
- **App.tsx**: Toolbar is rendered around line 1450+. `handleAction` callback processes all toolbar actions. Command palette commands defined around line 1300.
- **Electron main process**: `packages/desktop/src/main/main.ts` — IPC handlers, window management. Check existing persistence patterns (recent files, window state, etc.).
- **Preload**: `packages/desktop/src/preload/preload.ts` — exposes IPC to renderer via `window.pennivo`.
- **Design tokens**: `packages/ui/src/styles/tokens.css` — all colors/spacing via CSS custom properties.

## Design direction

- The customization panel should feel like VS Code's "Configure Status Bar" or Figma's toolbar settings — clean, minimal, not overwhelming
- Two-column card layout with drag handles
- Use existing design tokens and panel patterns (similar to GanttEditorPanel/KanbanEditorPanel floating panel style)
- Smooth transitions when items are added/removed from the toolbar

## Approach

Follow the CLAUDE.md testing loop: build → typecheck → launch app → verify visually → repeat. Do NOT ask me to test — use devtools yourself to verify.

Build in this order:
1. Persistence layer (Electron IPC + storage)
2. Toolbar config type + defaults
3. Toolbar component refactor to accept config
4. Customization panel UI
5. App.tsx wiring (load, save, open panel)
6. Command palette + context menu integration
7. Polish (drag reorder, animations, edge cases)
