import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExternalChangeToast } from "../ExternalChangeToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ExternalChangeToast", () => {
  it("renders the message + View history + Dismiss buttons", () => {
    render(
      <ExternalChangeToast
        absolutePath="/p/x.md"
        onViewHistory={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/changed outside Pennivo/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("auto-dismisses after the default 30 second window", () => {
    const onDismiss = vi.fn();
    render(
      <ExternalChangeToast
        absolutePath="/p/x.md"
        onViewHistory={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    // Should still be visible at the old 6s mark — we explicitly extended
    // the window so writers actually have time to notice it.
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(24000);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("View history fires the callback", () => {
    const onViewHistory = vi.fn();
    render(
      <ExternalChangeToast
        absolutePath="/p/x.md"
        onViewHistory={onViewHistory}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(onViewHistory).toHaveBeenCalledOnce();
  });

  it("Dismiss fires the callback", () => {
    const onDismiss = vi.fn();
    render(
      <ExternalChangeToast
        absolutePath="/p/x.md"
        onViewHistory={vi.fn()}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("respects a custom autoDismissMs", () => {
    const onDismiss = vi.fn();
    render(
      <ExternalChangeToast
        absolutePath="/p/x.md"
        onViewHistory={vi.fn()}
        onDismiss={onDismiss}
        autoDismissMs={2500}
      />,
    );
    act(() => vi.advanceTimersByTime(2400));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
