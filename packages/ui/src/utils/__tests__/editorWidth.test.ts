import { describe, it, expect, beforeEach } from "vitest";
import {
  applyEditorWidth,
  DEFAULT_EDITOR_WIDTH,
  EDITOR_WIDTH_PRESETS,
  EDITOR_WIDTH_VALUES,
  migrateEditorWidth,
} from "../editorWidth";

describe("migrateEditorWidth", () => {
  it("defaults to the default preset", () => {
    expect(DEFAULT_EDITOR_WIDTH).toBe("default");
    expect(migrateEditorWidth(undefined)).toBe("default");
  });

  it.each(EDITOR_WIDTH_PRESETS)("round-trips %s", (preset) => {
    expect(migrateEditorWidth(JSON.parse(JSON.stringify(preset)))).toBe(preset);
  });

  it.each([null, 42, {}, [], "", "huge", "WIDE", "constructor", "__proto__"])(
    "falls back to default for %j",
    (bad) => {
      expect(migrateEditorWidth(bad)).toBe("default");
    },
  );
});

describe("applyEditorWidth", () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty("--editor-max-width");
    document.documentElement.style.removeProperty("--editor-padding-h");
  });

  it("leaves the token alone for default so stylesheets and themes win", () => {
    applyEditorWidth("wide");
    applyEditorWidth("default");
    expect(
      document.documentElement.style.getPropertyValue("--editor-max-width"),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--editor-padding-h"),
    ).toBe("");
  });

  it.each(["narrow", "wide", "full"] as const)(
    "sets --editor-max-width for %s",
    (preset) => {
      applyEditorWidth(preset);
      expect(
        document.documentElement.style.getPropertyValue("--editor-max-width"),
      ).toBe(EDITOR_WIDTH_VALUES[preset]);
      expect(
        document.documentElement.style.getPropertyValue("--editor-padding-h"),
      ).toBe(preset === "full" ? "56px" : "");
    },
  );
});
