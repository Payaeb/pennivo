// Opens the image viewer from the WYSIWYG editor.
//
//  - Double-click on an <img> opens it. The handler returns true so
//    ProseMirror skips its own dblclick handling, and it never dispatches a
//    transaction: selection and document are exactly as the first click left
//    them.
//  - While the pointer rests on an image a small "expand" badge appears at its
//    top-right. The badge is a plain element appended to document.body (not a
//    child of the editor) so the ProseMirror DOM is never mutated.
//
// The plugin only reports "open this image" through a callback; the viewer
// itself is rendered by App.
import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";

export const OPEN_IMAGE_VIEWER_EVENT = "pennivo-open-image-viewer";

export interface ImageViewerRequest {
  src: string;
  alt: string;
}

export const imageViewerKey = new PluginKey("pennivoImageViewer");

/** True when the element is an image that actually loaded. */
export function isLoadedImage(el: Element | null): el is HTMLImageElement {
  return (
    el instanceof HTMLImageElement &&
    el.complete &&
    // SVGs without intrinsic size report 0 but still loaded.
    (el.naturalWidth > 0 || (el.currentSrc || el.src).endsWith(".svg"))
  );
}

export function requestFromImage(img: HTMLImageElement): ImageViewerRequest {
  return {
    src: img.currentSrc || img.src,
    alt: img.getAttribute("alt") ?? "",
  };
}

export function dispatchOpenImageViewer(request: ImageViewerRequest): void {
  window.dispatchEvent(
    new CustomEvent<ImageViewerRequest>(OPEN_IMAGE_VIEWER_EVENT, {
      detail: request,
    }),
  );
}

const BADGE_CLASS = "pennivo-image-badge";
const BADGE_INSET = 8;
const BADGE_SIZE = 28;
const HIDE_DELAY_MS = 140;

function createBadge(): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = BADGE_CLASS;
  btn.setAttribute("aria-label", "View image");
  btn.title = "View image (double-click)";
  btn.hidden = true;
  btn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5l-4.5 4.5M2.5 13.5L7 9"/></svg>';
  return btn;
}

export function createImageViewerPlugin(
  onOpen: (request: ImageViewerRequest) => void,
  isEnabled: () => boolean = () => true,
): Plugin {
  return new Plugin({
    key: imageViewerKey,
    props: {
      handleDOMEvents: {
        dblclick: (_view, event) => {
          if (!isEnabled()) return false;
          const target = event.target;
          if (!(target instanceof HTMLImageElement)) return false;
          // A broken image gets no viewer; fall through to default handling.
          if (!isLoadedImage(target)) return false;
          event.preventDefault();
          onOpen(requestFromImage(target));
          return true;
        },
      },
    },
    view: (view) => {
      if (!isEnabled()) return {};
      const badge = createBadge();
      document.body.appendChild(badge);
      let current: HTMLImageElement | null = null;
      let hideTimer: ReturnType<typeof setTimeout> | null = null;

      const hide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
        badge.hidden = true;
        current = null;
      };
      const scheduleHide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, HIDE_DELAY_MS);
      };
      const cancelHide = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
      };

      const show = (img: HTMLImageElement) => {
        const rect = img.getBoundingClientRect();
        const clip = (
          view.dom.closest(".app-editor-area") ?? view.dom
        ).getBoundingClientRect();
        // Image scrolled out of the visible editor area: no badge.
        if (rect.bottom < clip.top + BADGE_SIZE || rect.top > clip.bottom) {
          hide();
          return;
        }
        current = img;
        const top = Math.max(rect.top, clip.top) + BADGE_INSET;
        const left =
          Math.min(rect.right, clip.right) - BADGE_INSET - BADGE_SIZE;
        badge.style.top = `${Math.round(top)}px`;
        badge.style.left = `${Math.round(left)}px`;
        badge.hidden = false;
        cancelHide();
      };

      const onOver = (e: MouseEvent) => {
        const t = e.target;
        if (t instanceof HTMLImageElement && isLoadedImage(t)) show(t);
      };
      const onOut = (e: MouseEvent) => {
        if (e.target instanceof HTMLImageElement) scheduleHide();
      };
      const onBadgeClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const img = current;
        hide();
        if (img && isLoadedImage(img)) onOpen(requestFromImage(img));
      };
      // Keep the editor's focus and selection while clicking the badge.
      const onBadgeDown = (e: MouseEvent) => e.preventDefault();
      const onScroll = () => {
        if (!badge.hidden) hide();
      };

      view.dom.addEventListener("mouseover", onOver);
      view.dom.addEventListener("mouseout", onOut);
      badge.addEventListener("mouseenter", cancelHide);
      badge.addEventListener("mouseleave", scheduleHide);
      badge.addEventListener("mousedown", onBadgeDown);
      badge.addEventListener("click", onBadgeClick);
      window.addEventListener("scroll", onScroll, true);
      window.addEventListener("resize", onScroll);
      window.addEventListener("blur", onScroll);

      return {
        update: () => {
          // Document edits can detach or move the hovered image.
          if (current && !current.isConnected) hide();
        },
        destroy: () => {
          if (hideTimer) clearTimeout(hideTimer);
          view.dom.removeEventListener("mouseover", onOver);
          view.dom.removeEventListener("mouseout", onOut);
          window.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("resize", onScroll);
          window.removeEventListener("blur", onScroll);
          badge.remove();
        },
      };
    },
  });
}

/** Milkdown registration. Mobile (touch) is out of scope for v1. */
export const imageViewerPlugin = (isEnabled: () => boolean) =>
  $prose(() => createImageViewerPlugin(dispatchOpenImageViewer, isEnabled));
