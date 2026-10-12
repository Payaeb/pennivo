// Popover shown when the user types `[due::` inside a list item (see
// dueDatePickerPlugin.ts for the trigger logic). Rendered via a portal to
// document.body — the editor scroll area clips overflow, so a popover
// anchored near the cursor (which can be deep in a long document) needs to
// escape that clipping the same way a browser's native autocomplete would.
//
// Deliberately never steals focus: no autoFocus, no .focus() call anywhere
// in this file. The user must be free to keep typing the date by hand while
// this is open (Editor.tsx mirrors the plugin's trigger state on every
// keystroke and closes this the moment the trigger stops matching). This
// component only owns the two EXPLICIT dismiss paths the spec calls out —
// Escape and clicking outside — neither of which depends on focus ever
// having been here.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./DueDatePicker.css";

export interface DueDatePickerAnchor {
  /** Viewport-relative coordinates from view.coordsAtPos — same shape
   *  ProseMirror's own coordsAtPos returns. */
  top: number;
  bottom: number;
  left: number;
}

export interface DueDatePickerProps {
  anchor: DueDatePickerAnchor;
  /** Called with a canonical `YYYY-MM-DD` string once the user picks one,
   *  via a quick pick or the date input. */
  onPick: (iso: string) => void;
  /** Called on Escape or an outside click — dismiss without inserting. */
  onClose: () => void;
}

const GAP = 6;
const VIEWPORT_MARGIN = 8;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local (not UTC) `YYYY-MM-DD`, matching the rest of Pennivo's date
 *  formatting (e.g. App.tsx's formatLocalIsoDate for the Tasks panel). */
function toLocalIso(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** The next upcoming Monday STRICTLY after `date` — if `date` itself is a
 *  Monday, this is 7 days out (next week's Monday), not today. Starts the
 *  search at tomorrow so "today" is never returned. */
function nextMonday(date: Date): Date {
  let d = addDays(date, 1);
  while (d.getDay() !== 1) {
    d = addDays(d, 1);
  }
  return d;
}

export function DueDatePicker({ anchor, onPick, onClose }: DueDatePickerProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number }>({
    top: anchor.bottom + GAP,
    left: anchor.left,
  });

  // Computed once per mount — "popover-open time" per spec, so every quick
  // pick in a single popover session is relative to the same reference
  // instant even if the user lingers across a clock tick.
  const now = useMemo(() => new Date(), []);

  // Measure after first paint and flip above the cursor if there's no room
  // below; clamp horizontally so it never runs off the right edge either.
  useLayoutEffect(() => {
    const el = popoverRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const fitsBelow =
      anchor.bottom + GAP + rect.height + VIEWPORT_MARGIN <= window.innerHeight;
    const top = fitsBelow
      ? anchor.bottom + GAP
      : Math.max(VIEWPORT_MARGIN, anchor.top - GAP - rect.height);

    const maxLeft = window.innerWidth - rect.width - VIEWPORT_MARGIN;
    const left = Math.min(anchor.left, Math.max(VIEWPORT_MARGIN, maxLeft));

    setStyle({ top, left });
    // anchor is a plain object recomputed by the caller on every relevant
    // transaction — compare its fields, not identity.
  }, [anchor.top, anchor.bottom, anchor.left]);

  // Escape anywhere (the editor still has focus while typing-through is in
  // effect, so this must be a document listener, not an onKeyDown on our
  // own — unfocused — DOM). Click outside both the editor and this popover
  // also dismisses; a click that lands back in the editor is handled by the
  // natural selection-driven close in Editor.tsx instead; calling onClose
  // there too is harmless (idempotent).
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    function handleMouseDown(event: MouseEvent): void {
      if (popoverRef.current?.contains(event.target as Node)) return;
      onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  const quickPicks: Array<{ label: string; date: Date }> = [
    { label: "Today", date: now },
    { label: "Tomorrow", date: addDays(now, 1) },
    { label: "Next week", date: addDays(now, 7) },
    { label: "Next Monday", date: nextMonday(now) },
  ];

  return createPortal(
    <div
      ref={popoverRef}
      className="due-date-picker"
      style={{ top: style.top, left: style.left }}
      role="dialog"
      aria-label="Pick a due date"
    >
      <div className="due-date-picker-quick-picks">
        {quickPicks.map((qp) => (
          <button
            key={qp.label}
            type="button"
            className="due-date-picker-quick-pick"
            onClick={() => onPick(toLocalIso(qp.date))}
          >
            {qp.label}
          </button>
        ))}
      </div>
      <label htmlFor="due-date-picker-input" className="sr-only">
        Due date
      </label>
      <input
        id="due-date-picker-input"
        type="date"
        className="due-date-picker-input"
        onChange={(event) => {
          // Chromium fires change at the first typed year digit
          // ("0002-10-12"); ignore implausible years until the year settles.
          const v = event.target.value;
          if (v && v >= "1000-01-01") onPick(v);
        }}
      />
    </div>,
    document.body,
  );
}
