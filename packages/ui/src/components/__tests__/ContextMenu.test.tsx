import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ContextMenu, type ContextMenuEntry } from "../ContextMenu/ContextMenu";

const items: ContextMenuEntry[] = [
  { type: "item", label: "Open", onClick: vi.fn() },
  { type: "item", label: "Rename", onClick: vi.fn() },
  { type: "separator" },
  { type: "item", label: "Delete", onClick: vi.fn(), danger: true },
];

describe("ContextMenu", () => {
  describe("Rendering", () => {
    it("renders all item labels", () => {
      render(<ContextMenu x={50} y={50} items={items} onClose={vi.fn()} />);
      expect(screen.getByText("Open")).toBeInTheDocument();
      expect(screen.getByText("Rename")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

    it("renders separators with role=separator", () => {
      render(<ContextMenu x={50} y={50} items={items} onClose={vi.fn()} />);
      const separators = screen.getAllByRole("separator");
      expect(separators).toHaveLength(1);
    });

    it("applies the danger class to danger items", () => {
      render(<ContextMenu x={50} y={50} items={items} onClose={vi.fn()} />);
      const deleteBtn = screen.getByText("Delete").closest("button");
      expect(deleteBtn).toHaveClass("context-menu-item--danger");
    });

    it("uses the provided ariaLabel", () => {
      render(
        <ContextMenu
          x={50}
          y={50}
          items={items}
          onClose={vi.fn()}
          ariaLabel="Actions for file.md"
        />,
      );
      expect(
        screen.getByRole("menu", { name: "Actions for file.md" }),
      ).toBeInTheDocument();
    });

    it("disables disabled items via the disabled attribute", () => {
      const disabledItems: ContextMenuEntry[] = [
        { type: "item", label: "Locked", onClick: vi.fn(), disabled: true },
      ];
      render(
        <ContextMenu x={0} y={0} items={disabledItems} onClose={vi.fn()} />,
      );
      const btn = screen.getByText("Locked").closest("button");
      expect(btn).toBeDisabled();
    });
  });

  describe("Interaction", () => {
    it("clicking an item calls its onClick and closes the menu", () => {
      const onClose = vi.fn();
      const onOpen = vi.fn();
      render(
        <ContextMenu
          x={0}
          y={0}
          items={[{ type: "item", label: "Open", onClick: onOpen }]}
          onClose={onClose}
        />,
      );
      fireEvent.click(screen.getByText("Open"));
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("Escape calls onClose", () => {
      const onClose = vi.fn();
      render(<ContextMenu x={0} y={0} items={items} onClose={onClose} />);
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("ArrowDown moves focus to the first item, then to the next", () => {
      render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement?.textContent).toContain("Open");
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement?.textContent).toContain("Rename");
    });

    it("ArrowDown skips separators (Delete is third focusable)", () => {
      render(<ContextMenu x={0} y={0} items={items} onClose={vi.fn()} />);
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      expect(document.activeElement?.textContent).toContain("Delete");
    });

    it("Enter activates the focused item", () => {
      const onOpen = vi.fn();
      const onClose = vi.fn();
      render(
        <ContextMenu
          x={0}
          y={0}
          items={[{ type: "item", label: "Open", onClick: onOpen }]}
          onClose={onClose}
        />,
      );
      const menu = screen.getByRole("menu");
      fireEvent.keyDown(menu, { key: "ArrowDown" });
      fireEvent.keyDown(menu, { key: "Enter" });
      expect(onOpen).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("outside mousedown calls onClose (after the deferred attach tick)", async () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      render(
        <div>
          <ContextMenu x={0} y={0} items={items} onClose={onClose} />
          <div data-testid="outside">outside</div>
        </div>,
      );
      // Advance past the setTimeout(0) that defers the listener attachment
      act(() => {
        vi.runAllTimers();
      });
      fireEvent.mouseDown(screen.getByTestId("outside"));
      expect(onClose).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });
  });
});
