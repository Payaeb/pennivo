import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Snapshot } from "@pennivo/core";

// Mock the platform module before importing HistoryView so the component
// picks up our stub instead of falling through to webPlatform's empty list.
vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

// Mutable reference rebuilt before each test.
let mockPlatform: {
  snapshot: {
    list: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    getCapStatus: ReturnType<typeof vi.fn>;
    onCapExceeded: ReturnType<typeof vi.fn>;
    onArchiveStatus: ReturnType<typeof vi.fn>;
    onExternalChangeDetected: ReturnType<typeof vi.fn>;
  };
};

import { HistoryView } from "../HistoryView";

function fixtureSnapshots(): Snapshot[] {
  // Two snapshots on the same day (today) and one a week ago.
  const today = new Date();
  const todayMorning = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    9,
    15,
  ).getTime();
  const todayAfternoon = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
    14,
    30,
  ).getTime();
  const weekAgo = todayMorning - 7 * 24 * 60 * 60 * 1000;
  return [
    {
      id: "snap-3",
      ts: todayAfternoon,
      sizeBytes: 4096,
      contentHash: "ccc",
      author: "user",
      deviceId: "device-A",
      deviceName: "this Mac",
    },
    {
      id: "snap-2",
      ts: todayMorning,
      sizeBytes: 3500,
      contentHash: "bbb",
      author: "mcp",
      agentName: "Claude",
      deviceId: "device-A",
      deviceName: "this Mac",
    },
    {
      id: "snap-1",
      ts: weekAgo,
      sizeBytes: 2000,
      contentHash: "aaa",
      author: "external",
      deviceId: "device-A",
      deviceName: "this Mac",
    },
  ];
}

beforeEach(() => {
  mockPlatform = {
    snapshot: {
      list: vi.fn(async () => fixtureSnapshots()),
      read: vi.fn(async () => ({ content: "old content", meta: {} })),
      restore: vi.fn(async () => ({ newPath: "/path/new.md" })),
      getCapStatus: vi.fn(async () => null),
      onCapExceeded: vi.fn(() => () => {}),
      onArchiveStatus: vi.fn(() => () => {}),
      onExternalChangeDetected: vi.fn(() => () => {}),
    },
  };
});

function renderHistoryView(
  overrides: Partial<{
    filePath: string | null;
    filename: string | null;
    currentContent: string;
    timelineWidth: number;
    timelineCollapsed: boolean;
    previewCollapsed: boolean;
    modalWidth: number;
  }> = {},
) {
  const onLayoutChange = vi.fn();
  const onOpenFilePath = vi.fn();
  const onShowToast = vi.fn();
  const onEnterCompareMerge = vi.fn();
  render(
    <HistoryView
      filePath={overrides.filePath ?? "/path/test.md"}
      filename={overrides.filename ?? "test.md"}
      currentContent={overrides.currentContent ?? "current content"}
      onOpenFilePath={onOpenFilePath}
      onShowToast={onShowToast}
      timelineWidth={overrides.timelineWidth ?? 340}
      timelineCollapsed={overrides.timelineCollapsed ?? false}
      previewCollapsed={overrides.previewCollapsed ?? false}
      onLayoutChange={onLayoutChange}
      modalWidth={overrides.modalWidth ?? 1080}
      onEnterCompareMerge={onEnterCompareMerge}
    />,
  );
  return { onLayoutChange, onOpenFilePath, onShowToast, onEnterCompareMerge };
}

describe("HistoryView", () => {
  it("renders the timeline grouped by day with full-date headers", async () => {
    renderHistoryView();
    // Wait for snapshots to load.
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    // The Today header must include the "Today" prefix.
    expect(screen.getByText(/^Today · /)).toBeInTheDocument();
  });

  it("renders attribution chips with the right text per author", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    // user → "you · this Mac"; mcp → "Claude (MCP)"; external → "external"
    expect(screen.getByText("you · this Mac")).toBeInTheDocument();
    expect(screen.getByText("Claude (MCP)")).toBeInTheDocument();
    expect(screen.getByText("external")).toBeInTheDocument();
  });

  it("auto-selects the newest snapshot so the diff renders immediately", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("shift-clicking selects a range; ctrl-click toggles", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    // Click row 0 -> only row 0.
    fireEvent.click(options[0]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    // Shift-click row 2 -> rows 0,1,2 selected.
    fireEvent.click(options[2], { shiftKey: true });
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    // Ctrl-click row 0 -> deselects row 0.
    fireEvent.click(options[0], { ctrlKey: true });
    expect(options[0].getAttribute("aria-selected")).toBe("false");
  });

  it("shows the empty state when no snapshots are returned", async () => {
    mockPlatform.snapshot.list = vi.fn(async () => []);
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getByText("No history yet.")).toBeInTheDocument(),
    );
  });

  it("Restore as current opens a confirm dialog", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Restore as current/i }),
    );
    expect(
      screen.getByRole("alertdialog", { name: /Restore snapshot/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/pre-restore snapshot will be taken/i),
    ).toBeInTheDocument();
  });

  it("preview tab toggles between Diff and Full", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const fullTab = screen.getByRole("tab", { name: "Full" });
    fireEvent.click(fullTab);
    expect(fullTab.getAttribute("aria-selected")).toBe("true");
  });

  it("collapse button on the timeline calls onLayoutChange", async () => {
    const { onLayoutChange } = renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    fireEvent.click(screen.getByRole("button", { name: /Collapse timeline/i }));
    expect(onLayoutChange).toHaveBeenCalledWith({ timelineCollapsed: true });
  });

  it("collapse button on the preview calls onLayoutChange", async () => {
    const { onLayoutChange } = renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    fireEvent.click(screen.getByRole("button", { name: /Collapse preview/i }));
    expect(onLayoutChange).toHaveBeenCalledWith({ previewCollapsed: true });
  });

  it("collapsed timeline shows a rail with an expand button", async () => {
    const { onLayoutChange } = renderHistoryView({ timelineCollapsed: true });
    fireEvent.click(screen.getByRole("button", { name: "Expand timeline" }));
    expect(onLayoutChange).toHaveBeenCalledWith({ timelineCollapsed: false });
  });

  it("auto-collapses timeline when modalWidth < 800", async () => {
    renderHistoryView({ modalWidth: 600 });
    // Auto-collapse renders the rail in place of the timeline.
    expect(
      screen.getByRole("button", { name: "Expand timeline" }),
    ).toBeInTheDocument();
  });

  it("compare-merge button is disabled with the 'select 2' label until exactly 2 are selected", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const btn = screen.getByRole("button", { name: /Compare & merge/i });
    // Default state: only the newest snapshot is auto-selected → disabled.
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/select 2/i);
    expect(btn.getAttribute("title")).toMatch(/select 2/i);
  });

  it("compare-merge button enables on exactly 2 selected and fires onEnterCompareMerge", async () => {
    const { onEnterCompareMerge } = renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    // Ctrl-click a second row → selection is exactly 2.
    fireEvent.click(options[1], { ctrlKey: true });
    const btn = screen.getByRole("button", { name: /Compare & merge/i });
    expect(btn).not.toBeDisabled();
    expect(btn.textContent).not.toMatch(/select 2/i);
    expect(btn.getAttribute("title")).toBeNull();
    fireEvent.click(btn);
    expect(onEnterCompareMerge).toHaveBeenCalledOnce();
  });

  it("compare-merge button disables again when selection grows past 2", async () => {
    renderHistoryView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[1], { ctrlKey: true });
    fireEvent.click(options[2], { ctrlKey: true });
    const btn = screen.getByRole("button", { name: /Compare & merge/i });
    expect(btn).toBeDisabled();
  });
});
