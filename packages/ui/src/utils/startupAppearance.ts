// Applies persisted appearance settings (editor width, font size, font family)
// to <html> custom properties. The desktop entry point calls
// `applyStartupAppearance()` and only renders React afterwards, so the first
// style calculation already includes these values and nothing is written to
// the document after the editor has mounted. A post-mount write invalidates
// style for the whole tree while the editor is still starting up, which stalled
// the main thread long enough to drop the first keystrokes typed after launch.

import { getPlatform } from "../platform";
import { applyEditorWidth, migrateEditorWidth } from "./editorWidth";

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 24;

export const EDITOR_FONT_FAMILIES: Record<string, string> = {
  serif: '"Georgia", "Times New Roman", serif',
  "sans-serif": '"Segoe UI", system-ui, sans-serif',
  monospace: '"Cascadia Code", "Fira Code", "Consolas", monospace',
};

/** Returns a clamped integer size, or null when the stored value is unusable. */
export function migrateEditorFontSize(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(raw)));
}

export function applyEditorFontSize(
  size: unknown,
  root: HTMLElement = document.documentElement,
): void {
  const n = migrateEditorFontSize(size);
  if (n === null) return;
  const value = `${n}px`;
  if (root.style.getPropertyValue("--text-base") !== value) {
    root.style.setProperty("--text-base", value);
  }
}

export function applyEditorFontFamily(
  family: unknown,
  root: HTMLElement = document.documentElement,
): void {
  // Own keys only: "constructor" or "__proto__" must not resolve to a
  // prototype member.
  const key =
    typeof family === "string" &&
    Object.prototype.hasOwnProperty.call(EDITOR_FONT_FAMILIES, family)
      ? family
      : "serif";
  const value = EDITOR_FONT_FAMILIES[key]!;
  if (root.style.getPropertyValue("--font-editor") !== value) {
    root.style.setProperty("--font-editor", value);
  }
}

/** Apply every persisted appearance setting. Never throws. */
export function applyAppearanceSettings(
  saved: Record<string, unknown> | null | undefined,
  root: HTMLElement = document.documentElement,
): void {
  const s = saved ?? {};
  applyEditorWidth(migrateEditorWidth(s.editorWidth), root);
  if (s.editorFontSize !== undefined)
    applyEditorFontSize(s.editorFontSize, root);
  if (s.editorFontFamily !== undefined) {
    applyEditorFontFamily(s.editorFontFamily, root);
  }
}

/** Read settings and apply them. Resolves (never rejects) so rendering can follow. */
export async function applyStartupAppearance(): Promise<void> {
  try {
    const saved = await getPlatform().getSettings();
    applyAppearanceSettings(saved);
  } catch {
    // Settings unreadable: render with the stylesheet defaults.
  }
}
