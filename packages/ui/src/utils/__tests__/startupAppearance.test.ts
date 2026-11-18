import { describe, it, expect, beforeEach } from "vitest";
import {
  applyAppearanceSettings,
  applyEditorFontFamily,
  applyEditorFontSize,
  migrateEditorFontSize,
} from "../startupAppearance";

const root = () => document.documentElement;

beforeEach(() => {
  for (const p of [
    "--text-base",
    "--font-editor",
    "--editor-max-width",
    "--editor-padding-h",
  ]) {
    root().style.removeProperty(p);
  }
});

describe("migrateEditorFontSize", () => {
  it("clamps and rounds, and rejects non-numbers", () => {
    expect(migrateEditorFontSize(20)).toBe(20);
    expect(migrateEditorFontSize(99)).toBe(24);
    expect(migrateEditorFontSize(2)).toBe(12);
    expect(migrateEditorFontSize(15.6)).toBe(16);
    for (const bad of ["20", NaN, Infinity, null, undefined, {}]) {
      expect(migrateEditorFontSize(bad)).toBeNull();
    }
  });
});

describe("applyAppearanceSettings", () => {
  it("applies saved font size, family and width", () => {
    applyAppearanceSettings({
      editorFontSize: 21,
      editorFontFamily: "monospace",
      editorWidth: "wide",
    });
    const s = root().style;
    expect(s.getPropertyValue("--text-base")).toBe("21px");
    expect(s.getPropertyValue("--font-editor")).toContain("Cascadia Code");
    expect(s.getPropertyValue("--editor-max-width")).toBe("960px");
  });

  it("leaves everything untouched when nothing is saved", () => {
    applyAppearanceSettings({});
    applyAppearanceSettings(undefined);
    const s = root().style;
    expect(s.getPropertyValue("--text-base")).toBe("");
    expect(s.getPropertyValue("--font-editor")).toBe("");
    expect(s.getPropertyValue("--editor-max-width")).toBe("");
  });

  it("ignores corrupt values", () => {
    applyAppearanceSettings({
      editorFontSize: "huge",
      editorFontFamily: 7,
      editorWidth: "gigantic",
    });
    const s = root().style;
    expect(s.getPropertyValue("--text-base")).toBe("");
    expect(s.getPropertyValue("--editor-max-width")).toBe("");
    // unknown family falls back to the serif stack
    expect(s.getPropertyValue("--font-editor")).toContain("Georgia");
  });
});

describe("prototype-named families", () => {
  it("fall back to the serif stack", () => {
    for (const f of ["constructor", "__proto__", "toString"]) {
      root().style.removeProperty("--font-editor");
      applyEditorFontFamily(f);
      expect(root().style.getPropertyValue("--font-editor")).toContain(
        "Georgia",
      );
    }
  });
});

describe("single helpers", () => {
  it("applyEditorFontSize / applyEditorFontFamily set the same properties the panel uses", () => {
    applyEditorFontSize(18);
    applyEditorFontFamily("sans-serif");
    expect(root().style.getPropertyValue("--text-base")).toBe("18px");
    expect(root().style.getPropertyValue("--font-editor")).toContain(
      "Segoe UI",
    );
  });
});
