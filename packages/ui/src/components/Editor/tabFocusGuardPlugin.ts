import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";

/**
 * Keeps Tab / Shift+Tab inside the editor.
 *
 * Milkdown's list keymap (sink/lift) and the table keymap return `false` when
 * the action is impossible (first bullet, max depth, plain paragraph, ...).
 * ProseMirror then does not call preventDefault, so the browser runs its
 * default focus traversal and the caret jumps out of the document to the next
 * focusable control (the status bar's "Streaming animation" checkbox).
 *
 * This listener runs AFTER ProseMirror's own keydown handling (it is added
 * when the plugin view is created, which is after ProseMirror's listeners are
 * registered). If a keymap already consumed the key, `defaultPrevented` is
 * set and we do nothing; otherwise we consume the key as a no-op. Plain
 * Tab/Shift+Tab only: Ctrl/Alt/Meta combos (e.g. Ctrl+Tab tab switching)
 * are untouched, and keys originating in nested widgets (inputs, CodeMirror
 * source editors) keep their own handling.
 */
export function shouldConsumeStrayTab(event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  if (event.defaultPrevented) return false;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.isComposing) return false;
  const target = event.target as Element | null;
  if (
    target &&
    typeof target.closest === "function" &&
    target.closest("input, textarea, select, button, .cm-editor")
  ) {
    return false;
  }
  return true;
}

export const tabFocusGuardPlugin = $prose(
  () =>
    new Plugin({
      view(view) {
        const onKeyDown = (event: KeyboardEvent) => {
          if (shouldConsumeStrayTab(event)) event.preventDefault();
        };
        view.dom.addEventListener("keydown", onKeyDown);
        return {
          destroy() {
            view.dom.removeEventListener("keydown", onKeyDown);
          },
        };
      },
    }),
);
