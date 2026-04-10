import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AppShell } from "../AppShell/AppShell";

function renderShell(overrides: Partial<Parameters<typeof AppShell>[0]> = {}) {
  const defaultProps = {
    toolbar: <div data-testid="toolbar">Toolbar</div>,
    children: <div data-testid="editor">Editor content</div>,
    ...overrides,
  };
  return render(<AppShell {...defaultProps} />);
}

describe("AppShell", () => {
  it("renders titlebar with filename", () => {
    renderShell({ filename: "notes.md" });
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });

  it("renders toolbar region", () => {
    renderShell();
    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
  });

  it("renders editor area with children", () => {
    renderShell();
    expect(screen.getByTestId("editor")).toBeInTheDocument();
  });

  it("renders statusbar with word/char counts", () => {
    renderShell({ wordCount: 42, charCount: 250 });
    expect(screen.getByText("42 words")).toBeInTheDocument();
    expect(screen.getByText("250 characters")).toBeInTheDocument();
  });

  it("renders sidebar when provided", () => {
    renderShell({
      sidebar: <div data-testid="sidebar">Sidebar</div>,
    });
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("renders outline when provided", () => {
    renderShell({
      outline: <div data-testid="outline">Outline</div>,
    });
    expect(screen.getByTestId("outline")).toBeInTheDocument();
  });

  it("renders findReplace when provided", () => {
    renderShell({
      findReplace: <div data-testid="find-replace">Find Replace</div>,
    });
    expect(screen.getByTestId("find-replace")).toBeInTheDocument();
  });

  it("applies focus mode class", () => {
    const { container } = renderShell({ focusMode: true });
    expect(container.querySelector(".app-shell--focus")).toBeInTheDocument();
  });

  it("applies source mode class", () => {
    const { container } = renderShell({ sourceMode: true });
    expect(container.querySelector(".app-shell--source")).toBeInTheDocument();
  });

  it("applies typewriter mode class", () => {
    const { container } = renderShell({ typewriterMode: true });
    expect(
      container.querySelector(".app-shell--typewriter"),
    ).toBeInTheDocument();
  });

  it('shows default filename "untitled" when no filename', () => {
    renderShell();
    expect(screen.getByText("untitled")).toBeInTheDocument();
  });

  it("renders window control buttons", () => {
    renderShell();
    expect(screen.getByTitle("Minimize")).toBeInTheDocument();
    expect(screen.getByTitle("Maximize")).toBeInTheDocument();
    expect(screen.getByTitle("Close")).toBeInTheDocument();
  });
});
