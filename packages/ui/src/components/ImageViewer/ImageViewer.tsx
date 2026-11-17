// Full-viewport image viewer (lightbox) for images in the WYSIWYG editor.
//
// Hard rules, all deliberate:
//  - It renders its OWN <img> from the editor image's resolved src. It never
//    touches the editor DOM or the ProseMirror document.
//  - Pan/zoom is a single CSS transform (translate3d + scale, origin 0 0)
//    written through a ref. React state only carries the readout text, so a
//    wheel burst on a 40-megapixel image does not re-render anything heavy.
//  - While open it owns the keyboard and the wheel at the window's capture
//    phase, so the app-level display-zoom handlers (Ctrl+wheel, Ctrl +/-/0)
//    and the Escape chain never see those events.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  centered,
  clampPan,
  fitScale,
  formatPercent,
  maxScaleFor,
  minScaleFor,
  PIXELATED_FROM,
  resizeTransform,
  wheelFactor,
  zoomAt,
  ZOOM_STEP,
  type Size,
  type ViewerTransform,
} from "../../utils/viewerTransform";
import "./ImageViewer.css";

export interface ViewerFullScreen {
  /** True when focus mode already owns full screen; the viewer must not
   *  exit it, and never flips focus mode state. */
  ownedByApp: boolean;
  set: (flag: boolean) => void;
  isActive: () => Promise<boolean>;
}

export interface ImageViewerProps {
  src: string;
  alt: string;
  onClose: () => void;
  /** Omit where full screen is unsupported; the button is then hidden. */
  fullScreen?: ViewerFullScreen;
}

const IDLE_MS = 2500;
const PAN_STEP = 60;
const PAN_STEP_LARGE = 240;
const FALLBACK_ASPECT = 0.75;

function captionFor(src: string, alt: string): string {
  const trimmed = alt.trim();
  if (trimmed) return trimmed;
  try {
    const clean = src.split(/[?#]/)[0] ?? "";
    const last = clean.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last) || "Image";
  } catch {
    return "Image";
  }
}

function currentView(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function ImageViewer({
  src,
  alt,
  onClose,
  fullScreen,
}: ImageViewerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Geometry lives in refs; only the readout is React state.
  const tRef = useRef<ViewerTransform>({ scale: 1, tx: 0, ty: 0 });
  const imageSizeRef = useRef<Size>({ width: 0, height: 0 });
  const viewRef = useRef<Size>(currentView());
  const fitRef = useRef(1);
  const atFitRef = useRef(true);
  const readyRef = useRef(false);
  const errorRef = useRef(false);
  const rafRef = useRef(0);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const [percent, setPercent] = useState(100);
  const [announce, setAnnounce] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [idle, setIdle] = useState(false);
  const [fsOn, setFsOn] = useState(false);

  const label = useMemo(() => captionFor(src, alt), [src, alt]);
  const reduced = useMemo(
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)")?.matches === true,
    [],
  );

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const fullScreenRef = useRef(fullScreen);
  fullScreenRef.current = fullScreen;
  const ownFsRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---- transform plumbing -------------------------------------------------

  const writeTransform = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const { scale, tx, ty } = tRef.current;
    img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    img.classList.toggle("iv-img--crisp", scale >= PIXELATED_FROM);
  }, []);

  const scheduleWrite = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      writeTransform();
    });
  }, [writeTransform]);

  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useCallback(
    (next: ViewerTransform, immediate = true) => {
      tRef.current = next;
      atFitRef.current = Math.abs(next.scale - fitRef.current) < 1e-6;
      if (immediate) writeTransform();
      else scheduleWrite();
      const pct = formatPercent(next.scale);
      setPercent(pct);
      if (announceTimer.current) clearTimeout(announceTimer.current);
      announceTimer.current = setTimeout(() => setAnnounce(`${pct}%`), 350);
    },
    [writeTransform, scheduleWrite],
  );

  const limits = useCallback(() => {
    const fit = fitRef.current;
    return { min: minScaleFor(fit), max: maxScaleFor(fit) };
  }, []);

  const zoomTo = useCallback(
    (scale: number, ax?: number, ay?: number, immediate = true) => {
      if (!readyRef.current || errorRef.current) return;
      const view = viewRef.current;
      const { min, max } = limits();
      commit(
        zoomAt(
          tRef.current,
          scale,
          ax ?? view.width / 2,
          ay ?? view.height / 2,
          min,
          max,
          imageSizeRef.current,
          view,
        ),
        immediate,
      );
    },
    [commit, limits],
  );

  const zoomBy = useCallback(
    (factor: number, ax?: number, ay?: number, immediate = true) =>
      zoomTo(tRef.current.scale * factor, ax, ay, immediate),
    [zoomTo],
  );

  const fit = useCallback(() => {
    if (!readyRef.current || errorRef.current) return;
    commit(centered(fitRef.current, imageSizeRef.current, viewRef.current));
  }, [commit]);

  const actualSize = useCallback(() => zoomTo(1), [zoomTo]);

  const panBy = useCallback(
    (dx: number, dy: number, immediate = true) => {
      if (!readyRef.current || errorRef.current) return;
      const t = tRef.current;
      commit(
        clampPan(
          { scale: t.scale, tx: t.tx + dx, ty: t.ty + dy },
          imageSizeRef.current,
          viewRef.current,
        ),
        immediate,
      );
    },
    [commit],
  );

  // ---- load / error -------------------------------------------------------

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const view = currentView();
    viewRef.current = view;
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if (!width || !height) {
      // SVG without intrinsic size: lay it out at the stage width.
      width = Math.max(1, view.width - 112);
      height = Math.round(width * FALLBACK_ASPECT);
    }
    imageSizeRef.current = { width, height };
    img.style.width = `${width}px`;
    img.style.height = `${height}px`;
    fitRef.current = fitScale({ width, height }, view);
    readyRef.current = true;
    atFitRef.current = true;
    tRef.current = centered(fitRef.current, { width, height }, view);
    writeTransform();
    const pct = formatPercent(tRef.current.scale);
    setPercent(pct);
    setAnnounce(`${pct}%`);
    setReady(true);
  }, [writeTransform]);

  const handleError = useCallback(() => {
    errorRef.current = true;
    readyRef.current = false;
    setError(true);
  }, []);

  // The <img> may finish loading before React attaches onLoad (cache hit).
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0 && !readyRef.current) {
      handleLoad();
    }
  }, [handleLoad]);

  // ---- full screen --------------------------------------------------------

  const toggleFullScreen = useCallback(async () => {
    const fs = fullScreenRef.current;
    if (!fs || fs.ownedByApp) return;
    if (!ownFsRef.current) {
      if (await fs.isActive()) return; // someone else already owns it
      // Closed while the check was pending: do not enter full screen now.
      if (!mountedRef.current) return;
      fs.set(true);
      ownFsRef.current = true;
      setFsOn(true);
    } else {
      fs.set(false);
      ownFsRef.current = false;
      setFsOn(false);
    }
  }, []);

  useEffect(
    () => () => {
      // Restore only what the viewer itself entered.
      if (ownFsRef.current) fullScreenRef.current?.set(false);
    },
    [],
  );

  // ---- focus: take it on open, give it back on close ----------------------

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    overlayRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous && previous.isConnected && previous !== document.body) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);

  // ---- window-level keyboard + wheel (capture) ----------------------------

  useEffect(() => {
    const focusables = (): HTMLElement[] =>
      Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        ) ?? [],
      );

    const onKeyDown = (e: KeyboardEvent) => {
      const swallow = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const mod = e.ctrlKey || e.metaKey;

      // A dialog stacked above the viewer (e.g. a text field in the command
      // palette) keeps its own keys.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        !overlayRef.current?.contains(target) &&
        (target.closest("input, textarea, select, [contenteditable='true']") !=
          null ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === "Escape") {
        swallow();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        swallow();
        const items = focusables();
        if (items.length === 0) {
          overlayRef.current?.focus({ preventScroll: true });
          return;
        }
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? items.indexOf(active) : -1;
        let next: number;
        if (idx === -1) next = e.shiftKey ? items.length - 1 : 0;
        else next = (idx + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        items[next]?.focus({ preventScroll: true });
        return;
      }
      if (e.altKey) return;

      // Ctrl/Cmd + / - / 0 would zoom the whole app; the viewer eats them.
      if (e.key === "+" || e.key === "=") {
        swallow();
        zoomBy(ZOOM_STEP);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        swallow();
        zoomBy(1 / ZOOM_STEP);
        return;
      }
      if (e.key === "0") {
        swallow();
        fit();
        return;
      }
      // The viewer is modal: other Ctrl/Cmd shortcuts must not open dialogs or
      // edit the document behind it.
      if (mod) {
        if (!["c", "C"].includes(e.key)) swallow();
        return;
      }

      switch (e.key) {
        case "1":
          swallow();
          actualSize();
          return;
        case "f":
        case "F":
          swallow();
          void toggleFullScreen();
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          swallow();
          const step = e.shiftKey ? PAN_STEP_LARGE : PAN_STEP;
          // Content follows the arrow, like scrolling toward that side.
          if (e.key === "ArrowLeft") panBy(step, 0);
          if (e.key === "ArrowRight") panBy(-step, 0);
          if (e.key === "ArrowUp") panBy(0, step);
          if (e.key === "ArrowDown") panBy(0, -step);
          return;
        }
        default:
          return;
      }
    };

    const onWheel = (e: WheelEvent) => {
      // Always keep wheel away from the app (display zoom, editor scroll).
      e.preventDefault();
      e.stopPropagation();
      if (!readyRef.current || errorRef.current) return;
      const fine = e.ctrlKey || e.metaKey;
      zoomBy(wheelFactor(e.deltaY, e.deltaMode, fine), e.clientX, e.clientY);
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [zoomBy, fit, actualSize, panBy, toggleFullScreen]);

  // ---- window resize ------------------------------------------------------

  useEffect(() => {
    const onResize = () => {
      if (!readyRef.current) return;
      const old = viewRef.current;
      const next = currentView();
      viewRef.current = next;
      const { transform, fit } = resizeTransform(
        tRef.current,
        atFitRef.current,
        imageSizeRef.current,
        old,
        next,
      );
      fitRef.current = fit;
      commit(transform);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [commit]);

  // ---- control fade -------------------------------------------------------

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_MS);
    };
    const wake = () => {
      setIdle(false);
      arm();
    };
    arm();
    window.addEventListener("pointermove", wake, true);
    window.addEventListener("mousemove", wake, true);
    window.addEventListener("keydown", wake, true);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointermove", wake, true);
      window.removeEventListener("mousemove", wake, true);
      window.removeEventListener("keydown", wake, true);
    };
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  // ---- pointer: drag to pan, double-click to toggle ----------------------

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !readyRef.current) return;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointers (tests) have no active capture */
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    panBy(e.clientX - d.x, e.clientY - d.y, false);
    dragRef.current = { x: e.clientX, y: e.clientY };
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };
  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!readyRef.current || errorRef.current) return;
    if (atFitRef.current) zoomTo(2, e.clientX, e.clientY);
    else fit();
  };

  const disabled = error || !ready;
  const fsAvailable = fullScreen !== undefined;
  const fsActive = fullScreen?.ownedByApp === true || fsOn;

  return createPortal(
    <div
      ref={overlayRef}
      className={`iv-overlay${reduced ? " iv-overlay--reduced" : ""}${
        idle ? " iv-overlay--idle" : ""
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={`Image viewer: ${label}`}
      tabIndex={-1}
      data-testid="image-viewer"
    >
      <div
        className={`iv-stage${dragging ? " iv-stage--dragging" : ""}${
          disabled ? " iv-stage--idle" : ""
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick}
      >
        {!error && (
          <img
            ref={imgRef}
            className={`iv-img${ready ? " iv-img--ready" : ""}`}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={handleLoad}
            onError={handleError}
          />
        )}
        {error && (
          <div className="iv-error" role="status">
            <svg
              width="28"
              height="28"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
              <circle cx="5.5" cy="6.25" r="1.1" />
              <path d="M2 12l3.5-3.5 2.5 2.5 2-2 4 4" />
            </svg>
            <span>Couldn&apos;t load this image</span>
          </div>
        )}
      </div>

      <div className="iv-caption" title={label}>
        {label}
      </div>

      <button
        type="button"
        className="iv-btn iv-close iv-fade"
        aria-label="Close image viewer"
        title="Close (Esc)"
        onClick={() => onCloseRef.current()}
      >
        <CloseIcon />
      </button>

      <div
        className="iv-pill iv-fade"
        role="toolbar"
        aria-label="Image viewer controls"
      >
        <button
          type="button"
          className="iv-btn"
          aria-label="Zoom out"
          title="Zoom out (-)"
          disabled={disabled}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          <MinusIcon />
        </button>
        <button
          type="button"
          className="iv-readout"
          aria-label="Reset zoom to fit"
          title="Click to fit (0)"
          disabled={disabled}
          onClick={fit}
        >
          {error ? "--" : `${percent}%`}
        </button>
        <button
          type="button"
          className="iv-btn"
          aria-label="Zoom in"
          title="Zoom in (+)"
          disabled={disabled}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          <PlusIcon />
        </button>
        <span className="iv-sep" aria-hidden="true" />
        <button
          type="button"
          className="iv-btn iv-btn--text"
          aria-label="Fit to window"
          title="Fit (0)"
          disabled={disabled}
          onClick={fit}
        >
          Fit
        </button>
        <button
          type="button"
          className="iv-btn iv-btn--text"
          aria-label="Actual size"
          title="Actual size (1)"
          disabled={disabled}
          onClick={actualSize}
        >
          1:1
        </button>
        {fsAvailable && (
          <button
            type="button"
            className="iv-btn"
            aria-label={
              fullScreen?.ownedByApp
                ? "Already full screen (focus mode)"
                : fsActive
                  ? "Exit full screen"
                  : "Full screen"
            }
            aria-pressed={fsActive}
            title={
              fullScreen?.ownedByApp
                ? "Already full screen (focus mode)"
                : fsActive
                  ? "Exit full screen (F)"
                  : "Full screen (F)"
            }
            onClick={() => void toggleFullScreen()}
          >
            <FullScreenIcon active={fsActive} />
          </button>
        )}
        <span className="iv-sep" aria-hidden="true" />
        <button
          type="button"
          className="iv-btn"
          aria-label="Close"
          title="Close (Esc)"
          onClick={() => onCloseRef.current()}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="iv-sr" role="status" aria-live="polite">
        {announce}
      </div>
    </div>,
    document.body,
  );
}

const ICON = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MinusIcon() {
  return (
    <svg {...ICON}>
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg {...ICON}>
      <line x1="3.5" y1="8" x2="12.5" y2="8" />
      <line x1="8" y1="3.5" x2="8" y2="12.5" />
    </svg>
  );
}
function CloseIcon() {
  return (
    <svg {...ICON}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}
function FullScreenIcon({ active }: { active: boolean }) {
  return active ? (
    <svg {...ICON}>
      <path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" />
    </svg>
  ) : (
    <svg {...ICON}>
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  );
}
