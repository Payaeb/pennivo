/**
 * One-time reset of an unchosen saved editor font size.
 *
 * Versions up to 1.7.0 wrote `editorFontSize: 16` into settings.json whenever
 * any setting changed, although the real default is 17 and the value was only
 * applied once Settings had been opened. From 1.7.1 the saved size applies at
 * startup, so a never-chosen 16 would visibly shrink the text. The first launch
 * after updating turns a saved 16 into 17 and records this marker; afterwards a
 * deliberately chosen 16 is left alone for good.
 */

/** Settings key recording that the one-time migration has run. */
export const FONT_SIZE_MIGRATION_KEY = "fontSizeDefaultMigrated";

const OLD_DEFAULT_FONT_SIZE = 16;
const NEW_DEFAULT_FONT_SIZE = 17;

export interface FontSizeMigrationResult {
  /** The settings to use (the input object itself when nothing changed). */
  settings: Record<string, unknown>;
  /** True when `settings` differs from the input and must be persisted. */
  changed: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Pure decision logic. Only the boolean `true` counts as a present marker.
 *  - marker present: never touch anything
 *  - marker absent and editorFontSize === 16: set 17 and the marker
 *  - marker absent, any other editorFontSize (or none): keep it, set the marker
 *  - input that is not a plain object: returned unchanged, nothing to persist
 */
export function migrateUnchosenFontSize(
  settings: unknown,
): FontSizeMigrationResult {
  if (!isPlainObject(settings)) {
    return { settings: {}, changed: false };
  }
  if (settings[FONT_SIZE_MIGRATION_KEY] === true) {
    return { settings, changed: false };
  }
  const next: Record<string, unknown> = {
    ...settings,
    [FONT_SIZE_MIGRATION_KEY]: true,
  };
  if (settings.editorFontSize === OLD_DEFAULT_FONT_SIZE) {
    next.editorFontSize = NEW_DEFAULT_FONT_SIZE;
  }
  return { settings: next, changed: true };
}
