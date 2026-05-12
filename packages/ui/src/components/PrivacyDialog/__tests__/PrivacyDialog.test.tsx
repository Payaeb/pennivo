import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PrivacyDialog } from "../PrivacyDialog";

// Stub the platform singleton so the dialog's link handler doesn't blow up
// trying to ipc.invoke(`shell:open-external`) inside jsdom.
const openExternal = vi.fn();
vi.mock("../../../platform", () => ({
  getPlatform: () => ({ openExternal }),
}));

beforeEach(() => {
  openExternal.mockClear();
});

describe("PrivacyDialog", () => {
  it("renders nothing when not visible", () => {
    const { container } = render(
      <PrivacyDialog visible={false} onClose={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the privacy notice content (offline, no GitHub link)", () => {
    render(<PrivacyDialog visible={true} onClose={vi.fn()} />);
    expect(
      screen.getByRole("dialog", { name: /Pennivo Privacy Notice/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Pennivo Privacy Notice" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Where your data lives" }),
    ).toBeInTheDocument();
    // Spot-check the canonical "what we never do" copy.
    expect(
      screen.getByText(/never sends your documents anywhere/i),
    ).toBeInTheDocument();
  });

  it("Close button fires onClose", () => {
    const onClose = vi.fn();
    render(<PrivacyDialog visible={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape key fires onClose", () => {
    const onClose = vi.fn();
    render(<PrivacyDialog visible={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay (but not the card) fires onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <PrivacyDialog visible={true} onClose={onClose} />,
    );
    const overlay = container.querySelector(".privacy-overlay")!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("body links route through platform.openExternal instead of navigating", () => {
    render(<PrivacyDialog visible={true} onClose={vi.fn()} />);
    const link = screen.getByRole("link", {
      name: /github.com\/payaeb\/pennivo/i,
    });
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith(
      "https://github.com/payaeb/pennivo",
    );
  });
});
