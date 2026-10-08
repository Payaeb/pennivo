import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ZoomBreadcrumb } from "../Editor/ZoomBreadcrumb";

describe("ZoomBreadcrumb", () => {
  it("renders Home plus each ancestor, root-first, then the current item", () => {
    render(
      <ZoomBreadcrumb
        ancestors={[
          { pos: 1, text: "Project plan" },
          { pos: 5, text: "Phase one" },
        ]}
        current="Zoomed task"
        onHome={vi.fn()}
        onAncestorClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Project plan")).toBeInTheDocument();
    expect(screen.getByText("Phase one")).toBeInTheDocument();
    expect(screen.getByText("Zoomed task")).toBeInTheDocument();
  });

  it("calls onHome when Home is clicked", () => {
    const onHome = vi.fn();
    render(
      <ZoomBreadcrumb
        ancestors={[]}
        current="Item"
        onHome={onHome}
        onAncestorClick={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("Home"));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("calls onAncestorClick with that ancestor's position", () => {
    const onAncestorClick = vi.fn();
    render(
      <ZoomBreadcrumb
        ancestors={[
          { pos: 10, text: "Parent" },
          { pos: 20, text: "Grandparent" },
        ]}
        current="Item"
        onHome={vi.fn()}
        onAncestorClick={onAncestorClick}
      />,
    );
    fireEvent.click(screen.getByText("Parent"));
    expect(onAncestorClick).toHaveBeenCalledWith(10);
    fireEvent.click(screen.getByText("Grandparent"));
    expect(onAncestorClick).toHaveBeenCalledWith(20);
  });

  it("renders the current crumb as non-clickable (no button role)", () => {
    render(
      <ZoomBreadcrumb
        ancestors={[]}
        current="Current item"
        onHome={vi.fn()}
        onAncestorClick={vi.fn()}
      />,
    );
    const current = screen.getByText("Current item");
    expect(current.tagName).not.toBe("BUTTON");
  });

  it("falls back to 'Untitled' for an empty crumb text", () => {
    render(
      <ZoomBreadcrumb
        ancestors={[{ pos: 1, text: "   " }]}
        current=""
        onHome={vi.fn()}
        onAncestorClick={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Untitled")).toHaveLength(2);
  });

  it("truncates long crumb text to ~40 chars with an ellipsis", () => {
    const longText =
      "This is a very long list item title that definitely exceeds forty characters";
    render(
      <ZoomBreadcrumb
        ancestors={[{ pos: 1, text: longText }]}
        current="short"
        onHome={vi.fn()}
        onAncestorClick={vi.fn()}
      />,
    );
    const rendered = screen.getByTitle(longText);
    expect(rendered.textContent!.length).toBeLessThanOrEqual(40);
    expect(rendered.textContent).toMatch(/…$/);
  });

  it("middle-ellipsizes long paths: Home, an ellipsis, then only the last ancestors", () => {
    render(
      <ZoomBreadcrumb
        ancestors={[
          { pos: 1, text: "one" },
          { pos: 2, text: "two" },
          { pos: 3, text: "three" },
          { pos: 4, text: "four" },
          { pos: 5, text: "five" },
        ]}
        current="current"
        onHome={vi.fn()}
        onAncestorClick={vi.fn()}
      />,
    );
    // Only the last 3 ancestors are shown, plus Home and an ellipsis.
    expect(screen.queryByText("one")).not.toBeInTheDocument();
    expect(screen.queryByText("two")).not.toBeInTheDocument();
    expect(screen.getByText("three")).toBeInTheDocument();
    expect(screen.getByText("four")).toBeInTheDocument();
    expect(screen.getByText("five")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
  });
});
