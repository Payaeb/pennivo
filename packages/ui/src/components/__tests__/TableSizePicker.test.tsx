import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TableSizePicker } from "../TableSizePicker/TableSizePicker";

const defaultAnchor = { top: 100, left: 100, bottom: 140 };

describe("TableSizePicker", () => {
  it("renders a grid of cells", () => {
    const { container } = render(
      <TableSizePicker
        anchorRect={defaultAnchor}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const cells = container.querySelectorAll(".table-size-cell");
    // Default grid is 5 rows x 6 cols = 30 cells
    expect(cells.length).toBe(30);
  });

  it("shows default label when no cell is hovered", () => {
    render(
      <TableSizePicker
        anchorRect={defaultAnchor}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Select table size")).toBeInTheDocument();
  });

  it("updates label on cell hover", () => {
    const { container } = render(
      <TableSizePicker
        anchorRect={defaultAnchor}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Hover over cell at row=2, col=3 (0-indexed) → label should be "4 × 3"
    const cells = container.querySelectorAll(".table-size-cell");
    // Row 2 is the 3rd row. In a 6-col grid, that cell is at index 2*6+3 = 15
    fireEvent.mouseEnter(cells[15]);
    expect(screen.getByText("4 × 3")).toBeInTheDocument();
  });

  it("highlights cells in the selection region on hover", () => {
    const { container } = render(
      <TableSizePicker
        anchorRect={defaultAnchor}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Hover over cell at row=1, col=2 (0-indexed) → should highlight 2x3 region (6 cells)
    const cells = container.querySelectorAll(".table-size-cell");
    fireEvent.mouseEnter(cells[1 * 6 + 2]); // row 1, col 2
    const activeCells = container.querySelectorAll(".table-size-cell--active");
    // Region: rows 0-1, cols 0-2 = 2*3 = 6 cells
    expect(activeCells.length).toBe(6);
  });

  it("calls onSelect with 1-indexed rows and cols on click", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <TableSizePicker
        anchorRect={defaultAnchor}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    const cells = container.querySelectorAll(".table-size-cell");
    // Click cell at row=2, col=3 → should call onSelect(3, 4)
    fireEvent.mouseDown(cells[2 * 6 + 3]);
    expect(onSelect).toHaveBeenCalledWith(3, 4);
  });
});
