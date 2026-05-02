import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ConfirmDialog } from "../ConfirmDialog/ConfirmDialog";

describe("ConfirmDialog", () => {
  describe("Rendering", () => {
    it("renders nothing when open=false", () => {
      const { container } = render(
        <ConfirmDialog
          open={false}
          title="Delete file?"
          message="This will delete the file."
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders the title and message when open", () => {
      render(
        <ConfirmDialog
          open
          title="Delete file?"
          message='"file.md" will be permanently deleted.'
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Delete file?")).toBeInTheDocument();
      expect(
        screen.getByText('"file.md" will be permanently deleted.'),
      ).toBeInTheDocument();
    });

    it("uses default OK / Cancel labels", () => {
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("OK")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("uses custom button labels when provided", () => {
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          confirmLabel="Delete"
          cancelLabel="Keep"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByText("Delete")).toBeInTheDocument();
      expect(screen.getByText("Keep")).toBeInTheDocument();
    });

    it("applies the danger class when danger=true", () => {
      render(
        <ConfirmDialog
          open
          danger
          title="Confirm"
          message="?"
          confirmLabel="Delete"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const confirm = screen.getByText("Delete");
      expect(confirm).toHaveClass("confirm-dialog-btn--danger");
    });

    it("uses role=alertdialog with proper labelling", () => {
      render(
        <ConfirmDialog
          open
          title="Delete file?"
          message="?"
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const dialog = screen.getByRole("alertdialog", {
        name: "Delete file?",
      });
      expect(dialog).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("clicking confirm calls onConfirm", () => {
      const onConfirm = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("OK"));
      expect(onConfirm).toHaveBeenCalledOnce();
    });

    it("clicking cancel calls onCancel", () => {
      const onCancel = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      fireEvent.click(screen.getByText("Cancel"));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("Escape key calls onCancel", () => {
      const onCancel = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      fireEvent.keyDown(document, { key: "Escape" });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("clicking the backdrop calls onCancel", () => {
      const onCancel = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="?"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      const backdrop = document.querySelector(
        ".confirm-dialog-backdrop",
      ) as HTMLElement;
      fireEvent.mouseDown(backdrop, { target: backdrop });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("clicking inside the dialog does NOT call onCancel", () => {
      const onCancel = vi.fn();
      render(
        <ConfirmDialog
          open
          title="Confirm"
          message="Body text"
          onConfirm={vi.fn()}
          onCancel={onCancel}
        />,
      );
      fireEvent.mouseDown(screen.getByText("Body text"));
      expect(onCancel).not.toHaveBeenCalled();
    });
  });
});
