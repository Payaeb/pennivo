import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { RecoveryModal } from "../RecoveryModal";

describe("RecoveryModal", () => {
  it("renders nothing when open=false", () => {
    const { container } = render(
      <RecoveryModal
        open={false}
        mode="history"
        onModeChange={vi.fn()}
        onClose={vi.fn()}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the dialog with mode-derived title when open", () => {
    render(
      <RecoveryModal
        open
        mode="history"
        onModeChange={vi.fn()}
        onClose={vi.fn()}
      >
        <div>body content</div>
      </RecoveryModal>,
    );
    expect(screen.getByRole("dialog", { name: "History" })).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("uses provided title when given (e.g. `History — chapter-3.md`)", () => {
    render(
      <RecoveryModal
        open
        mode="history"
        title="History — chapter-3.md"
        onModeChange={vi.fn()}
        onClose={vi.fn()}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    expect(
      screen.getByRole("dialog", { name: "History — chapter-3.md" }),
    ).toBeInTheDocument();
  });

  it("renders the segmented control for History/Trash modes only", () => {
    const { rerender } = render(
      <RecoveryModal
        open
        mode="history"
        onModeChange={vi.fn()}
        onClose={vi.fn()}
      >
        <div>x</div>
      </RecoveryModal>,
    );
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Trash" })).toBeInTheDocument();

    rerender(
      <RecoveryModal
        open
        mode="compare-merge"
        onModeChange={vi.fn()}
        onClose={vi.fn()}
      >
        <div>x</div>
      </RecoveryModal>,
    );
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Trash" })).toBeNull();
  });

  it("clicking the Trash tab fires onModeChange('trash')", () => {
    const onModeChange = vi.fn();
    render(
      <RecoveryModal
        open
        mode="history"
        onModeChange={onModeChange}
        onClose={vi.fn()}
      >
        <div>x</div>
      </RecoveryModal>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Trash" }));
    expect(onModeChange).toHaveBeenCalledWith("trash");
  });

  it("clicking the History tab while in Trash mode fires onModeChange('history')", () => {
    const onModeChange = vi.fn();
    render(
      <RecoveryModal
        open
        mode="trash"
        onModeChange={onModeChange}
        onClose={vi.fn()}
      >
        <div>x</div>
      </RecoveryModal>,
    );
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(onModeChange).toHaveBeenCalledWith("history");
  });

  it("Esc key calls onClose", () => {
    const onClose = vi.fn();
    render(
      <RecoveryModal open mode="history" onModeChange={vi.fn()} onClose={onClose}>
        <div>x</div>
      </RecoveryModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the close button calls onClose", () => {
    const onClose = vi.fn();
    render(
      <RecoveryModal open mode="history" onModeChange={vi.fn()} onClose={onClose}>
        <div>x</div>
      </RecoveryModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clicking the overlay calls onClose; clicking inside does not", () => {
    const onClose = vi.fn();
    render(
      <RecoveryModal open mode="history" onModeChange={vi.fn()} onClose={onClose}>
        <div>body</div>
      </RecoveryModal>,
    );
    const overlay = document.querySelector(
      ".recovery-modal-overlay",
    ) as HTMLElement;
    fireEvent.click(overlay, { target: overlay });
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    fireEvent.click(screen.getByText("body"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("when onCloseRequest is set, the × button routes through it instead of onClose", () => {
    const onClose = vi.fn();
    const onCloseRequest = vi.fn();
    render(
      <RecoveryModal
        open
        mode="compare-merge"
        onModeChange={vi.fn()}
        onClose={onClose}
        onCloseRequest={onCloseRequest}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onCloseRequest).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("when onCloseRequest is set, clicking the overlay routes through it instead of onClose", () => {
    const onClose = vi.fn();
    const onCloseRequest = vi.fn();
    render(
      <RecoveryModal
        open
        mode="compare-merge"
        onModeChange={vi.fn()}
        onClose={onClose}
        onCloseRequest={onCloseRequest}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    const overlay = document.querySelector(
      ".recovery-modal-overlay",
    ) as HTMLElement;
    fireEvent.click(overlay, { target: overlay });
    expect(onCloseRequest).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc behavior is unchanged when onCloseRequest is set (Esc → onBack first if set, else onClose; never onCloseRequest)", () => {
    const onClose = vi.fn();
    const onBack = vi.fn();
    const onCloseRequest = vi.fn();
    const { rerender } = render(
      <RecoveryModal
        open
        mode="compare-merge"
        onModeChange={vi.fn()}
        onClose={onClose}
        onCloseRequest={onCloseRequest}
        onBack={onBack}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledOnce();
    expect(onCloseRequest).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    onBack.mockClear();
    rerender(
      <RecoveryModal
        open
        mode="history"
        onModeChange={vi.fn()}
        onClose={onClose}
        onCloseRequest={onCloseRequest}
      >
        <div>body</div>
      </RecoveryModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCloseRequest).not.toHaveBeenCalled();
  });
});
