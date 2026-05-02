// Pure menu-spec builder for the right-click context menu. Lives in core so
// it can be unit-tested without booting Electron; the desktop main process
// adapts the spec into Electron MenuItems.

export interface ContextMenuInput {
  isEditable: boolean;
  misspelledWord?: string;
  dictionarySuggestions?: string[];
  linkURL?: string;
  mediaType?: string;
  srcURL?: string;
  editFlags: {
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

export type ContextMenuItem =
  | { kind: "separator" }
  | {
      kind: "suggestion";
      label: string;
      word: string;
    }
  | {
      kind: "addToDictionary";
      label: string;
      word: string;
    }
  | {
      kind: "openLink";
      label: string;
      url: string;
    }
  | {
      kind: "copyLink";
      label: string;
      url: string;
    }
  | {
      kind: "copyImageAddress";
      label: string;
      url: string;
    }
  | {
      kind: "cut";
      label: string;
      enabled: boolean;
    }
  | {
      kind: "copy";
      label: string;
      enabled: boolean;
    }
  | {
      kind: "paste";
      label: string;
      enabled: boolean;
    }
  | {
      kind: "selectAll";
      label: string;
      enabled: boolean;
    };

export function buildContextMenu(input: ContextMenuInput): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const flags = input.editFlags;

  if (input.misspelledWord) {
    const suggestions = (input.dictionarySuggestions ?? []).slice(0, 5);
    for (const suggestion of suggestions) {
      items.push({
        kind: "suggestion",
        label: suggestion,
        word: suggestion,
      });
    }
    if (suggestions.length > 0) items.push({ kind: "separator" });
    items.push({
      kind: "addToDictionary",
      label: `Add "${input.misspelledWord}" to dictionary`,
      word: input.misspelledWord,
    });
    items.push({ kind: "separator" });
  }

  if (input.linkURL) {
    items.push({ kind: "openLink", label: "Open Link", url: input.linkURL });
    items.push({
      kind: "copyLink",
      label: "Copy Link Address",
      url: input.linkURL,
    });
    items.push({ kind: "separator" });
  }

  if (input.mediaType === "image" && input.srcURL) {
    items.push({
      kind: "copyImageAddress",
      label: "Copy Image Address",
      url: input.srcURL,
    });
    items.push({ kind: "separator" });
  }

  const hasEditingItems =
    input.isEditable ||
    flags.canCut ||
    flags.canCopy ||
    flags.canPaste ||
    flags.canSelectAll;
  if (hasEditingItems) {
    items.push({ kind: "cut", label: "Cut", enabled: flags.canCut });
    items.push({ kind: "copy", label: "Copy", enabled: flags.canCopy });
    items.push({ kind: "paste", label: "Paste", enabled: flags.canPaste });
    items.push({ kind: "separator" });
    items.push({
      kind: "selectAll",
      label: "Select All",
      enabled: flags.canSelectAll,
    });
  }

  // Trim trailing separator(s)
  while (items.length > 0 && items[items.length - 1].kind === "separator") {
    items.pop();
  }

  return items;
}
