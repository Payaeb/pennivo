# Phase 10 — Android Shell & Basic Editing (Orchestrator)

## Your Role

You are the **orchestrator** for Phase 10 of the Pennivo Android app. You do NOT write code yourself. You break work into tasks and delegate each to a sub-agent using the Agent tool. You track progress, review results, make decisions, and handle issues.

## Context Management Rules (CRITICAL)

1. Run `/context` after every 2-3 agent completions to check usage
2. After **50% context**: finish the current in-flight task, do NOT start new agent delegations
3. After **60% context**: stop all work, write a handoff prompt at `.claude/prompts/phase10-handoff.md` with:
   - What tasks are done
   - What tasks remain
   - Any issues or decisions discovered
   - The exact prompt to start the next session
4. Tell the user: "Context is at X%. Here's the handoff prompt to continue in a new session."
5. NEVER start a new agent past 50% — the risk of losing work mid-task is too high

## Project Context

Pennivo is a markdown editor. Monorepo with packages: `core/` (pure TS), `ui/` (React components), `desktop/` (Electron shell), `android/` (Capacitor shell — PoC exists).

**Tech stack:** TypeScript, React 19, Milkdown (ProseMirror), CodeMirror 6, Capacitor 7.
**Android PoC status:** Working. Milkdown + CodeMirror run in Capacitor WebView. APK builds. All tests pass.

Read these files first (use agents or read directly):
- `CLAUDE.md` — project conventions, commands, quality standards
- `docs/android-plan.md` — full Android design document (sections 1-9)
- `packages/android/src/PocApp.tsx` — current PoC app component
- `packages/android/capacitor.config.ts` — Capacitor configuration
- `packages/ui/src/App.tsx` — desktop app (reference for what `window.pennivo.*` calls exist)
- `packages/desktop/src/main/main.ts` — Electron main process (reference for IPC handlers)
- `packages/desktop/src/main/preload.ts` — contextBridge API (the interface to abstract)

## Phase 10 Goal

**From PoC to functional editor.** The user can open the app, write markdown, save it, and reopen it. No file browser, no multi-file — just one-file editing that actually persists.

## Tasks (execute in this order)

### Task 1: Platform Abstraction Interface
Create `packages/ui/src/platform/platform.ts` with a `PennivoPlatform` interface that covers the API surface currently exposed by Electron's `contextBridge` (`window.pennivo.*`). Then create two implementations:
- `packages/ui/src/platform/electronPlatform.ts` — wraps existing `window.pennivo.*` calls (drop-in, no behavior change for desktop)
- `packages/ui/src/platform/capacitorPlatform.ts` — implements using Capacitor plugins (@capacitor/filesystem, @capacitor/preferences)
- `packages/ui/src/platform/index.ts` — auto-detects platform and exports the right implementation

**Important:** Start with only the methods needed for Phase 10 (open, save, save-as, read settings, write settings, get recent files). Don't over-build.

**Acceptance criteria:**
- Desktop app works exactly as before (no behavior change)
- `pnpm build && pnpm test` passes for all packages
- Interface is clean and typed

### Task 2: Wire Platform Layer into UI
Update `packages/ui/src/App.tsx` to use the platform abstraction instead of direct `window.pennivo.*` calls. This is a refactor — desktop behavior must not change.

**Acceptance criteria:**
- Desktop app works identically (open, save, save-as, recent files, settings all work)
- All 226+ tests pass
- No `window.pennivo` references remain in `@pennivo/ui` (they're in `electronPlatform.ts` only)

### Task 3: Capacitor File I/O
Implement the Capacitor platform backend (`capacitorPlatform.ts`) using:
- `@capacitor/filesystem` for read/write to app-specific directory
- `@capacitor/preferences` for settings and recent files
- Auto-save logic (same timer approach as desktop, writes to Capacitor Filesystem)

Install any needed Capacitor plugins (`pnpm add` in the android package).

**Acceptance criteria:**
- `capacitorPlatform.ts` compiles and handles open/save/auto-save
- Android web build passes (`pnpm --filter @pennivo/android build`)

### Task 4: Mobile App Shell
Replace `PocApp.tsx` with a real app entry point that:
- Uses the platform abstraction layer
- Shows single-pane editor (full width, no sidebar)
- Has a minimal header (file name, save status indicator)
- Follows system dark/light theme
- Auto-saves on edit (debounced)
- Loads last-opened file on app start (or welcome doc on first run)

**Acceptance criteria:**
- Android web build passes
- Capacitor sync succeeds (`npx cap sync android`)
- Gradle build produces APK

### Task 5: Mobile Toolbar
Build a horizontally scrollable formatting toolbar that sits above the soft keyboard:
- Single row: Bold, Italic, Heading, List (bullet), List (ordered), Checkbox, Link, Code, Image, More (...)
- "More" expands to show remaining actions
- Uses Capacitor Keyboard plugin to detect keyboard show/hide
- Toolbar visible when keyboard is open, hidden (or collapsed) when closed
- Touch-friendly button size (44px minimum tap targets)

**Acceptance criteria:**
- Toolbar renders and is usable on mobile viewport (Chrome DevTools device mode is fine for now)
- Android build passes

### Task 6: Full Build & Test
- Run `pnpm build` (all packages)
- Run `pnpm test` (all packages)
- Run `pnpm typecheck` (all packages)
- Run `pnpm lint` (all packages)
- Run Capacitor sync + Gradle build
- Verify APK size is reasonable (< 20MB)

**Acceptance criteria:**
- Everything green
- No regressions in desktop app

## How to Delegate

For each task, spawn an Agent with:
- A clear brief explaining what to build, which files to read/modify, and acceptance criteria
- Enough context that the agent can work independently
- Instruction to run builds/tests before reporting back

Example:
```
Agent({
  description: "Platform abstraction layer",
  prompt: "Build the platform abstraction for Pennivo. [detailed brief with file paths, interface shape, what to test]..."
})
```

Run independent tasks in parallel when possible (e.g., Task 5 could run in parallel with Task 4 if Task 3 is done).

## Quality Standards

- Every agent must run `pnpm build && pnpm test` before reporting back
- No regressions to desktop app — this is a refactor, not a rewrite
- Use CSS custom properties for all styling (no hardcoded colors)
- Keep `@pennivo/core` free of platform-specific code
- Keep `@pennivo/ui` free of direct Electron or Capacitor imports (those go in platform implementations)
- Named exports, functional React components, hooks

## Code Ownership

All code is owned solely by Paya Ebrahimi. Do NOT add "Co-Authored-By" lines or AI attribution in commits or source code.
