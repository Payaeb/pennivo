import { describe, it, expect } from "vitest";
import { detectDueTrigger } from "../dueDatePickerPlugin";

describe("detectDueTrigger — fresh trigger", () => {
  it("triggers right after `[due::` with no space yet", () => {
    const text = "Pay rent [due::";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toEqual({ from: text.indexOf("["), to: cursorOffset });
  });

  it("triggers with a space after the `::`", () => {
    const text = "Pay rent [due:: ";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toEqual({ from: text.indexOf("["), to: cursorOffset });
  });

  it("tolerates extra inner whitespace around `due` and `::`, same as DUE_FIELD_RE", () => {
    const text = "Pay rent [  due  ::  ";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toEqual({ from: text.indexOf("["), to: cursorOffset });
  });
});

describe("detectDueTrigger — mid-token cursor (type-through)", () => {
  it("keeps triggering while the user hand-types digits after `::`", () => {
    const text = "Pay rent [due:: 2026-10";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toEqual({ from: text.indexOf("["), to: cursorOffset });
  });

  it("replace range always starts at the `[`, not at the cursor", () => {
    const text = "Pay rent [due:: 2026-10-1";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match?.from).toBe(text.indexOf("["));
    expect(match?.to).toBe(cursorOffset);
  });

  it("stops triggering the moment typed content diverges from a date", () => {
    // Letters after `::` are not a valid date prefix — popover closes
    // silently (this function simply stops matching).
    const text = "Pay rent [due:: soon";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toBeNull();
  });
});

describe("detectDueTrigger — already-complete token", () => {
  it("does not re-trigger when the cursor sits inside an existing valid [due:: date]", () => {
    const text = "Pay rent [due:: 2026-10-15] tomorrow";
    const cursorOffset = text.indexOf("2026-10-15") + "2026-10-1".length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toBeNull();
  });

  it("does not trigger right after the closing bracket either", () => {
    const text = "Pay rent [due:: 2026-10-15]";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toBeNull();
  });

  it("does not trigger for an invalid-but-closed field by itself re-opening", () => {
    // Clicking back in right after a complete field's `]` must not trigger,
    // even though an earlier unrelated bracket exists in the line.
    const text = "See [due:: 2026-10-15] and also [due::";
    const cursorOffset = text.length; // the SECOND, still-open field
    const match = detectDueTrigger({ text, cursorOffset, inListItem: true });
    expect(match).toEqual({ from: text.lastIndexOf("["), to: cursorOffset });
  });
});

describe("detectDueTrigger — scoping", () => {
  it("never triggers outside a list item, even with an otherwise-valid trigger", () => {
    const text = "Pay rent [due:: ";
    const cursorOffset = text.length;
    const match = detectDueTrigger({ text, cursorOffset, inListItem: false });
    expect(match).toBeNull();
  });

  it("never triggers when the trigger text was blanked out (inline code span)", () => {
    // The ProseMirror-level caller (see buildParagraphScanText in
    // dueDatePickerPlugin.ts) blanks `code`-marked text to same-length
    // spaces before calling this function — mirroring taskMetaChipsPlugin's
    // own code-span handling — so a `[due::` typed inside an inline code
    // span never reaches this function as literal "[due::" text; it arrives
    // as plain spaces instead. Simulate exactly that post-blanking input:
    // "Pay rent [due:: " with the `[due:: ` run replaced by same-length
    // spaces, as if it had been wrapped in a code span.
    const withCode = "Pay rent [due:: ";
    const blankStart = withCode.indexOf("[");
    const blanked =
      withCode.slice(0, blankStart) + " ".repeat(withCode.length - blankStart);
    const cursorOffset = blanked.length;
    const match = detectDueTrigger({
      text: blanked,
      cursorOffset,
      inListItem: true,
    });
    expect(match).toBeNull();
  });
});

describe("detectDueTrigger — out-of-range cursor", () => {
  it("returns null for a cursor offset past the end of the text", () => {
    const text = "Pay rent [due:: ";
    const match = detectDueTrigger({
      text,
      cursorOffset: text.length + 5,
      inListItem: true,
    });
    expect(match).toBeNull();
  });

  it("returns null for a negative cursor offset", () => {
    const text = "Pay rent [due:: ";
    const match = detectDueTrigger({
      text,
      cursorOffset: -1,
      inListItem: true,
    });
    expect(match).toBeNull();
  });
});
