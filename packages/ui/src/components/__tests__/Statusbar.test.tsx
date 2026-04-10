import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Statusbar } from "../Statusbar/Statusbar";

describe("Statusbar", () => {
  it("displays word count and character count", () => {
    render(<Statusbar wordCount={150} charCount={800} saveStatus="saved" />);
    expect(screen.getByText("150 words")).toBeInTheDocument();
    expect(screen.getByText("800 characters")).toBeInTheDocument();
  });

  it("formats large numbers with locale separators", () => {
    render(<Statusbar wordCount={1500} charCount={8000} saveStatus="saved" />);
    expect(screen.getByText("1,500 words")).toBeInTheDocument();
    expect(screen.getByText("8,000 characters")).toBeInTheDocument();
  });

  it("displays reading time for short text", () => {
    render(<Statusbar wordCount={100} charCount={500} saveStatus="saved" />);
    expect(screen.getByText("< 1 min read")).toBeInTheDocument();
  });

  it("displays reading time for longer text", () => {
    render(<Statusbar wordCount={500} charCount={2500} saveStatus="saved" />);
    expect(screen.getByText("3 min read")).toBeInTheDocument();
  });

  it('shows "Saved" status', () => {
    render(<Statusbar wordCount={0} charCount={0} saveStatus="saved" />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it('shows "Saving…" status', () => {
    render(<Statusbar wordCount={0} charCount={0} saveStatus="saving" />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });

  it('shows "Unsaved" status', () => {
    render(<Statusbar wordCount={0} charCount={0} saveStatus="unsaved" />);
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });

  it("updates when props change", () => {
    const { rerender } = render(
      <Statusbar wordCount={100} charCount={500} saveStatus="saved" />,
    );
    expect(screen.getByText("100 words")).toBeInTheDocument();

    rerender(
      <Statusbar wordCount={200} charCount={1000} saveStatus="unsaved" />,
    );
    expect(screen.getByText("200 words")).toBeInTheDocument();
    expect(screen.getByText("1,000 characters")).toBeInTheDocument();
    expect(screen.getByText("Unsaved")).toBeInTheDocument();
  });
});
