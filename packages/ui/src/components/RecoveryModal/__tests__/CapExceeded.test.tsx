import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CapExceededBanner, type CapWarning } from "../CapExceededBanner";
import { CapExceededToast } from "../CapExceededToast";

const SAMPLE: CapWarning = {
  kind: "cap-exceeded",
  currentBytes: 280 * 1024 * 1024,
  capBytes: 200 * 1024 * 1024,
  overageBytes: 80 * 1024 * 1024,
  protectedBytes: 80 * 1024 * 1024,
  protectedSnapshotCount: 12,
};

describe("CapExceededBanner", () => {
  it("renders the message + four actions", () => {
    const handlers = {
      onOpenSettings: vi.fn(),
      onChangeRules: vi.fn(),
      onManageManually: vi.fn(),
      onDismiss: vi.fn(),
    };
    render(<CapExceededBanner warning={SAMPLE} {...handlers} />);
    expect(
      screen.getByText(/12 protected snapshots are 80 MB over your 200 MB cap/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Settings" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Change rules" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Manage manually" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("fires the right handler per button", () => {
    const handlers = {
      onOpenSettings: vi.fn(),
      onChangeRules: vi.fn(),
      onManageManually: vi.fn(),
      onDismiss: vi.fn(),
    };
    render(<CapExceededBanner warning={SAMPLE} {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(handlers.onOpenSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Change rules" }));
    expect(handlers.onChangeRules).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Manage manually" }));
    expect(handlers.onManageManually).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(handlers.onDismiss).toHaveBeenCalledOnce();
  });
});

describe("CapExceededToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders with two actions and auto-dismisses after the timeout", () => {
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    render(
      <CapExceededToast
        warning={SAMPLE}
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
        autoDismissMs={500}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Open Settings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("Open Settings button fires its handler", () => {
    const onOpenSettings = vi.fn();
    const onDismiss = vi.fn();
    render(
      <CapExceededToast
        warning={SAMPLE}
        onOpenSettings={onOpenSettings}
        onDismiss={onDismiss}
        autoDismissMs={5000}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
