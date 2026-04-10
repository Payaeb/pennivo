import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Mock the tablePlugin module since it depends on real DOM queries
vi.mock("../Editor/tablePlugin", () => ({
  getActiveTableElement: vi.fn(() => null),
}));

import { TableToolbar } from "../TableToolbar/TableToolbar";

describe("TableToolbar", () => {
  describe("Rendering", () => {
    it("renders add/delete row and column buttons", () => {
      render(<TableToolbar onAction={vi.fn()} />);
      expect(screen.getByTitle("Add row above")).toBeInTheDocument();
      expect(screen.getByTitle("Add row below")).toBeInTheDocument();
      expect(screen.getByTitle("Add column left")).toBeInTheDocument();
      expect(screen.getByTitle("Add column right")).toBeInTheDocument();
      expect(screen.getByTitle("Delete row")).toBeInTheDocument();
      expect(screen.getByTitle("Delete column")).toBeInTheDocument();
    });

    it("renders alignment buttons", () => {
      render(<TableToolbar onAction={vi.fn()} />);
      expect(screen.getByTitle("Align left")).toBeInTheDocument();
      expect(screen.getByTitle("Align center")).toBeInTheDocument();
      expect(screen.getByTitle("Align right")).toBeInTheDocument();
    });

    it("renders delete table button", () => {
      render(<TableToolbar onAction={vi.fn()} />);
      expect(screen.getByTitle("Delete table")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it("clicking add-row-below fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Add row below"));
      expect(onAction).toHaveBeenCalledWith("addRowBelow");
    });

    it("clicking add-row-above fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Add row above"));
      expect(onAction).toHaveBeenCalledWith("addRowAbove");
    });

    it("clicking add-col-left fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Add column left"));
      expect(onAction).toHaveBeenCalledWith("addColLeft");
    });

    it("clicking add-col-right fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Add column right"));
      expect(onAction).toHaveBeenCalledWith("addColRight");
    });

    it("clicking delete-row fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Delete row"));
      expect(onAction).toHaveBeenCalledWith("deleteRow");
    });

    it("clicking delete-col fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Delete column"));
      expect(onAction).toHaveBeenCalledWith("deleteCol");
    });

    it("clicking align-left fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Align left"));
      expect(onAction).toHaveBeenCalledWith("alignLeft");
    });

    it("clicking align-center fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Align center"));
      expect(onAction).toHaveBeenCalledWith("alignCenter");
    });

    it("clicking align-right fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Align right"));
      expect(onAction).toHaveBeenCalledWith("alignRight");
    });

    it("clicking delete-table fires correct action", () => {
      const onAction = vi.fn();
      render(<TableToolbar onAction={onAction} />);
      fireEvent.click(screen.getByTitle("Delete table"));
      expect(onAction).toHaveBeenCalledWith("deleteTable");
    });
  });
});
