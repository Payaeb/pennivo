import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { FindReplace } from "../FindReplace/FindReplace";

// FindReplace deeply integrates with ProseMirror/CodeMirror views.
// We test the UI surface: rendering, input behavior, and close callbacks.
// Full search logic is deferred to E2E tests.

function renderFindReplace(
  overrides: Partial<Parameters<typeof FindReplace>[0]> = {},
) {
  const defaultProps = {
    visible: true,
    getView: () => null,
    onClose: vi.fn(),
    ...overrides,
  };
  return render(<FindReplace {...defaultProps} />);
}

describe("FindReplace", () => {
  describe("Rendering", () => {
    it("returns null when not visible", () => {
      const { container } = renderFindReplace({ visible: false });
      expect(container.firstChild).toBeNull();
    });

    it("shows search input when visible", () => {
      renderFindReplace();
      expect(screen.getByPlaceholderText("Find...")).toBeInTheDocument();
    });

    it("shows replace input", () => {
      renderFindReplace();
      expect(screen.getByPlaceholderText("Replace...")).toBeInTheDocument();
    });

    it("shows Replace and All buttons", () => {
      renderFindReplace();
      expect(screen.getByText("Replace")).toBeInTheDocument();
      expect(screen.getByText("All")).toBeInTheDocument();
    });

    it("shows regex toggle button", () => {
      renderFindReplace();
      expect(screen.getByText(".*")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("typing in search input updates the value", () => {
      renderFindReplace();
      const input = screen.getByPlaceholderText("Find...") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "hello" } });
      expect(input.value).toBe("hello");
    });

    it("pressing Escape calls onClose", () => {
      const onClose = vi.fn();
      renderFindReplace({ onClose });
      const input = screen.getByPlaceholderText("Find...");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("clicking close button calls onClose", () => {
      const onClose = vi.fn();
      renderFindReplace({ onClose });
      fireEvent.click(screen.getByTitle("Close (Escape)"));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("has Previous and Next match buttons", () => {
      renderFindReplace();
      expect(
        screen.getByTitle("Previous match (Shift+Enter)"),
      ).toBeInTheDocument();
      expect(screen.getByTitle("Next match (Enter)")).toBeInTheDocument();
    });
  });
});
