/**
 * Strips editor-only chrome from the editor's DOM before it is exported.
 *
 * `view.dom.innerHTML` contains everything ProseMirror renders, including
 * widget decorations (collapse handles, mermaid "Edit chart" buttons),
 * decoration classes (collapsed state, bullet zoom, find highlights, label
 * chips) and ProseMirror's own helper nodes. None of that is document content,
 * and the export stylesheet has no rules for it (an unstyled collapse handle
 * SVG renders page-sized).
 *
 * The input is parsed into an inert <template>, so the live editor DOM is never
 * touched and nothing in the markup runs or loads. The function is pure and DOM
 * only (no Electron/Node), so web and mobile exports share it.
 *
 * Deliberately NOT removed:
 *  - `.mermaid-preview-widget` (and the kanban preview): this widget IS how the
 *    rendered mermaid SVG reaches the export, so it is kept; only its
 *    buttons and status text are stripped.
 *  - `li[data-checked]`, `data-label`, `data-list-type`: task checkboxes and
 *    list markers are drawn from these by the export stylesheet.
 *  - Nested lists inside collapsed items: collapsing is CSS-only (a class that
 *    hides the nested list), so the content is present in the DOM. Stripping
 *    the class is what makes the export contain it.
 */

/** Elements that exist only for editing. Removed with their subtree. */
export const EXPORT_REMOVE_SELECTORS: readonly string[] = [
  // collapsibleListPlugin: the handle widget on every parent bullet
  ".collapse-toggle",
  // imageViewerPlugin hover badge (normally lives on document.body)
  ".pennivo-image-badge",
  // mermaidPlugin: "Edit Chart" / "Edit Board" buttons
  ".mermaid-gantt-edit-btn",
  // mermaidPlugin: status text shown instead of a diagram
  ".mermaid-preview-hint",
  ".mermaid-preview-loading",
  ".mermaid-preview-error",
  // mermaidPlugin: raw source of gantt/kanban blocks, hidden in the editor
  // because the visual preview replaces it
  "pre.mermaid-gantt-hidden-code",
  // ProseMirror helper nodes
  "img.ProseMirror-separator",
  "br.ProseMirror-trailingBreak",
  ".ProseMirror-gapcursor",
  // Editor.tsx link hover preview
  ".link-url-preview",
];

/** Exact class names that are editor state, not content. */
const STRIP_CLASSES = new Set([
  "list-item--collapsed",
  "list-item--collapsible",
  "mermaid-gantt-hidden-code",
]);

/** Class prefixes that are editor state, not content. */
const STRIP_CLASS_PREFIXES: readonly string[] = [
  "ProseMirror-", // widget, selectednode, hideselection, gapcursor, ...
  "bullet-zoom-", // bulletZoomPlugin decorations
  "find-match", // find/replace highlights (find-match, find-match--current)
  "meta-chip", // taskMetaChipsPlugin label/date chips (text is kept)
  "collapse-toggle",
];

function isEditorClass(name: string): boolean {
  return (
    STRIP_CLASSES.has(name) ||
    STRIP_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

/** Returns editor HTML with editor-only chrome removed. */
export function sanitizeEditorHtmlForExport(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;

  for (const selector of EXPORT_REMOVE_SELECTORS) {
    root.querySelectorAll(selector).forEach((el) => el.remove());
  }

  // A mermaid widget left with no content (it only held a status message).
  root.querySelectorAll(".mermaid-preview-widget").forEach((el) => {
    if (el.childElementCount === 0 && !(el.textContent ?? "").trim()) {
      el.remove();
    }
  });

  root.querySelectorAll("[class]").forEach((el) => {
    // SVG elements expose className as an SVGAnimatedString; use the attribute.
    const kept = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter((name) => name !== "" && !isEditorClass(name));
    if (kept.length > 0) el.setAttribute("class", kept.join(" "));
    else el.removeAttribute("class");
  });

  root
    .querySelectorAll("[contenteditable]")
    .forEach((el) => el.removeAttribute("contenteditable"));

  return template.innerHTML;
}
