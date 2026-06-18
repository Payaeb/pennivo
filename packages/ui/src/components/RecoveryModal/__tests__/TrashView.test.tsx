import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrashEntry } from "@pennivo/core";

vi.mock("../../../platform", () => ({
  getPlatform: () => mockPlatform,
}));

let mockPlatform: {
  trash: {
    list: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    permanentlyDelete: ReturnType<typeof vi.fn>;
    sweep: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    onCountChanged: ReturnType<typeof vi.fn>;
  };
};

import { TrashView } from "../TrashView";

function fixtureTrash(): TrashEntry[] {
  // Two entries today, one a week ago.
  const now = Date.now();
  const todayMorning = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
    9,
    15,
  ).getTime();
  return [
    {
      id: "trash-3",
      absolutePath: "/ws/notes.md",
      fileBasename: "notes.md",
      deletedAtMs: now,
      expiresAtMs: now + 30 * 24 * 3600_000,
      hasAssets: false,
      assetFolderNames: [],
    },
    {
      id: "trash-2",
      absolutePath: "/ws/draft.md",
      fileBasename: "draft.md",
      deletedAtMs: todayMorning,
      expiresAtMs: todayMorning + 30 * 24 * 3600_000,
      hasAssets: false,
      assetFolderNames: [],
    },
    {
      id: "trash-1",
      absolutePath: "/ws/old.md",
      fileBasename: "old.md",
      deletedAtMs: now - 7 * 24 * 3600_000,
      expiresAtMs: now - 7 * 24 * 3600_000 + 30 * 24 * 3600_000,
      hasAssets: false,
      assetFolderNames: [],
    },
  ];
}

beforeEach(() => {
  mockPlatform = {
    trash: {
      list: vi.fn(async () => fixtureTrash()),
      restore: vi.fn(async (id: string) => ({ restoredPath: `/ws/${id}.md` })),
      permanentlyDelete: vi.fn(async () => true),
      sweep: vi.fn(async () => ({ removedCount: 0 })),
      read: vi.fn(async () => ({ content: "deleted body content" })),
      onCountChanged: vi.fn(() => () => {}),
    },
  };
});

function renderTrashView(
  overrides: Partial<{
    modalWidth: number;
  }> = {},
) {
  const onLayoutChange = vi.fn();
  const onShowToast = vi.fn();
  const utils = render(
    <TrashView
      onShowToast={onShowToast}
      timelineWidth={340}
      timelineCollapsed={false}
      previewCollapsed={false}
      onLayoutChange={onLayoutChange}
      modalWidth={overrides.modalWidth ?? 1080}
    />,
  );
  return { ...utils, onLayoutChange, onShowToast };
}

describe("TrashView", () => {
  it("renders the trash list grouped by deletion day", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    expect(screen.getByText(/^Today · /)).toBeInTheDocument();
    expect(screen.getByText("notes.md")).toBeInTheDocument();
    expect(screen.getByText("old.md")).toBeInTheDocument();
  });

  it("shows expiry hint per row", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    // 30 days expiry should render as "30d left" or "29d left" depending on
    // when the test runs through the wall clock; assert any "d left" text
    // exists for at least one row.
    const expiries = screen.getAllByText(/d left|h left|Expired|Never expires/);
    expect(expiries.length).toBeGreaterThanOrEqual(1);
  });

  it("Empty trash button shows for non-empty list and triggers confirm", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    fireEvent.click(screen.getByRole("button", { name: /Empty trash/i }));
    expect(
      await screen.findByRole("alertdialog", { name: /Empty trash/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Permanently delete all 3 file/i),
    ).toBeInTheDocument();
  });

  it("plain click selects a single row", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
  });

  it("shift-click selects a range", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    fireEvent.click(options[2], { shiftKey: true });
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(options[2].getAttribute("aria-selected")).toBe("true");
  });

  it("ctrl-click toggles individual rows", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    fireEvent.click(options[2], { ctrlKey: true });
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    expect(options[1].getAttribute("aria-selected")).toBe("false");
  });

  it("footer shows Restore + Delete-permanently when at least one is selected", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    expect(
      screen.getByRole("button", { name: /Restore selected \(1\)/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /Delete selected permanently \(1\)/i,
      }),
    ).toBeInTheDocument();
  });

  it("Delete selected permanently triggers a confirm dialog", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    fireEvent.click(
      screen.getByRole("button", { name: /Delete selected permanently/i }),
    );
    expect(
      await screen.findByRole("alertdialog", { name: /Delete permanently/i }),
    ).toBeInTheDocument();
  });

  it("preview pane renders trash content for single selection", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    await waitFor(() =>
      expect(screen.getByText("deleted body content")).toBeInTheDocument(),
    );
  });

  it("preview pane shows 'N files selected' for multi-selection", async () => {
    renderTrashView();
    await waitFor(() =>
      expect(screen.getAllByRole("option").length).toBeGreaterThanOrEqual(3),
    );
    const options = screen.getAllByRole("option");
    fireEvent.click(options[0]);
    fireEvent.click(options[1], { ctrlKey: true });
    await waitFor(() =>
      expect(screen.getByText(/2 files selected/i)).toBeInTheDocument(),
    );
  });

  it("preview empty state when nothing selected", async () => {
    mockPlatform.trash.list = vi.fn(async () => []);
    renderTrashView();
    await waitFor(() =>
      expect(screen.getByText(/Trash is empty/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/Select a deleted file to preview/i),
    ).toBeInTheDocument();
  });

  it("Empty trash button is disabled when trash is empty", async () => {
    mockPlatform.trash.list = vi.fn(async () => []);
    renderTrashView();
    await waitFor(() =>
      expect(screen.getByText(/Trash is empty/i)).toBeInTheDocument(),
    );
    const btn = screen.getByRole("button", { name: /Empty trash/i });
    expect(btn).toBeDisabled();
  });
});
