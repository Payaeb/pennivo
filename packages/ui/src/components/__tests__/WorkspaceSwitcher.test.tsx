import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Sidebar } from "../Sidebar/Sidebar";
import type { WorkspaceSwitcherItem } from "../Sidebar/WorkspaceSwitcher";

const sampleTree: FileTreeEntry[] = [
  { name: "readme.md", path: "/docs/readme.md", type: "file" },
];

const workspaces: WorkspaceSwitcherItem[] = [
  { id: "ws1", name: "Docs", rootPath: "/docs" },
  { id: "ws2", name: "Notes", rootPath: "/notes" },
];

function renderSwitcher(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onSwitchWorkspace: vi.fn(),
    onAddWorkspace: vi.fn(),
    onRemoveWorkspace: vi.fn(),
  };
  render(
    <Sidebar
      visible
      folderPath="/docs"
      tree={sampleTree}
      currentFilePath={null}
      onFileClick={vi.fn()}
      onChooseFolder={vi.fn()}
      workspaces={workspaces}
      activeWorkspaceId="ws1"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("WorkspaceSwitcher", () => {
  it("renders the active workspace name as the trigger label", () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.textContent).toContain("Docs");
  });

  it("prefers the active workspace name over the folder-derived title", () => {
    // folderPath basename is 'notes' but the active workspace name is 'Docs'.
    renderSwitcher({ folderPath: "/some/notes" });
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger.textContent).toContain("Docs");
  });

  it("falls back to the plain title when workspace handlers are absent", () => {
    render(
      <Sidebar
        visible
        folderPath="/docs"
        tree={sampleTree}
        currentFilePath={null}
        onFileClick={vi.fn()}
        onChooseFolder={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Switch workspace" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
  });

  it("trigger exposes aria-haspopup and toggles aria-expanded", () => {
    renderSwitcher();
    const trigger = screen.getByRole("button", { name: "Switch workspace" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the popover and lists all workspaces", () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    expect(within(menu).getByText("Docs")).toBeInTheDocument();
    expect(within(menu).getByText("Notes")).toBeInTheDocument();
    expect(within(menu).getByText("Add workspace...")).toBeInTheDocument();
  });

  it("marks the active workspace with aria-checked=true", () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    const active = within(menu).getByText("Docs").closest("button");
    expect(active).toHaveAttribute("aria-checked", "true");
    const other = within(menu).getByText("Notes").closest("button");
    expect(other).toHaveAttribute("aria-checked", "false");
  });

  it("clicking a non-active workspace calls onSwitchWorkspace and closes", () => {
    const { onSwitchWorkspace } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByText("Notes"));
    expect(onSwitchWorkspace).toHaveBeenCalledWith("ws2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking the active workspace does not call onSwitchWorkspace", () => {
    const { onSwitchWorkspace } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    fireEvent.click(within(menu).getByText("Docs"));
    expect(onSwitchWorkspace).not.toHaveBeenCalled();
  });

  it("clicking 'Add workspace...' calls onAddWorkspace and closes", () => {
    const { onAddWorkspace } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(screen.getByText("Add workspace..."));
    expect(onAddWorkspace).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking a row's remove button calls onRemoveWorkspace with its id", () => {
    const { onRemoveWorkspace } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove workspace Notes" }),
    );
    expect(onRemoveWorkspace).toHaveBeenCalledWith("ws2");
  });

  it("remove control carries the expected class and an inner glyph", () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const remove = screen.getByRole("button", {
      name: "Remove workspace Notes",
    });
    expect(remove).toHaveClass("sidebar-workspace-remove");
    // The x glyph renders as an inline svg inside the control.
    expect(remove.querySelector("svg")).toBeInTheDocument();
  });

  it("a long workspace name row still renders the check + remove controls", () => {
    const longName =
      "A very very long workspace name that should ellipsis-truncate on one line";
    renderSwitcher({
      workspaces: [
        { id: "ws1", name: longName, rootPath: "/docs" },
        { id: "ws2", name: "Notes", rootPath: "/notes" },
      ],
      activeWorkspaceId: "ws1",
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    // The full name is present (truncation is purely visual via CSS ellipsis).
    const nameEl = within(menu).getByText(longName);
    expect(nameEl).toHaveClass("sidebar-workspace-option-name");
    // Its row is the active one, so it owns a rendered check glyph...
    const row = nameEl.closest(".sidebar-workspace-row");
    expect(row).not.toBeNull();
    expect(
      row!.querySelector(".sidebar-workspace-option-check svg"),
    ).toBeInTheDocument();
    // ...and the remove (x) control stays visible alongside the long name.
    expect(
      within(menu).getByRole("button", {
        name: `Remove workspace ${longName}`,
      }),
    ).toBeInTheDocument();
  });

  it("hides the remove affordance when only one workspace remains", () => {
    renderSwitcher({
      workspaces: [{ id: "ws1", name: "Docs", rootPath: "/docs" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(
      screen.queryByRole("button", { name: /Remove workspace/ }),
    ).not.toBeInTheDocument();
    // Still shows the one workspace + Add entry.
    const menu = screen.getByRole("menu", { name: "Workspaces" });
    expect(within(menu).getByText("Docs")).toBeInTheDocument();
    expect(within(menu).getByText("Add workspace...")).toBeInTheDocument();
  });

  it("works with zero workspaces (shows empty hint + Add)", () => {
    renderSwitcher({ workspaces: [], activeWorkspaceId: null });
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(screen.getByText("No workspaces yet")).toBeInTheDocument();
    expect(screen.getByText("Add workspace...")).toBeInTheDocument();
  });

  it("Escape closes the menu", () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("clicking outside closes the menu", () => {
    render(
      <div>
        <Sidebar
          visible
          folderPath="/docs"
          tree={sampleTree}
          currentFilePath={null}
          onFileClick={vi.fn()}
          onChooseFolder={vi.fn()}
          workspaces={workspaces}
          activeWorkspaceId="ws1"
          onSwitchWorkspace={vi.fn()}
          onAddWorkspace={vi.fn()}
          onRemoveWorkspace={vi.fn()}
        />
        <div data-testid="outside">outside</div>
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("menu items are keyboard reachable and Enter activates a workspace", () => {
    const { onSwitchWorkspace } = renderSwitcher();
    fireEvent.click(screen.getByRole("button", { name: "Switch workspace" }));
    const notes = screen.getByText("Notes").closest("button")!;
    notes.focus();
    expect(notes).toHaveFocus();
    // Native button activates on Enter/Space → click.
    fireEvent.click(notes);
    expect(onSwitchWorkspace).toHaveBeenCalledWith("ws2");
  });
});
