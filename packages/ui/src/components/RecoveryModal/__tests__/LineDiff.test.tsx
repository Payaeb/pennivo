import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { LineDiff } from "../LineDiff";

describe("LineDiff", () => {
  it("renders the empty-state copy when inputs are identical", () => {
    render(<LineDiff oldText="hello" newText="hello" />);
    expect(
      screen.getByText(/No changes between this snapshot/i),
    ).toBeInTheDocument();
  });

  it("renders + and − gutter glyphs for added / removed lines", () => {
    const oldText = "context\nold-line\ntrailing";
    const newText = "context\nnew-line\ntrailing";
    const { container } = render(
      <LineDiff oldText={oldText} newText={newText} />,
    );
    const gutters = Array.from(
      container.querySelectorAll(".line-diff-gutter"),
    ).map((el) => el.textContent);
    expect(gutters).toContain("+");
    expect(gutters).toContain("−");
  });

  it("tags rows inside fenced code blocks with the --code variant", () => {
    const oldText = ["intro", "```js", "let x = 1;", "```", "outro"].join("\n");
    const newText = ["intro", "```js", "let x = 2;", "```", "outro"].join("\n");
    const { container } = render(
      <LineDiff oldText={oldText} newText={newText} />,
    );
    // The changed code line gets the --code class.
    const rows = Array.from(container.querySelectorAll(".line-diff-row"));
    const codeRows = rows.filter((r) =>
      r.classList.contains("line-diff-row--code"),
    );
    expect(codeRows.length).toBeGreaterThan(0);
    // Spot-check: a line containing 'let x = 2;' (the addition) is a code row.
    const addedCodeRow = codeRows.find((r) =>
      (r.textContent ?? "").includes("let x = 2;"),
    );
    expect(addedCodeRow).toBeDefined();
  });

  it("renders the hunk separator when long unchanged stretches are collapsed", () => {
    const oldLines = Array.from({ length: 30 }, (_, i) => `line-${i}`).join(
      "\n",
    );
    const newLines = oldLines + "\nappended";
    render(<LineDiff oldText={oldLines} newText={newLines} />);
    expect(screen.getByText(/lines unchanged/i)).toBeInTheDocument();
  });
});
