import { describe, it, expect } from "vitest";
import {
  FONT_SIZE_MIGRATION_KEY as KEY,
  migrateUnchosenFontSize,
} from "../fontSizeMigration";

describe("migrateUnchosenFontSize", () => {
  it("marker absent and 16 becomes 17 with the marker", () => {
    const r = migrateUnchosenFontSize({ editorFontSize: 16, autoSave: false });
    expect(r.changed).toBe(true);
    expect(r.settings).toEqual({
      editorFontSize: 17,
      autoSave: false,
      [KEY]: true,
    });
  });

  it("marker absent and another size keeps it and sets the marker", () => {
    const r = migrateUnchosenFontSize({ editorFontSize: 20 });
    expect(r.changed).toBe(true);
    expect(r.settings).toEqual({ editorFontSize: 20, [KEY]: true });
  });

  it("marker absent and no size keeps none and sets the marker", () => {
    const r = migrateUnchosenFontSize({ autoSave: true });
    expect(r.changed).toBe(true);
    expect(r.settings).toEqual({ autoSave: true, [KEY]: true });
    expect("editorFontSize" in r.settings).toBe(false);
  });

  it("marker present never touches the value", () => {
    const input = { editorFontSize: 16, [KEY]: true };
    const r = migrateUnchosenFontSize(input);
    expect(r.changed).toBe(false);
    expect(r.settings).toBe(input);
    expect(r.settings.editorFontSize).toBe(16);
  });

  it("is idempotent", () => {
    const first = migrateUnchosenFontSize({ editorFontSize: 16 });
    const second = migrateUnchosenFontSize(first.settings);
    expect(second.changed).toBe(false);
    expect(second.settings.editorFontSize).toBe(17);
  });

  it("does not mutate its input", () => {
    const input = { editorFontSize: 16 };
    migrateUnchosenFontSize(input);
    expect(input).toEqual({ editorFontSize: 16 });
  });

  it("treats 16.0 as 16", () => {
    expect(migrateUnchosenFontSize({ editorFontSize: 16.0 }).settings).toEqual({
      editorFontSize: 17,
      [KEY]: true,
    });
  });

  it('leaves the string "16" alone but sets the marker', () => {
    const r = migrateUnchosenFontSize({ editorFontSize: "16" });
    expect(r.settings).toEqual({ editorFontSize: "16", [KEY]: true });
  });

  it("leaves null alone but sets the marker", () => {
    const r = migrateUnchosenFontSize({ editorFontSize: null });
    expect(r.settings).toEqual({ editorFontSize: null, [KEY]: true });
  });

  it("only the boolean true counts as a present marker", () => {
    for (const bad of ["true", 1, false, null, {}]) {
      const r = migrateUnchosenFontSize({ editorFontSize: 16, [KEY]: bad });
      expect(r.changed).toBe(true);
      expect(r.settings).toEqual({ editorFontSize: 17, [KEY]: true });
    }
  });

  it("non-object input is not changed or persisted", () => {
    for (const bad of [null, undefined, 123, "text", [], [16]]) {
      const r = migrateUnchosenFontSize(bad);
      expect(r.changed).toBe(false);
      expect(r.settings).toEqual({});
    }
  });
});
