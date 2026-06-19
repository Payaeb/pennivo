import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SearchResults } from "@pennivo/core";
import { GlobalSearchPanel } from "../GlobalSearchPanel";
import { joinWorkspacePath } from "../searchPanelUtils";

// A SearchResults fixture: "salmon" in two files (alpha once, notes/bravo
// twice across two lines), grouped + ranged so highlight spans can be checked.
function makeResults(query = "salmon"): SearchResults {
  return {
    query,
    totalMatches: 3,
    capped: false,
    files: [
      {
        path: "alpha.md",
        matchCount: 1,
        lines: [
          {
            line: 3,
            fileOffset: 12,
            snippet: "The salmon swam upstream.",
            truncatedStart: false,
            truncatedEnd: false,
            ranges: [{ start: 4, end: 10 }],
          },
        ],
      },
      {
        path: "notes/bravo.md",
        matchCount: 2,
        lines: [
          {
            line: 3,
            fileOffset: 9,
            snippet: "A salmon dinner.",
            truncatedStart: false,
            truncatedEnd: false,
            ranges: [{ start: 2, end: 8 }],
          },
          {
            line: 5,
            fileOffset: 27,
            snippet: "Another salmon line here.",
            truncatedStart: false,
            truncatedEnd: false,
            ranges: [{ start: 8, end: 14 }],
          },
        ],
      },
    ],
  };
}

const emptyResults: SearchResults = {
  query: "zzqqxx",
  files: [],
  totalMatches: 0,
  capped: false,
};

const baseProps = {
  rootPath: "/work/space",
  onSearch: vi.fn(async () => makeResults()),
  onOpenResult: vi.fn(),
  onClose: vi.fn(),
};

describe("joinWorkspacePath", () => {
  it("joins a POSIX-relative path onto a POSIX root", () => {
    expect(joinWorkspacePath("/work/space", "notes/todo.md")).toBe(
      "/work/space/notes/todo.md",
    );
  });

  it("joins onto a Windows root using backslashes", () => {
    expect(joinWorkspacePath("C:\\work\\space", "notes/todo.md")).toBe(
      "C:\\work\\space\\notes\\todo.md",
    );
  });

  it("trims a trailing slash on the root and a leading slash on the rel", () => {
    expect(joinWorkspacePath("/work/space/", "/alpha.md")).toBe(
      "/work/space/alpha.md",
    );
  });
});

describe("GlobalSearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it('shows the input and the "Type to search" empty state', () => {
      render(<GlobalSearchPanel {...baseProps} />);
      expect(
        screen.getByPlaceholderText("Search in workspace..."),
      ).toBeInTheDocument();
      expect(screen.getByText("Type to search")).toBeInTheDocument();
    });
  });

  describe("Debounced searching", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("does NOT search for a 1-char query", () => {
      const onSearch = vi.fn(async () => makeResults());
      render(<GlobalSearchPanel {...baseProps} onSearch={onSearch} />);
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "s" } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(onSearch).not.toHaveBeenCalled();
    });

    it("searches (debounced) once a query reaches 2 chars", async () => {
      const onSearch = vi.fn(async () => makeResults());
      render(<GlobalSearchPanel {...baseProps} onSearch={onSearch} />);
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "salmon" } });
      // Not yet, still inside the debounce window.
      expect(onSearch).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(onSearch).toHaveBeenCalledWith("salmon", {
        caseSensitive: false,
        wholeWord: false,
      });
    });
  });

  describe("Results", () => {
    it("renders grouped file headers, badges, line numbers, and highlights", async () => {
      render(<GlobalSearchPanel {...baseProps} />);
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "salmon" } });

      await waitFor(() =>
        expect(screen.getByText("alpha.md")).toBeInTheDocument(),
      );
      // File headers (relative POSIX paths).
      expect(screen.getByText("alpha.md")).toBeInTheDocument();
      expect(screen.getByText("notes/bravo.md")).toBeInTheDocument();
      // Match-count badges.
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
      // Line numbers (two distinct line-3 rows + a line-5 row).
      expect(screen.getAllByText("3").length).toBe(2);
      expect(screen.getByText("5")).toBeInTheDocument();
      // Highlight spans built from ranges.
      const marks = document.querySelectorAll(".global-search-highlight");
      expect(marks.length).toBe(3);
      marks.forEach((m) => expect(m.textContent).toBe("salmon"));
    });

    it('shows "No matches" after a search returns zero results', async () => {
      const onSearch = vi.fn(async () => emptyResults);
      render(<GlobalSearchPanel {...baseProps} onSearch={onSearch} />);
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "zzqqxx" } });
      await waitFor(() =>
        expect(screen.getByText("No matches")).toBeInTheDocument(),
      );
    });

    it("shows the capped footer when results.capped is true", async () => {
      const capped = { ...makeResults(), capped: true, totalMatches: 500 };
      const onSearch = vi.fn(async () => capped);
      render(<GlobalSearchPanel {...baseProps} onSearch={onSearch} />);
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "salmon" } });
      await waitFor(() =>
        expect(
          screen.getByText(/Showing first 500 matches/),
        ).toBeInTheDocument(),
      );
    });
  });

  describe("Keyboard navigation", () => {
    it("Enter opens the first result with the joined absolute path + line", async () => {
      const onOpenResult = vi.fn();
      render(
        <GlobalSearchPanel {...baseProps} onOpenResult={onOpenResult} />,
      );
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "salmon" } });
      await waitFor(() =>
        expect(screen.getByText("alpha.md")).toBeInTheDocument(),
      );
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onOpenResult).toHaveBeenCalledWith("/work/space/alpha.md", 3);
    });

    it("Arrow Down moves selection across files, then Enter opens that result", async () => {
      const onOpenResult = vi.fn();
      render(
        <GlobalSearchPanel {...baseProps} onOpenResult={onOpenResult} />,
      );
      const input = screen.getByPlaceholderText("Search in workspace...");
      fireEvent.change(input, { target: { value: "salmon" } });
      await waitFor(() =>
        expect(screen.getByText("alpha.md")).toBeInTheDocument(),
      );
      // alpha line3 -> bravo line3 -> bravo line5
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onOpenResult).toHaveBeenCalledWith("/work/space/notes/bravo.md", 5);
    });

    it("Escape clears a non-empty query, then closes when empty", () => {
      const onClose = vi.fn();
      render(<GlobalSearchPanel {...baseProps} onClose={onClose} />);
      const input = screen.getByPlaceholderText(
        "Search in workspace...",
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "salmon" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(input.value).toBe("");
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
