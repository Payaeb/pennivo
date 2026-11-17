// Editor column width presets. The chosen preset is stored in settings.json as
// `editorWidth` and applied by setting the single `--editor-max-width` custom
// property on <html>. "default" removes the inline override so the stylesheet
// token (and any theme override of it) stays in charge.

export const EDITOR_WIDTH_PRESETS = [
  "narrow",
  "default",
  "wide",
  "full",
] as const;

export type EditorWidth = (typeof EDITOR_WIDTH_PRESETS)[number];

export const DEFAULT_EDITOR_WIDTH: EditorWidth = "default";

export const EDITOR_WIDTH_LABELS: Record<EditorWidth, string> = {
  narrow: "Narrow",
  default: "Default",
  wide: "Wide",
  full: "Full",
};

/** Value written to `--editor-max-width`; null means "leave the token alone". */
export const EDITOR_WIDTH_VALUES: Record<EditorWidth, string | null> = {
  narrow: "560px",
  default: null,
  wide: "960px",
  full: "100%",
};

/** Unknown, missing or corrupt stored values fall back to Default. */
export function migrateEditorWidth(raw: unknown): EditorWidth {
  return typeof raw === "string" &&
    (EDITOR_WIDTH_PRESETS as readonly string[]).includes(raw)
    ? (raw as EditorWidth)
    : DEFAULT_EDITOR_WIDTH;
}

/** Side gutter used by Full so text never crowds the sidebar or window edge. */
export const FULL_WIDTH_GUTTER = "56px";

export function applyEditorWidth(
  preset: EditorWidth,
  root: HTMLElement = document.documentElement,
): void {
  const value = EDITOR_WIDTH_VALUES[preset];
  if (value === null) {
    root.style.removeProperty("--editor-max-width");
  } else {
    root.style.setProperty("--editor-max-width", value);
  }
  // Full gets a roomier gutter. Written only when it changes, so Default never
  // touches the document at startup.
  if (preset === "full") {
    root.style.setProperty("--editor-padding-h", FULL_WIDTH_GUTTER);
  } else {
    root.style.removeProperty("--editor-padding-h");
  }
}
