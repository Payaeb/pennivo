// Pure helpers for multi-select selection state. Used by both Trash list
// (and any future list with the same gesture vocabulary).
//
// Lives in @pennivo/core so the same gesture rules apply on every host.
// Match Sidebar.tsx's existing convention: shift = range from anchor,
// ctrl/cmd = toggle, plain click = select-just-this.

export interface MultiSelectInput {
  /** Stable IDs of the rows in display order. */
  orderedIds: readonly string[];
  /** Currently selected IDs (order preserved; last entry is the anchor). */
  selectedIds: readonly string[];
  /** ID of the row that was clicked. */
  clickedId: string;
  /** Modifier keys at click time. */
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/**
 * Compute the next selection given a click + modifiers. Returns a new
 * array — input arrays are never mutated.
 *
 * Rules:
 * - shift + prior selection → range from prior anchor to clickedId
 *   (inclusive), unioned with the previous selection. Click target becomes
 *   the new anchor.
 * - ctrl/cmd → toggle clickedId in/out of the selection. Toggling on moves
 *   the click target to the end of the array (so it's the new anchor).
 * - plain click → just clickedId.
 */
export function computeNextSelection(input: MultiSelectInput): string[] {
  const { orderedIds, selectedIds, clickedId } = input;
  const isShift = !!input.shiftKey;
  const isToggle = !!(input.ctrlKey || input.metaKey);

  if (isShift && selectedIds.length > 0) {
    const anchorId = selectedIds[selectedIds.length - 1];
    const anchorIdx = orderedIds.indexOf(anchorId);
    const clickIdx = orderedIds.indexOf(clickedId);
    if (anchorIdx === -1 || clickIdx === -1) return [clickedId];
    const [from, to] =
      anchorIdx <= clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx];
    const range = orderedIds.slice(from, to + 1);
    const set = new Set<string>(selectedIds);
    for (const rid of range) set.add(rid);
    set.delete(clickedId);
    return [...set, clickedId];
  }

  if (isToggle) {
    if (selectedIds.includes(clickedId)) {
      return selectedIds.filter((x) => x !== clickedId);
    }
    return [...selectedIds, clickedId];
  }

  return [clickedId];
}
