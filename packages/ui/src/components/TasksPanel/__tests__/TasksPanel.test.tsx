import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TaskItem, LabeledItem } from "@pennivo/core";
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
      done: null,
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
      done: null,
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
      done: null,
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
      done: null,
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
      done: null,
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
      done: null,
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
      done: null,
      indent: 0,
    },
  ];
}

// Plain (non-checklist) labeled bullets for the Labels view — exercised by
// the "Labels mode" describe block below. Deliberately shares a label
// ("home") with one of makeItems()'s TaskItems ("Buy groceries") so the
// both-kinds-in-one-group behavior is covered.
function makeLabeledItems(): LabeledItem[] {
  return [
    {
      path: "notes.md",
      line: 1,
      charOffset: 20,
      rawText: "Big rewrite idea #ideas",
      displayText: "Big rewrite idea #ideas",
      labels: ["ideas"],
      due: null,
      indent: 0,
    },
    {
      path: "notes.md",
      line: 3,
      charOffset: 60,
      rawText: "Reorganize the pantry #home",
      displayText: "Reorganize the pantry #home",
      labels: ["home"],
      due: null,
      indent: 0,
    },
    {
      path: "errands.md",
      line: 0,
      charOffset: 0,
      rawText: "Renew passport #errands [due:: 2026-10-20]",
      displayText: "Renew passport #errands",
      labels: ["errands"],
      due: "2026-10-20",
      indent: 0,
    },
  ];
}

const baseProps = {
  rootPath: "/work/space",
  onLoad: vi.fn(async () => ({ items: makeItems(), labeledItems: [] })),
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
          onLoad={vi.fn(async () => ({ items: onlyOverdue, labeledItems: [] }))}
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
    it("renders a chip for every label when there are many (the row cap is CSS-only)", async () => {
      const labels = Array.from({ length: 40 }, (_, i) => `tag${i}`);
      const many: TaskItem[] = labels.map((label, i) => ({
        path: "many.md",
        line: i,
        charOffset: i * 10,
        checked: false,
        rawText: `Task ${i} #${label}`,
        displayText: `Task ${i}`,
        labels: [label],
        due: null,
        done: null,
        indent: 0,
      }));
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({ items: many, labeledItems: [] }))}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText("Task 0")).toBeInTheDocument(),
      );
      const group = screen.getByRole("group", { name: "Filter by label" });
      const chipTexts = Array.from(
        group.querySelectorAll(".tasks-panel-label-chip"),
      ).map((el) => el.textContent ?? "");
      // Every label renders a chip; the cap is CSS-only, nothing is dropped.
      labels.forEach((label) => {
        expect(chipTexts.some((t) => t.startsWith(`#${label}`))).toBe(true);
      });
      expect(chipTexts.length).toBeGreaterThanOrEqual(40);
    });

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
      const onLoad = vi.fn(async () => ({
        items: makeItems(),
        labeledItems: [],
      }));
      render(<TasksPanel {...baseProps} onLoad={onLoad} />);
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByLabelText("Refresh tasks"));
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    });

    it("a reloadSignal change triggers another onLoad call", async () => {
      const onLoad = vi.fn(async () => ({
        items: makeItems(),
        labeledItems: [],
      }));
      const { rerender } = render(
        <TasksPanel {...baseProps} onLoad={onLoad} reloadSignal={0} />,
      );
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));

      rerender(<TasksPanel {...baseProps} onLoad={onLoad} reloadSignal={1} />);
      await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    });
  });

  describe("Mode switch", () => {
    it("defaults to Tasks mode; clicking the Labels tab switches views", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      // Tasks mode shows agenda buckets, not label groups.
      expect(screen.getByText("Overdue")).toBeInTheDocument();
      expect(screen.queryByText("Big rewrite idea")).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));

      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );
      // Labels mode groups by label, not agenda bucket.
      expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
      // Switching tabs doesn't trigger a fresh onLoad — same loaded data,
      // just a different presentation.
    });

    it("hides the Tasks-mode label-chip filter row in Labels mode", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      expect(
        screen.getByRole("group", { name: "Filter by label" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );
      expect(
        screen.queryByRole("group", { name: "Filter by label" }),
      ).not.toBeInTheDocument();
    });
  });

  describe("Labels mode — grouping", () => {
    it("groups labeled bullets AND labeled tasks under the same label, sorted by label name", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      await waitFor(() =>
        expect(screen.getByText("Pay rent")).toBeInTheDocument(),
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );

      // Group headers appear in alphabetical label order: errands, home,
      // ideas, urgent.
      const headers = Array.from(
        document.querySelectorAll(
          ".tasks-panel-label-group-header .tasks-panel-chip--label",
        ),
      ).map((el) => el.textContent);
      expect(headers).toEqual(["#errands", "#home", "#ideas", "#urgent"]);

      // "home" is carried by BOTH a TaskItem ("Buy groceries", unchecked)
      // and a LabeledItem ("Reorganize the pantry") — both appear once,
      // composed from the two extractors without double-extraction.
      const homeHeader = Array.from(
        document.querySelectorAll(".tasks-panel-label-group-header"),
      ).find((h) => h.textContent?.startsWith("#home"));
      expect(homeHeader).toBeDefined();
      // Rows are siblings that follow the header until the next header.
      const homeRows: string[] = [];
      for (
        let el = homeHeader?.nextElementSibling;
        el && !el.classList.contains("tasks-panel-label-group-header");
        el = el.nextElementSibling
      ) {
        homeRows.push(
          el.querySelector(".tasks-panel-item-text")?.textContent ?? "",
        );
      }
      expect(homeRows.sort()).toEqual(
        ["Buy groceries", "Clean garage", "Reorganize the pantry"].sort(),
      );
      expect(screen.getByText("Buy groceries")).toBeInTheDocument();
      expect(screen.getByText("Reorganize the pantry")).toBeInTheDocument();
    });

    it("includes a CHECKED task's label group — Labels mode is not agenda-scoped", async () => {
      const checkedWithLabel: TaskItem = {
        path: "alpha.md",
        line: 9,
        charOffset: 200,
        checked: true,
        rawText: "Finished thing #archive",
        displayText: "Finished thing #archive",
        labels: ["archive"],
        due: null,
        done: "2026-10-05",
        indent: 0,
      };
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: [checkedWithLabel],
            labeledItems: [],
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Finished thing")).toBeInTheDocument(),
      );
      const headerChips = document.querySelectorAll(
        ".tasks-panel-label-group-header .tasks-panel-chip--label",
      );
      expect(Array.from(headerChips).map((el) => el.textContent)).toEqual([
        "#archive",
      ]);
    });

    it("renders a done chip on a checked task with a done date, and none when done is null", async () => {
      const finished: TaskItem = {
        path: "alpha.md",
        line: 9,
        charOffset: 200,
        checked: true,
        rawText: "Finished thing #archive [done:: 2026-10-05]",
        displayText: "Finished thing #archive",
        labels: ["archive"],
        due: null,
        done: "2026-10-05",
        indent: 0,
      };
      const noStamp: TaskItem = {
        ...finished,
        line: 11,
        charOffset: 260,
        rawText: "Open thing #archive",
        displayText: "Open thing #archive",
        checked: false,
        done: null,
      };
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: [finished, noStamp],
            labeledItems: [],
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Finished thing")).toBeInTheDocument(),
      );
      const doneChips = document.querySelectorAll(".tasks-panel-chip--done");
      expect(doneChips).toHaveLength(1);
      expect(doneChips[0].textContent).toBe("done 2026-10-05");
      expect(
        screen
          .getByText("Finished thing")
          .closest(".tasks-panel-item")
          ?.querySelector(".tasks-panel-chip--done"),
      ).not.toBeNull();
      expect(
        screen
          .getByText("Open thing")
          .closest(".tasks-panel-item")
          ?.querySelector(".tasks-panel-chip--done"),
      ).toBeNull();
    });

    it("renders a due chip on a labeled plain bullet", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Renew passport")).toBeInTheDocument(),
      );
      expect(screen.getByText("2026-10-20")).toBeInTheDocument();
    });

    it("the text filter narrows Labels mode by displayText", async () => {
      vi.useFakeTimers();
      try {
        render(
          <TasksPanel
            {...baseProps}
            onLoad={vi.fn(async () => ({
              items: makeItems(),
              labeledItems: makeLabeledItems(),
            }))}
          />,
        );
        fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
        await act(async () => {});
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument();

        const input = screen.getByPlaceholderText("Filter labeled items...");
        fireEvent.change(input, { target: { value: "passport" } });
        await act(async () => {
          vi.advanceTimersByTime(200);
        });

        expect(screen.getByText("Renew passport")).toBeInTheDocument();
        expect(screen.queryByText("Big rewrite idea")).not.toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("shows the empty-labels message when nothing carries a label", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({ items: [], labeledItems: [] }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("No labeled items")).toBeInTheDocument(),
      );
    });
  });

  describe("Labels mode — both-kinds rendering (dot vs checkbox glyph)", () => {
    it("renders a dot glyph for a plain labeled bullet and a checkbox glyph for a task", async () => {
      render(
        <TasksPanel
          {...baseProps}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );

      const bulletRow = screen
        .getByText("Big rewrite idea")
        .closest(".tasks-panel-item");
      const taskRow = screen
        .getByText("Buy groceries")
        .closest(".tasks-panel-item");

      // The bullet's glyph is a filled circle; the task's is a rect
      // (checkbox). Distinguish by querying the actual SVG child shape.
      expect(bulletRow?.querySelector("circle")).not.toBeNull();
      expect(bulletRow?.querySelector("rect")).toBeNull();
      expect(taskRow?.querySelector("rect")).not.toBeNull();
      expect(taskRow?.querySelector("circle")).toBeNull();
    });
  });

  describe("Labels mode — jump payloads", () => {
    it("clicking a labeled plain bullet calls onOpenTask with its own path/line/charOffset", async () => {
      const onOpenTask = vi.fn();
      render(
        <TasksPanel
          {...baseProps}
          onOpenTask={onOpenTask}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByText("Big rewrite idea"));
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/notes.md", {
        line: 2, // LabeledItem.line (1) + 1
        fileOffset: 20,
        query: "Big rewrite idea #ideas",
      });
    });

    it("clicking a labeled TASK (in Labels mode) jumps the same way as in Tasks mode", async () => {
      const onOpenTask = vi.fn();
      render(
        <TasksPanel
          {...baseProps}
          onOpenTask={onOpenTask}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Buy groceries")).toBeInTheDocument(),
      );

      fireEvent.click(screen.getByText("Buy groceries"));
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/bravo.md", {
        line: 2, // TaskItem.line (1) + 1
        fileOffset: 15,
        query: "Buy groceries #home",
      });
    });

    it("ArrowDown then Enter opens the first row of the first label group", async () => {
      const onOpenTask = vi.fn();
      render(
        <TasksPanel
          {...baseProps}
          onOpenTask={onOpenTask}
          onLoad={vi.fn(async () => ({
            items: makeItems(),
            labeledItems: makeLabeledItems(),
          }))}
        />,
      );
      fireEvent.click(screen.getByRole("tab", { name: "Labels" }));
      await waitFor(() =>
        expect(screen.getByText("Big rewrite idea")).toBeInTheDocument(),
      );

      const region = screen.getByRole("region", { name: "Tasks" });
      fireEvent.keyDown(region, { key: "ArrowDown" });
      fireEvent.keyDown(region, { key: "Enter" });

      // First group alphabetically is "#errands" (Renew passport).
      expect(onOpenTask).toHaveBeenCalledWith("/work/space/errands.md", {
        line: 1,
        fileOffset: 0,
        query: "Renew passport #errands",
      });
    });
  });
});
