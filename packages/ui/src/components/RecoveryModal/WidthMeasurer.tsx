import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  /** Reports the measured width on mount + every resize. */
  onWidth: (width: number) => void;
  children: ReactNode;
}

/**
 * Renders a transparent flex-fill wrapper and reports its measured width
 * via ResizeObserver. Lets a parent know how wide the modal body is so
 * `HistoryView` can decide when to auto-collapse the timeline (sub-800px).
 *
 * Sits in its own file so the measurer can be unit-tested in isolation
 * (HistoryView's tests stub the width via the `modalWidth` prop directly).
 */
export function RecoveryModalWidthMeasurer({ onWidth, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    onWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        onWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onWidth]);

  return (
    <div
      ref={ref}
      style={{
        flex: "1 1 auto",
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {children}
    </div>
  );
}
