# Phase 6 — UX Polish

All core features, stability, testing, and visual polish are complete (Phases 1–5). This phase prepares the app for real users by adding the small but important UX touches that separate a project from a product.

Work through these in order. After each item, run `pnpm test` and `pnpm typecheck`. Launch the app and visually verify before moving to the next.

---

## 1. Window State Persistence

When the user closes and reopens Pennivo, the window should reappear exactly where they left it.

**Save on close:**
- Window position (x, y)
- Window size (width, height)
- Maximized state

**Restore on launch:**
- If saved state exists, use it
- If the saved position is off-screen (e.g., monitor was disconnected), fall back to centered default
- If maximized, restore maximized

**Implementation:**
- Store in a JSON file in `app.getPath('userData')` (e.g., `window-state.json`)
- Save on `close` event, not continuously
- Read before `new BrowserWindow()` to pass as constructor options

---

## 2. About Dialog

Accessible from the hamburger menu → Help → About Pennivo (or a dedicated "About" item).

**Content:**
- App name: Pennivo
- Version: read from `package.json`
- One-line description: "A markdown editor for writers"
- Copyright: © 2026 Paya Ebrahimi
- License: MIT
- Links: GitHub repo (clickable)
- The Pennivo logo (already exists as an asset)

**Implementation:**
- Use Electron's `dialog.showMessageBox` for simplicity, OR
- A custom modal in the renderer (more polished — preferred if time allows)
- If custom modal: overlay with backdrop blur, centered card, close on Escape/click-outside

---

## 3. App Metadata

Update `package.json` files with proper metadata for packaging:

**Root `package.json`:**
- `version`: "1.0.0"
- `description`: "A markdown editor for writers"
- `author`: "Paya Ebrahimi"
- `license`: "MIT"
- `homepage`: set to GitHub repo URL if available

**`packages/desktop/package.json`:**
- Same version, description, author, license
- `productName`: "Pennivo"

**`packages/ui/package.json` and `packages/core/package.json`:**
- Match version

---

## 4. Keyboard Shortcut Cheat Sheet

A quick-reference overlay showing all keyboard shortcuts.

**Trigger:** Ctrl+/ or Help menu → Keyboard Shortcuts

**Content — grouped by category:**

| Category | Shortcut | Action |
|----------|----------|--------|
| Formatting | Ctrl+B | Bold |
| | Ctrl+I | Italic |
| | Ctrl+K | Insert Link |
| File | Ctrl+N | New File |
| | Ctrl+O | Open File |
| | Ctrl+S | Save |
| | Ctrl+Shift+S | Save As |
| Navigation | Ctrl+Shift+P | Command Palette |
| | Ctrl+Shift+O | Outline Panel |
| | Ctrl+F | Find |
| View | Ctrl+Shift+F | Focus Mode |
| Export | Ctrl+Shift+E | Export HTML |

**Design:**
- Modal overlay (same pattern as About dialog)
- Two or three columns on wider screens, single column on narrow
- Shortcut keys rendered as `<kbd>` pill badges
- Close on Escape or click outside
- Subtle fade-in animation

---

## 5. Settings / Preferences Panel

A proper settings panel for user preferences.

**Trigger:** Hamburger menu → Settings, or Ctrl+, (comma)

**Settings to include:**

| Setting | Type | Options |
|---------|------|---------|
| Theme | Toggle | Light / Dark (already exists, wire it in) |
| Color scheme | Dropdown | Default, Sepia, Nord, Rose Pine |
| Editor font size | Slider or input | 12–24px, default 16 |
| Editor font family | Dropdown | System default, serif, monospace |
| Auto-save | Toggle | On/off, default on |
| Auto-save delay | Input | 1–10 seconds, default 3 |
| Spell check | Toggle | On/off (Electron's built-in) |
| Show word count | Toggle | On/off |
| Typewriter mode | Toggle | On/off |

**Persistence:** Save to `settings.json` in `app.getPath('userData')`. Load on startup, apply immediately. Expose via IPC so the renderer can read/write.

**Design:**
- Full-height panel (like VS Code settings), not a modal
- Grouped sections with headers
- Changes apply immediately (no "Save" button)
- Clean, spacious layout consistent with the app's aesthetic

---

## 6. First-Run Onboarding

Only shown on the very first launch (check for a `firstRun` flag in settings).

**Option A — Welcome Document (simpler):**
- Auto-open a bundled `welcome.md` file that demonstrates Pennivo's features
- Include headings, bold/italic, a table, a code block, a task list, a mermaid diagram
- Brief instructions at the top: "Welcome to Pennivo! This document showcases what you can do."
- User can edit it, save it, or dismiss it

**Option B — Tooltip Tour (more polished):**
- Highlight key UI areas: toolbar, sidebar, command palette shortcut, source mode toggle
- Step-by-step with "Next" / "Skip" buttons
- 4–5 steps max

Pick whichever fits better with the time available. Option A is faster to build and more useful as a reference.

---

## 7. Messaging Consistency Audit

The brand positioning has been finalized: **"Markdown, modernized."** with the supporting line *"Calm by default, customizable when you reach for it."* (See `docs/launch/marketing.md` for the full strategy — local only, do not commit.)

Audit and update every piece of user-facing copy in the app to align with this positioning. Anywhere the old "for writers" framing or generic "markdown editor" copy still appears, update it.

**Where to look:**

- `packages/desktop/package.json` → `description`, `productName`
- `packages/desktop/src/main.ts` (or wherever the main process is) → window title, native menu labels
- About dialog content (item 2 above) → tagline line, one-line description
- First-run welcome doc / onboarding copy (item 6 above) → opening sentence, body
- Empty states throughout the UI:
  - Editor with no file open
  - Sidebar with no folder open
  - Sidebar with no markdown files in folder
  - Search results panel (when added)
- Settings panel section headers and helper text
- Tooltips on toolbar buttons and menu items (review for tone consistency)
- Error messages and dialogs (file load errors, save errors, corrupted file warnings)
- Update prompts and notifications (Phase 7)
- Any README or in-app help content

**What to apply:**

- **Tagline**: "Markdown, modernized." (use as window title suffix, About dialog tagline, default empty state)
- **One-line description**: "The modern markdown editor for the way people write now — code, prompts, specs, docs, notes, and prose."
- **Voice rules**: confident not loud, no exclamation marks, no "powerful" / "blazing" / "amazing" / "revolutionary," speak to the work not the user
- **Avoid**: "for writers" framing, "distraction-free" as the *primary* claim, AI claims (until features ship)
- **Remove**: any leftover generic "A markdown editor for writers" descriptions in package metadata

**Specific updates to make:**

- Root `package.json` description → update to match new positioning (no "for writers")
- `packages/desktop/package.json` description → same
- About dialog (item 2 above) → use "Markdown, modernized." as the tagline line under the app name
- Welcome doc (item 6 Option A) → opening line should reflect new positioning
- Window title → consider "Pennivo — [filename]" or "[filename] — Pennivo" rather than including a tagline (keep the chrome calm)

**Do NOT touch:**

- The website (does not exist yet — covered separately in Phase 7)
- The GitHub README (covered in Phase 7 as part of repo polish)
- The marketing doc itself (it is the source of truth)

After updating all copy:
- Re-run the app and visit every screen / dialog / empty state listed above
- Verify nothing reads as "old" Pennivo (writer-focused, generic markdown editor) or as marketing-loud
- Make a list of any copy you were unsure about and present it for review before committing

---

## Testing Notes

After all items:
- `pnpm test` — all tests pass
- `pnpm typecheck` — clean
- Launch app, verify:
  1. Close and reopen — window position/size restored
  2. About dialog shows correct info and new tagline ("Markdown, modernized.")
  3. Ctrl+/ shows shortcut cheat sheet
  4. Settings panel opens, changes persist across restart
  5. First launch shows welcome content with on-brand copy (test by deleting the firstRun flag)
  6. Dark/light/sepia/Nord/Rose Pine themes all look correct with new UI
  7. Empty states (no file open, no folder open, no markdown files in folder) all use updated messaging
  8. Window title, package metadata, and tooltips reflect the new positioning
