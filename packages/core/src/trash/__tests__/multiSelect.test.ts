import { describe, it, expect } from "vitest";
import { computeNextSelection } from "../multiSelect";

const ORDER = ["a", "b", "c", "d", "e"];

describe("computeNextSelection", () => {
  it("plain click on an unselected row replaces selection", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["a", "b"],
        clickedId: "d",
      }),
    ).toEqual(["d"]);
  });

  it("plain click on the only selected row keeps it selected", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["c"],
        clickedId: "c",
      }),
    ).toEqual(["c"]);
  });

  it("ctrl-click toggles row in/out", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["a"],
        clickedId: "c",
        ctrlKey: true,
      }),
    ).toEqual(["a", "c"]);

    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["a", "c"],
        clickedId: "c",
        ctrlKey: true,
      }),
    ).toEqual(["a"]);
  });

  it("meta-click works the same as ctrl-click on macOS", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["a"],
        clickedId: "b",
        metaKey: true,
      }),
    ).toEqual(["a", "b"]);
  });

  it("shift-click extends from last anchor (going forward)", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["a"],
        clickedId: "c",
        shiftKey: true,
      }),
    ).toEqual(["a", "b", "c"]);
  });

  it("shift-click extends from last anchor (going backward)", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["d"],
        clickedId: "b",
        shiftKey: true,
      }),
    ).toEqual(["d", "c", "b"]);
  });

  it("shift-click with no prior selection just selects the clicked row", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: [],
        clickedId: "c",
        shiftKey: true,
      }),
    ).toEqual(["c"]);
  });

  it("shift-click on missing anchor falls back to single select", () => {
    expect(
      computeNextSelection({
        orderedIds: ORDER,
        selectedIds: ["zz-not-present"],
        clickedId: "b",
        shiftKey: true,
      }),
    ).toEqual(["b"]);
  });

  it("shift-click unions with existing selection but moves clicked id last", () => {
    const next = computeNextSelection({
      orderedIds: ORDER,
      selectedIds: ["e", "b"],
      clickedId: "d",
      shiftKey: true,
    });
    // Anchor was 'b'. Range b..d = b,c,d. Union with {e,b} = {e,b,c,d}.
    // Final: clicked id 'd' is at end.
    expect(next.at(-1)).toBe("d");
    expect(new Set(next)).toEqual(new Set(["b", "c", "d", "e"]));
  });
});
