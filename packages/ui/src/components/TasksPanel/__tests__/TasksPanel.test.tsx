import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TaskItem } from "@pennivo/core";
import { TasksPanel } from "../TasksPanel";

// "Today" for every test below. Chosen so the fixture's due dates land one
// per agenda bucket: weekEnd = today+6 = 2026-10-14, tomorrow = 2026-10-09.
const TODAY = "2026-10-08";

// One item per agenda bucket, plus a no-due item and a checked (done) item —
// spans the full AGENDA_BUCKET_ORDER plus the completed count.
function makeItems(): TaskItem[] {
  return [
    {
      path: "alpha.md",
      line: 0,
      charOffset: 10,
      checked: false,
      rawText: "Pay rent #urgent [due:: 2026-10-01]",
      displayText: "Pay rent #urgent",
      labels: ["urgent"],
      due: "2026-10-01", // overdue
      indent: 0,
    },
    {
      path: "alpha.md",
      line: 2,
      charOffset: 40,
      checked: false,
      rawText: "Call dentist [due:: 2026-10-08]",
      displayText: "Call dentist",
      labels: [],
      due: "2026-10-08", // today
      indent: 0,
    },
    {
      path: "bravo.md",
      line: 1,
      charOffset: 15,
      checked: false,
      rawText: "Buy groceries #home [due:: 2026-10-09]",
      displayText: "Buy groceries #home",
      labels: ["home"],
      due: "2026-10-09", // tomorrow
      indent: 0,
    },
    {
      path: "bravo.md",
      line: 3,
      charOffset: 60,
      checked: false,
      rawText: "Review PR #urgent [due:: 2026-10-12]",
      displayText: "Review PR #urgent",
      labels: ["urgent"],
      due: "2026-10-12", // this week
      indent: 0,
    },
    {
      path: "charlie.md",
      line: 0,
      charOffset: 5,
      checked: false,
      rawText: "Plan trip [due:: 2026-10-20]",
      displayText: "Plan trip",
      labels: [],
      due: "2026-10-20", // later
      indent: 0,
    },
    {
      path: "charlie.md",
      line: 2,
      charOffset: 25,
      checked: false,
      rawText: "Clean garage #home",
      displayText: "Clean garage #home",
      labels: ["home"],
      due: null, // no date
      indent: 0,
    },
    {
      path: "alpha.md",
      line: 5,
      charOffset: 90,
      checked: true,
      rawText: "Old done task",
      displayText: "Old done task",
      labels: [],
      due: null,
      indent: 0,
    },
  ];
}

const baseProps = {
  rootPath: "/work/space",
  onLoad: vi.fn(async () => ({ items: makeItems() })),
  onOpenTask: vi.fn(),
  onClose: vi.fn(),
  todayIso: TODAY,
};

describe("TasksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Agenda grouping", () => {
    it("renders bucket headers in AGENDA_BUCKET_ORDER, one item per bucket, with counts", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );

      const headerEls = screen.getAllByText(
        /^(Overdue|Today|Tomorrow|This Week|Later|No date)$/,
      );
      expect(headerEls.map((el) => el.textContent)).toEqual([
        "Overdue",
        "Today",
        "Tomorrow",
        "This Week",
        "Later",
        "No date",
      ]);
      // Each bucket's count badge is 1 (one item per bucket in the fixture).
      headerEls.forEach((header) => {
        const row = header.closest(".tasks-panel-section-header");
        expect(
          row?.querySelector(".tasks-panel-section-count")?.textContent,
        ).toBe("1");
      });

      expect(screen.getByText("Call dentist")).toBeInTheDocument();
      expect(screen.getByText("Buy groceries")).toBeInTheDocument();
      expect(screen.getByText("Review PR")).toBeInTheDocument();
      expect(screen.getByText("Plan trip")).toBeInTheDocument();
      expect(screen.getByText("Clean garage")).toBeInTheDocument();
      // The checked item never enters a bucket.
      expect(screen.queryByText("Old done task")).not.toBeInTheDocument();
    });

    it("omits a bucket header entirely when that bucket is empty", async () => {
      const onlyOverdue = [makeItems()[0]];
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({ items: onlyOverdue }))}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText("Overdue")).toBeInTheDocument(),
      );
      expect(screen.queryByText("Today")).not.toBeInTheDocument();
      expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
      expect(screen.queryByText("This Week")).not.toBeInTheDocument();
      expect(screen.queryByText("Later")).not.toBeInTheDocument();
      expect(screen.queryByText("No date")).not.toBeInTheDocument();
    });

    it("styles only the Overdue header with the danger class", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Overdue")).toBeInTheDocument(),
      );
      const overdueHeader = screen
        .getByText("Overdue")
        .closest(".tasks-panel-section-header");
      expect(overdueHeader).toHaveClass("tasks-panel-section-header--overdue");
      const todayHeader = screen
        .getByText("Today")
        .closest(".tasks-panel-section-header");
      expect(todayHeader).not.toHaveClass(
        "tasks-panel-section-header--overdue",
      );
    });

    it("shows the open/done summary using groupTasksByAgenda's completed count", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText(/6 open/)).toBeInTheDocument(),
      );
      expect(screen.getByText(/1 done/)).toBeInTheDocument();
    });
  });

  describe("Label filter", () => {
    it("narrows the list to items carrying the selected label (click toggles on)", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByRole("button", { name: /^#urgent/ }));
      expect(screen.getByText("Pay rent")).toBeInTheDocument();
      expect(screen.getByText("Review PR")).toBeInTheDocument();
      expect(screen.queryByText("Call dentist")).not.toBeInTheDocument();
      expect(screen.queryByText("Buy groceries")).not.toBeInTheDocument();
    });

    it('clicking "All" resets the label filter', async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /^#urgent/ }));
      expect(screen.queryByText("Call dentist")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "All" }));
      expect(screen.getByText("Call dentist")).toBeInTheDocument();
    });

    it("multiple selected labels combine with OR, not AND", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("button", { name: /^#urgent/ }));
      fireEvent.click(screen.getByRole("button", { name: /^#home/ }));

      expect(screen.getByText("Pay rent")).toBeInTheDocument();
      expect(screen.getByText("Review PR")).toBeInTheDocument();
      expect(screen.getByText("Buy groceries")).toBeInTheDocument();
      expect(screen.getByText("Clean garage")).toBeInTheDocument();
      // "Call dentist" carries neither label.
      expect(screen.queryByText("Call dentist")).not.toBeInTheDocument();
    });
  });

  describe("Text filter", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("filters displayText case-insensitively, debounced 200ms", async () => {
      render(<TasksPanel {...baseProps} />);
      // Flush the mount-time onLoad microtask under fake timers.
      await act(async () => {});
      expect(screen.getByText("Pay rent")).toBeInTheDocument();

      const input = screen.getByPlaceholderText("Filter tasks...");
      fireEvent.change(input, { target: { value: "GROCERIES" } });
      // Still inside the debounce window — nothing has been filtered yet.
      expect(screen.getByText("Call dentist")).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText("Buy groceries")).toBeInTheDocument();
      expect(screen.queryByText("Call dentist")).not.toBeInTheDocument();
      expect(screen.queryByText("Pay rent")).not.toBeInTheDocument();
    });
  });

  describe("Click / keyboard to jump", () => {
    it("clicking a task calls onOpenTask with the joined absolute path and a 1-based line + charOffset target", async () => {
      const onOpenTask = vi.fn();
      render(<TasksPanel {...baseProps} onOpenTask={onOpenTask} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByText("Pay rent"));
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/alpha.md", {
        line: 1, // TaskItem.line (0) + 1, matching GlobalSearchJumpTarget's 1-based convention
        fileOffset: 10,
        query: "Pay rent #urgent",
      });
    });

    it("no row is highlighted on open; ArrowDown selects the first row", async () => {
      render(<TasksPanel {...baseProps} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      // Mirrors GlobalSearchPanel's own keyboard-nav model: the list
      // populates with zero user interaction, so nothing should read as
      // selected until an explicit Arrow key moves into it.
      expect(
        document.querySelector(".tasks-panel-item--selected"),
      ).not.toBeInTheDocument();

      const region = screen.getByRole("region", { name: "Tasks" });
      fireEvent.keyDown(region, { key: "ArrowDown" });
      expect(screen.getByText("Pay rent").closest(".tasks-panel-item")).toBe(
        document.querySelector(".tasks-panel-item--selected"),
      );
    });

    it("Enter is a no-op before any Arrow key has selected a row", async () => {
      const onOpenTask = vi.fn();
      render(<TasksPanel {...baseProps} onOpenTask={onOpenTask} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      const region = screen.getByRole("region", { name: "Tasks" });
      fireEvent.keyDown(region, { key: "Enter" });
      expect(onOpenTask).not.toHaveBeenCalled();
    });

    it("ArrowDown then Enter opens the now-selected task", async () => {
      const onOpenTask = vi.fn();
      render(<TasksPanel {...baseProps} onOpenTask={onOpenTask} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      const region = screen.getByRole("region", { name: "Tasks" });
      fireEvent.keyDown(region, { key: "ArrowDown" });
      fireEvent.keyDown(region, { key: "Enter" });
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/alpha.md", {
        line: 1,
        fileOffset: 10,
        query: "Pay rent #urgent",
      });
    });

    it("ArrowUp before any selection jumps to the last row", async () => {
      const onOpenTask = vi.fn();
      render(<TasksPanel {...baseProps} onOpenTask={onOpenTask} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      const region = screen.getByRole("region", { name: "Tasks" });
      fireEvent.keyDown(region, { key: "ArrowUp" });
      fireEvent.keyDown(region, { key: "Enter" });
      // "Clean garage" is the last row (Later bucket's "Plan trip" is
      // followed by the No date bucket's "Clean garage", the final flat item).
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/charlie.md", {
        line: 3,
        fileOffset: 25,
        query: "Clean garage #home",
      });
    });

    it("Escape clears an active filter, then closes on the next Escape", async () => {
      const onClose = vi.fn();
      render(<TasksPanel {...baseProps} onClose={onClose} />);
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      const region = screen.getByRole("region", { name: "Tasks" });

      fireEvent.click(screen.getByRole("button", { name: /^#urgent/ }));
      expect(screen.queryByText("Call dentist")).not.toBeInTheDocument();

      fireEvent.keyDown(region, { key: "Escape" });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByText("Call dentist")).toBeInTheDocument(); // filter cleared

      fireEvent.keyDown(region, { key: "Escape" });
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe("Refresh", () => {
    it("the manual refresh button triggers another onLoad call", async () => {
      const onLoad = vi.fn(async () => ({ items: makeItems() }));
      render(<TasksPanel {...baseProps} onLoad={onLoad} />);
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByLabelText("Refresh tasks"));
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    });

    it("a reloadSignal change triggers another onLoad call", async () => {
      const onLoad = vi.fn(async () => ({ items: makeItems() }));
      const { rerender } = render(
        <TasksPanel {...baseProps} onLoad={onLoad} reloadSignal={0} />,
      );
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));

      rerender(<TasksPanel {...baseProps} onLoad={onLoad} reloadSignal={1} />);
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    });
  });
});
