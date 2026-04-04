# Pennivo - Claude Code Instructions

## Project Overview

Pennivo is a markdown editor for writers. Monorepo with three packages:
- `packages/core/` — Editor engine, framework-agnostic TypeScript
- `packages/ui/` — Shared React components (toolbar, editor, themes)
- `packages/desktop/` — Electron shell (file I/O, native menus, IPC)

## Tech Stack

- TypeScript, React 19, Vite, Electron
- WYSIWYG: Milkdown (ProseMirror + Remark based)
- Source editor: CodeMirror 6 (Phase 2)
- Testing: Vitest + React Testing Library
- Monorepo: pnpm workspaces

## Code Ownership

All code is owned solely by Paya Ebrahimi. Do NOT add "Co-Authored-By" lines or AI attribution in commits or source code.

## Quality Standards

### Testing Loop (mandatory for every feature)

1. Build the feature
2. Run unit tests (`pnpm test`)
3. Run full test suite across all packages
4. Launch the app (`pnpm dev`) and do visual UAT via Chrome browser automation
5. If anything fails: diagnose, fix, re-run. If stuck, enter plan mode.
6. Only commit when everything passes.

### Design Standards

- No generic or default-looking UI. Every component must be intentionally designed.
- Research design inspiration before building UI (Typora, iA Writer, Bear, Linear, Notion).
- Present design direction for approval before coding.
- Use CSS custom properties for all design tokens.

## Conventions

- Use functional React components with hooks
- Use CSS custom properties for theming (no CSS-in-JS libraries)
- Keep `core/` free of React or DOM dependencies
- Keep `core/` and `ui/` free of Electron/Node.js dependencies
- Prefer named exports over default exports
- Use absolute imports within each package (`@pennivo/core`, `@pennivo/ui`)

## Commands

```bash
pnpm dev          # Start desktop app in dev mode
pnpm build        # Build all packages
pnpm test         # Run all tests
pnpm lint         # Lint all source files
pnpm format       # Format with Prettier
pnpm typecheck    # Type-check all packages
```
