import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrashEntry, Workspace } from "@pennivo/core";

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
  // Two entries today, one a week ago. The two same-day entries are listed
  // OLDEST-first on purpose, so the raw array order diverges from the
  // newest-first render order (groupByLocalDay sorts desc). That makes the
  // shift-click range test exercise the group-ordering path deterministically
  // on every run, regardless of timezone or time of day — it's the divergence
  // that regressed range selection (range walked the array order, not the
  // visible order).
  const hour = 3600_000;
  const day = 24 * hour;
  const now = Date.now();
  const olderToday = now - 2 * hour;
  const weekAgo = now - 7 * day;
  return [
    {
      id: "trash-3",
      absolutePath: "/ws/notes.md",
      fileBasename: "notes.md",
      deletedAtMs: olderToday,
      expiresAtMs: olderToday + 30 * day,
      hasAssets: false,
      assetFolderNames: [],
    },
    {
      id: "trash-2",
      absolutePath: "/ws/draft.md",
      fileBasename: "draft.md",
      deletedAtMs: now,
      expiresAtMs: now + 30 * day,
      hasAssets: false,
      assetFolderNames: [],
    },
    {
      id: "trash-1",
      absolutePath: "/ws/old.md",
      fileBasename: "old.md",
      deletedAtMs: weekAgo,
      expiresAtMs: weekAgo + 30 * day,
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
    workspaces: Workspace[];
    activeWorkspaceId: string | null;
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
      workspaces={overrides.workspaces ?? []}
      activeWorkspaceId={overrides.activeWorkspaceId ?? null}
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

// ─── Phase 5: per-workspace trash scoping ───
//
// Two workspaces (alpha at /alpha, beta at /beta) with trashed files in each.
// The default view scopes to the active workspace; the "Show all workspaces"
// toggle reveals the global list. The on-disk store is unchanged — this is a
// pure render-side filter.

const TWO_WS: Workspace[] = [
  { id: "alpha", name: "alpha", rootPath: "/alpha" },
  { id: "beta", name: "beta", rootPath: "/beta" },
];

function fixtureTwoWorkspaceTrash(): TrashEntry[] {
  const day = 24 * 3600_000;
  const now = Date.now();
  return [
    {
      id: "trash-alpha-1",
      absolutePath: "/alpha/alpha-note.md",
      fileBasename: "alpha-note.md",
      deletedAtMs: now,
      expiresAtMs: now + 30 * day,
      hasAssets: false,
      assetFolderNames: [],
    },
    {
      id: "trash-beta-1",
      absolutePath: "/beta/beta-note.md",
      fileBasename: "beta-note.md",
      deletedAtMs: now,
      expiresAtMs: now + 30 * day,
      hasAssets: false,
      assetFolderNames: [],
    },
  ];
}

describe("TrashView — workspace scoping (Phase 5)", () => {
  beforeEach(() => {
    mockPlatform.trash.list = vi.fn(async () => fixtureTwoWorkspaceTrash());
  });

  it("default view shows only the active workspace's entries", async () => {
    renderTrashView({ workspaces: TWO_WS, activeWorkspaceId: "alpha" });
    await waitFor(() =>
      expect(screen.getByText("alpha-note.md")).toBeInTheDocument(),
    );
    expect(screen.queryByText("beta-note.md")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("renders an accessible 'Show all workspaces' checkbox toggle", async () => {
    renderTrashView({ workspaces: TWO_WS, activeWorkspaceId: "alpha" });
    await waitFor(() =>
      expect(screen.getByText("alpha-note.md")).toBeInTheDocument(),
    );
    const toggle = screen.getByRole("checkbox", {
      name: /Show all workspaces/i,
    });
    expect(toggle).toBeInTheDocument();
    expect(toggle).not.toBeChecked();
  });

  it("toggling Show all workspaces reveals every entry", async () => {
    renderTrashView({ workspaces: TWO_WS, activeWorkspaceId: "alpha" });
    await waitFor(() =>
      expect(screen.getByText("alpha-note.md")).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Show all workspaces/i }),
    );
    await waitFor(() =>
      expect(screen.getByText("beta-note.md")).toBeInTheDocument(),
    );
    expect(screen.getByText("alpha-note.md")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("filtered empty state hints that other workspaces have trashed items", async () => {
    // Active workspace 'beta' but seed only an alpha entry, then add another
    // workspace 'gamma' with no entries as the active one.
    mockPlatform.trash.list = vi.fn(async () => [
      fixtureTwoWorkspaceTrash()[0], // only the alpha entry
    ]);
    renderTrashView({
      workspaces: [
        ...TWO_WS,
        { id: "gamma", name: "gamma", rootPath: "/gamma" },
      ],
      activeWorkspaceId: "gamma",
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Other workspaces have trashed items/i),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("alpha-note.md")).not.toBeInTheDocument();
  });

  it("hides the toggle and shows all entries with no active workspace", async () => {
    renderTrashView({ workspaces: TWO_WS, activeWorkspaceId: null });
    await waitFor(() =>
      expect(screen.getByText("alpha-note.md")).toBeInTheDocument(),
    );
    expect(screen.getByText("beta-note.md")).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /Show all workspaces/i }),
    ).not.toBeInTheDocument();
  });
});
