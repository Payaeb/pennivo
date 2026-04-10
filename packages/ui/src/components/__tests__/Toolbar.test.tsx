import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  Toolbar,
  DEFAULT_TOOLBAR_CONFIG,
  TOOLTIP_DATA,
} from "../Toolbar/Toolbar";

describe("Toolbar", () => {
  describe("Rendering", () => {
    it("renders all default toolbar buttons", () => {
      render(<Toolbar />);
      for (const action of DEFAULT_TOOLBAR_CONFIG) {
        const label = TOOLTIP_DATA[action]?.label ?? action;
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });

    it("renders with custom visibleActions subset", () => {
      render(<Toolbar visibleActions={["bold", "italic"]} />);
      expect(screen.getByLabelText("Bold")).toBeInTheDocument();
      expect(screen.getByLabelText("Italic")).toBeInTheDocument();
      expect(screen.queryByLabelText("Strikethrough")).not.toBeInTheDocument();
    });

    it("always renders right-side buttons (source, theme, focus)", () => {
      render(<Toolbar />);
      expect(screen.getByLabelText("Source mode")).toBeInTheDocument();
      expect(screen.getByLabelText("Toggle theme")).toBeInTheDocument();
      expect(screen.getByLabelText("Focus mode")).toBeInTheDocument();
    });
  });

  describe("Interaction", () => {
    it('clicking bold button calls onAction("bold")', () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} />);
      fireEvent.click(screen.getByLabelText("Bold"));
      expect(onAction).toHaveBeenCalledWith("bold");
    });

    it('clicking italic button calls onAction("italic")', () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} />);
      fireEvent.click(screen.getByLabelText("Italic"));
      expect(onAction).toHaveBeenCalledWith("italic");
    });

    it("clicking heading buttons fires correct actions", () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} />);
      fireEvent.click(screen.getByLabelText("Heading 1"));
      expect(onAction).toHaveBeenCalledWith("h1");
      fireEvent.click(screen.getByLabelText("Heading 2"));
      expect(onAction).toHaveBeenCalledWith("h2");
    });

    it("clicking list buttons fires correct actions", () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} />);
      fireEvent.click(screen.getByLabelText("Bullet List"));
      expect(onAction).toHaveBeenCalledWith("bulletList");
      fireEvent.click(screen.getByLabelText("Ordered List"));
      expect(onAction).toHaveBeenCalledWith("orderedList");
      fireEvent.click(screen.getByLabelText("Task List"));
      expect(onAction).toHaveBeenCalledWith("taskList");
      fireEvent.click(screen.getByLabelText("Blockquote"));
      expect(onAction).toHaveBeenCalledWith("blockquote");
    });

    it("clicking insert buttons fires correct actions", () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} />);
      fireEvent.click(screen.getByLabelText("Link"));
      expect(onAction).toHaveBeenCalledWith("link");
      fireEvent.click(screen.getByLabelText("Image"));
      expect(onAction).toHaveBeenCalledWith("image");
      fireEvent.click(screen.getByLabelText("Code"));
      expect(onAction).toHaveBeenCalledWith("code");
      fireEvent.click(screen.getByLabelText("Table"));
      expect(onAction).toHaveBeenCalledWith("table");
    });

    it("source mode and theme toggle still fire in source mode", () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} sourceMode={true} />);
      fireEvent.click(screen.getByLabelText("Source mode"));
      expect(onAction).toHaveBeenCalledWith("sourceMode");
      fireEvent.click(screen.getByLabelText("Toggle theme"));
      expect(onAction).toHaveBeenCalledWith("toggleTheme");
      fireEvent.click(screen.getByLabelText("Focus mode"));
      expect(onAction).toHaveBeenCalledWith("focusMode");
    });
  });

  describe("Active State", () => {
    it("bold button shows active state via aria-pressed", () => {
      render(<Toolbar activeFormats={new Set(["bold"])} />);
      expect(screen.getByLabelText("Bold")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("multiple buttons can be active simultaneously", () => {
      render(<Toolbar activeFormats={new Set(["bold", "italic", "h1"])} />);
      expect(screen.getByLabelText("Bold")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByLabelText("Italic")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByLabelText("Heading 1")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByLabelText("Link")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("active state updates when activeFormats prop changes", () => {
      const { rerender } = render(
        <Toolbar activeFormats={new Set(["bold"])} />,
      );
      expect(screen.getByLabelText("Bold")).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      rerender(<Toolbar activeFormats={new Set(["italic"])} />);
      expect(screen.getByLabelText("Bold")).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByLabelText("Italic")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
  });

  describe("Source Mode", () => {
    it("formatting buttons are aria-disabled in source mode", () => {
      render(<Toolbar sourceMode={true} />);
      expect(screen.getByLabelText("Bold")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByLabelText("Italic")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.getByLabelText("Link")).toHaveAttribute(
        "aria-disabled",
        "true",
      );
    });

    it("disabled buttons do not fire onAction", () => {
      const onAction = vi.fn();
      render(<Toolbar onAction={onAction} sourceMode={true} />);
      fireEvent.click(screen.getByLabelText("Bold"));
      expect(onAction).not.toHaveBeenCalledWith("bold");
    });
  });

  describe("Toolbar role", () => {
    it('has role="toolbar" with accessible label', () => {
      render(<Toolbar />);
      expect(screen.getByRole("toolbar")).toHaveAttribute(
        "aria-label",
        "Formatting",
      );
    });
  });
});
