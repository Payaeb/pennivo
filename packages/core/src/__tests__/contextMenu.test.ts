import { describe, it, expect } from "vitest";
import { buildContextMenu, type ContextMenuInput } from "../contextMenu";

const baseFlags = {
  canCut: false,
  canCopy: false,
  canPaste: false,
  canSelectAll: false,
};

const minimal: ContextMenuInput = {
  isEditable: false,
  editFlags: baseFlags,
};

describe("buildContextMenu", () => {
  it("returns nothing when there is nothing to do", () => {
    expect(buildContextMenu(minimal)).toEqual([]);
  });

  it("includes cut/copy/paste/select-all when the click is on an editable element, even with all flags off", () => {
    const items = buildContextMenu({ ...minimal, isEditable: true });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("cut");
    expect(kinds).toContain("copy");
    expect(kinds).toContain("paste");
    expect(kinds).toContain("selectAll");
  });

  it("disables editing items that aren't currently valid", () => {
    const items = buildContextMenu({
      ...minimal,
      isEditable: true,
      editFlags: { ...baseFlags, canCopy: true },
    });
    const cut = items.find((i) => i.kind === "cut");
    const copy = items.find((i) => i.kind === "copy");
    expect(cut && "enabled" in cut && cut.enabled).toBe(false);
    expect(copy && "enabled" in copy && copy.enabled).toBe(true);
  });

  it("shows copy + select-all when text is selected on a non-editable target", () => {
    const items = buildContextMenu({
      ...minimal,
      editFlags: { ...baseFlags, canCopy: true, canSelectAll: true },
    });
    const kinds = items.map((i) => i.kind);
    expect(kinds).toContain("copy");
    expect(kinds).toContain("selectAll");
  });

  it("puts spelling suggestions first, capped at five, with a separator and Add to Dictionary", () => {
    const items = buildContextMenu({
      ...minimal,
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the", "tea", "ten", "tee", "ted", "test"],
      editFlags: { ...baseFlags, canPaste: true },
    });
    const suggestions = items.filter((i) => i.kind === "suggestion");
    expect(suggestions).toHaveLength(5);
    expect(suggestions.map((s) => "label" in s && s.label)).toEqual([
      "the",
      "tea",
      "ten",
      "tee",
      "ted",
    ]);
    const addToDict = items.find((i) => i.kind === "addToDictionary");
    expect(addToDict).toBeDefined();
    expect(addToDict && "label" in addToDict && addToDict.label).toBe(
      'Add "teh" to dictionary',
    );
    // Cut/Copy/Paste still appear after the spelling block.
    const kinds = items.map((i) => i.kind);
    expect(kinds.indexOf("addToDictionary")).toBeLessThan(kinds.indexOf("cut"));
  });

  it("handles a misspelled word with no suggestions — only Add to Dictionary, no leading separator", () => {
    const items = buildContextMenu({
      ...minimal,
      isEditable: true,
      misspelledWord: "asdfqwer",
      dictionarySuggestions: [],
      editFlags: { ...baseFlags, canPaste: true },
    });
    expect(items[0].kind).toBe("addToDictionary");
  });

  it("includes Open Link + Copy Link Address when right-clicking a link", () => {
    const items = buildContextMenu({
      ...minimal,
      linkURL: "https://pennivo.app",
    });
    const open = items.find((i) => i.kind === "openLink");
    const copy = items.find((i) => i.kind === "copyLink");
    expect(open).toBeDefined();
    expect(copy).toBeDefined();
    expect(open && "url" in open && open.url).toBe("https://pennivo.app");
  });

  it("includes Copy Image Address when right-clicking an image", () => {
    const items = buildContextMenu({
      ...minimal,
      mediaType: "image",
      srcURL: "file:///workspace/cat.png",
    });
    const item = items.find((i) => i.kind === "copyImageAddress");
    expect(item).toBeDefined();
  });

  it("does not include image item when mediaType is something else", () => {
    const items = buildContextMenu({
      ...minimal,
      mediaType: "video",
      srcURL: "file:///workspace/clip.mp4",
    });
    expect(items.find((i) => i.kind === "copyImageAddress")).toBeUndefined();
  });

  it("never ends with a trailing separator", () => {
    const items = buildContextMenu({
      ...minimal,
      isEditable: true,
      misspelledWord: "teh",
      dictionarySuggestions: ["the"],
      linkURL: "https://x.test",
      editFlags: { ...baseFlags, canCopy: true },
    });
    expect(items[items.length - 1].kind).not.toBe("separator");
  });
});
