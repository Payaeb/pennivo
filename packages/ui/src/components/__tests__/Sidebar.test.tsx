import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Sidebar } from "../Sidebar/Sidebar";

const sampleTree: FileTreeEntry[] = [
  {
    name: "notes",
    path: "/docs/notes",
    type: "folder",
    children: [
      { name: "todo.md", path: "/docs/notes/todo.md", type: "file" },
      { name: "ideas.md", path: "/docs/notes/ideas.md", type: "file" },
    ],
  },
  { name: "readme.md", path: "/docs/readme.md", type: "file" },
  { name: "guide.md", path: "/docs/guide.md", type: "file" },
];

const defaultProps = {
  visible: true,
  folderPath: "/docs",
  tree: sampleTree,
  currentFilePath: null as string | null,
  onFileClick: vi.fn(),
  onChooseFolder: vi.fn(),
};

describe("Sidebar", () => {
  describe("Rendering", () => {
    it("returns null when visible=false", () => {
      const { container } = render(
        <Sidebar {...defaultProps} visible={false} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("renders folder name in header", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText("docs")).toBeInTheDocument();
    });

    it("renders files in tree", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText("readme.md")).toBeInTheDocument();
      expect(screen.getByText("guide.md")).toBeInTheDocument();
    });

    it("renders folders in tree", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText("notes")).toBeInTheDocument();
    });

    it("shows empty state when folderPath is null", () => {
      render(<Sidebar {...defaultProps} folderPath={null} tree={[]} />);
      expect(
        screen.getByText("Open a folder to browse files"),
      ).toBeInTheDocument();
    });

    it('shows "No markdown files yet" when folder is set but tree is empty', () => {
      render(<Sidebar {...defaultProps} tree={[]} />);
      expect(screen.getByText("No markdown files yet")).toBeInTheDocument();
    });

    it("highlights current file", () => {
      const { container } = render(
        <Sidebar {...defaultProps} currentFilePath="/docs/readme.md" />,
      );
      const activeItem = container.querySelector(".tree-item--active");
      expect(activeItem).toBeInTheDocument();
      expect(activeItem?.textContent).toContain("readme.md");
    });
  });

  describe("Interaction", () => {
    it("clicking a file calls onFileClick", () => {
      const onFileClick = vi.fn();
      render(<Sidebar {...defaultProps} onFileClick={onFileClick} />);
      fireEvent.click(screen.getByText("readme.md"));
      expect(onFileClick).toHaveBeenCalledWith("/docs/readme.md");
    });

    it("clicking folder toggles expansion", () => {
      render(<Sidebar {...defaultProps} />);
      // Folder children should be visible initially (depth 0 starts expanded)
      expect(screen.getByText("todo.md")).toBeInTheDocument();

      // Click folder to collapse
      fireEvent.click(screen.getByText("notes"));
      expect(screen.queryByText("todo.md")).not.toBeInTheDocument();

      // Click folder to expand again
      fireEvent.click(screen.getByText("notes"));
      expect(screen.getByText("todo.md")).toBeInTheDocument();
    });

    it('clicking "Open Folder" button calls onChooseFolder', () => {
      const onChooseFolder = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          folderPath={null}
          tree={[]}
          onChooseFolder={onChooseFolder}
        />,
      );
      fireEvent.click(screen.getByText("Open Folder"));
      expect(onChooseFolder).toHaveBeenCalledOnce();
    });

    it("clicking set-folder button calls onChooseFolder", () => {
      const onChooseFolder = vi.fn();
      render(<Sidebar {...defaultProps} onChooseFolder={onChooseFolder} />);
      fireEvent.click(screen.getByTitle("Set Folder"));
      expect(onChooseFolder).toHaveBeenCalledOnce();
    });
  });

  describe("Global search toggle", () => {
    it("does not render the search button when onToggleSearch is omitted", () => {
      render(<Sidebar {...defaultProps} />);
      expect(
        screen.queryByLabelText("Search in workspace"),
      ).not.toBeInTheDocument();
    });

    it("renders the search button and calls onToggleSearch on click", () => {
      const onToggleSearch = vi.fn();
      render(<Sidebar {...defaultProps} onToggleSearch={onToggleSearch} />);
      fireEvent.click(screen.getByLabelText("Search in workspace"));
      expect(onToggleSearch).toHaveBeenCalledOnce();
    });

    it("renders the search panel in place of the tree when searchActive", () => {
      render(
        <Sidebar
          {...defaultProps}
          onToggleSearch={vi.fn()}
          searchActive
          searchPanel={<div data-testid="search-panel">panel</div>}
        />,
      );
      expect(screen.getByTestId("search-panel")).toBeInTheDocument();
      // Tree files are hidden while search mode is on.
      expect(screen.queryByText("readme.md")).not.toBeInTheDocument();
    });
  });

  describe("Sort menu", () => {
    it("does not render sort button when onSortChange is not provided", () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.queryByTitle("Sort files")).not.toBeInTheDocument();
    });

    it("does not render sort button when folderPath is null", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          folderPath={null}
          tree={[]}
          onSortChange={onSortChange}
        />,
      );
      expect(screen.queryByTitle("Sort files")).not.toBeInTheDocument();
    });

    it("renders sort button when folder is set and onSortChange is provided", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      expect(screen.getByTitle("Sort files")).toBeInTheDocument();
    });

    it("opens menu on click and shows all seven sort options", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTitle("Sort files"));
      expect(screen.getByText("Name (A → Z)")).toBeInTheDocument();
      expect(screen.getByText("Name (Z → A)")).toBeInTheDocument();
      expect(screen.getByText("Modified (newest)")).toBeInTheDocument();
      expect(screen.getByText("Modified (oldest)")).toBeInTheDocument();
      expect(screen.getByText("Size (largest)")).toBeInTheDocument();
      expect(screen.getByText("Size (smallest)")).toBeInTheDocument();
      expect(screen.getByText("Recently opened")).toBeInTheDocument();
    });

    it("clicking 'Recently opened' calls onSortChange with recent-desc", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTitle("Sort files"));
      fireEvent.click(screen.getByText("Recently opened"));
      expect(onSortChange).toHaveBeenCalledWith("recent-desc");
    });

    it("marks current sort key as selected with aria-checked", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          sortKey="modified-desc"
          onSortChange={onSortChange}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      const selected = screen.getByText("Modified (newest)").closest("button");
      expect(selected).toHaveAttribute("aria-checked", "true");
      const other = screen.getByText("Name (A → Z)").closest("button");
      expect(other).toHaveAttribute("aria-checked", "false");
    });

    it("renders a check glyph in the reserved check column for the selected option only", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          sortKey="modified-desc"
          onSortChange={onSortChange}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      // The selected option's check column holds a rendered check SVG.
      const selected = screen.getByText("Modified (newest)").closest("button")!;
      const selectedCheck = selected.querySelector(
        ".sidebar-sort-option-check",
      );
      expect(selectedCheck).not.toBeNull();
      expect(selectedCheck!.querySelector("svg")).not.toBeNull();
      // A non-selected option reserves the column but paints no glyph.
      const other = screen.getByText("Name (A → Z)").closest("button")!;
      const otherCheck = other.querySelector(".sidebar-sort-option-check");
      expect(otherCheck).not.toBeNull();
      expect(otherCheck!.querySelector("svg")).toBeNull();
    });

    it("clicking a sort option calls onSortChange and closes the menu", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTitle("Sort files"));
      fireEvent.click(screen.getByText("Size (largest)"));
      expect(onSortChange).toHaveBeenCalledWith("size-desc");
      expect(screen.queryByText("Modified (newest)")).not.toBeInTheDocument();
    });

    it("Escape closes the menu", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTitle("Sort files"));
      expect(screen.getByText("Name (A → Z)")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByText("Name (A → Z)")).not.toBeInTheDocument();
    });

    it("clicking outside closes the menu", () => {
      const onSortChange = vi.fn();
      render(
        <div>
          <Sidebar {...defaultProps} onSortChange={onSortChange} />
          <div data-testid="outside">outside</div>
        </div>,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      expect(screen.getByText("Name (A → Z)")).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByTestId("outside"));
      expect(screen.queryByText("Name (A → Z)")).not.toBeInTheDocument();
    });
  });

  describe("Show empty folders toggle", () => {
    it("does not render the toggle when onToggleShowEmptyFolders is absent", () => {
      const onSortChange = vi.fn();
      render(<Sidebar {...defaultProps} onSortChange={onSortChange} />);
      fireEvent.click(screen.getByTitle("Sort files"));
      expect(screen.queryByText("Show empty folders")).not.toBeInTheDocument();
    });

    it("renders the toggle in the sort menu when wired", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          onToggleShowEmptyFolders={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      expect(screen.getByText("Show empty folders")).toBeInTheDocument();
    });

    it("reflects the setting via aria-checked (on)", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          showEmptyFolders={true}
          onToggleShowEmptyFolders={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      const toggle = screen.getByText("Show empty folders").closest("button");
      expect(toggle).toHaveAttribute("aria-checked", "true");
    });

    it("renders a checkbox-style box (not a radio check) and reflects on/off in its class", () => {
      const onSortChange = vi.fn();
      const { rerender } = render(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          showEmptyFolders={true}
          onToggleShowEmptyFolders={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      const onToggle = screen
        .getByText("Show empty folders")
        .closest("button")!;
      // Distinct checkbox-style affordance: the toggle box always renders a box
      // SVG (on or off), unlike the single-select sort options.
      expect(onToggle).toHaveClass("sidebar-sort-toggle");
      expect(onToggle).toHaveClass("sidebar-sort-toggle--on");
      const box = onToggle.querySelector(".sidebar-sort-toggle-box");
      expect(box).not.toBeNull();
      expect(box!.querySelector("svg")).not.toBeNull();

      // When off, the box still renders but the "on" modifier is dropped.
      rerender(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          showEmptyFolders={false}
          onToggleShowEmptyFolders={vi.fn()}
        />,
      );
      const offToggle = screen
        .getByText("Show empty folders")
        .closest("button")!;
      expect(offToggle).not.toHaveClass("sidebar-sort-toggle--on");
      expect(
        offToggle.querySelector(".sidebar-sort-toggle-box svg"),
      ).not.toBeNull();
    });

    it("reflects the setting via aria-checked (off)", () => {
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          showEmptyFolders={false}
          onToggleShowEmptyFolders={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      const toggle = screen.getByText("Show empty folders").closest("button");
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });

    it("clicking the toggle calls onToggleShowEmptyFolders with the negated value", () => {
      const onToggleShowEmptyFolders = vi.fn();
      const onSortChange = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onSortChange={onSortChange}
          showEmptyFolders={true}
          onToggleShowEmptyFolders={onToggleShowEmptyFolders}
        />,
      );
      fireEvent.click(screen.getByTitle("Sort files"));
      fireEvent.click(screen.getByText("Show empty folders"));
      expect(onToggleShowEmptyFolders).toHaveBeenCalledWith(false);
    });
  });

  describe("Context menu", () => {
    it("does not open on right-click when no context-menu handlers are provided", () => {
      render(<Sidebar {...defaultProps} />);
      const file = screen.getByText("readme.md").closest("button")!;
      fireEvent.contextMenu(file);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("opens on right-click and shows all expected items when handlers are provided", () => {
      render(
        <Sidebar
          {...defaultProps}
          onShowInExplorer={vi.fn()}
          onRenameFile={vi.fn(async () => "renamed")}
          onDeleteFile={vi.fn(async () => true)}
          onShowToast={vi.fn()}
        />,
      );
      const file = screen.getByText("readme.md").closest("button")!;
      fireEvent.contextMenu(file);
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
      expect(menu.textContent).toMatch(/Show in/);
      expect(screen.getByText("Rename")).toBeInTheDocument();
      expect(screen.getByText("Copy Path")).toBeInTheDocument();
      expect(screen.getByText("Copy Filename")).toBeInTheDocument();
      expect(screen.getByText("Delete")).toBeInTheDocument();
    });

    it("clicking Show in Explorer calls the handler with the file path", () => {
      const onShowInExplorer = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onShowInExplorer={onShowInExplorer}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      const showInItem = screen
        .getByRole("menu")
        .querySelector("button")! as HTMLButtonElement;
      fireEvent.click(showInItem);
      expect(onShowInExplorer).toHaveBeenCalledWith("/docs/readme.md");
    });

    it("Show in Explorer is hidden for folders (only available on files)", () => {
      render(
        <Sidebar
          {...defaultProps}
          onShowInExplorer={vi.fn()}
          onRenameFile={vi.fn(async () => "x")}
          onShowToast={vi.fn()}
        />,
      );
      const folder = screen.getByText("notes").closest("button")!;
      fireEvent.contextMenu(folder);
      const menu = screen.getByRole("menu");
      expect(menu.textContent).not.toMatch(/Show in/);
      expect(screen.getByText("Rename")).toBeInTheDocument();
    });

    it("Delete is hidden for folders (only available on files in v1)", () => {
      render(
        <Sidebar
          {...defaultProps}
          onDeleteFile={vi.fn(async () => true)}
          onShowToast={vi.fn()}
        />,
      );
      const folder = screen.getByText("notes").closest("button")!;
      fireEvent.contextMenu(folder);
      // Folder context menu has only Copy Path / Copy Filename — no Delete
      expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    });

    it("Copy Filename writes the filename to clipboard and shows a toast", async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.assign(navigator, { clipboard: { writeText } });
      const onShowToast = vi.fn();
      render(<Sidebar {...defaultProps} onShowToast={onShowToast} />);
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Copy Filename"));
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith("readme.md");
      expect(onShowToast).toHaveBeenCalledWith("Filename copied to clipboard");
    });

    it("clicking Delete opens the confirm dialog, then Cancel closes it without calling onDeleteFile", async () => {
      const onDeleteFile = vi.fn(async () => true);
      render(
        <Sidebar
          {...defaultProps}
          onDeleteFile={onDeleteFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Delete"));
      const dialog = await screen.findByRole("alertdialog");
      expect(dialog).toBeInTheDocument();
      fireEvent.click(screen.getByText("Cancel"));
      expect(onDeleteFile).not.toHaveBeenCalled();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("clicking Delete then confirming calls onDeleteFile with the file path", async () => {
      const onDeleteFile = vi.fn(async () => true);
      render(
        <Sidebar
          {...defaultProps}
          onDeleteFile={onDeleteFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Delete"));
      const dialog = await screen.findByRole("alertdialog");
      const confirmBtn = dialog.querySelector(
        ".confirm-dialog-btn--danger",
      ) as HTMLButtonElement;
      fireEvent.click(confirmBtn);
      await Promise.resolve();
      // Default: includeAssets is false (checkbox not shown when no assets)
      expect(onDeleteFile).toHaveBeenCalledWith("/docs/readme.md", false);
    });

    it("offers 'Also delete N assets' checkbox when file has assets", async () => {
      const onDeleteFile = vi.fn(async () => true);
      const onGetAssetSummary = vi.fn(async () => ({
        folders: ["readme-md-images"],
        assetCount: 3,
      }));
      render(
        <Sidebar
          {...defaultProps}
          onDeleteFile={onDeleteFile}
          onGetAssetSummary={onGetAssetSummary}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Delete"));
      const dialog = await screen.findByRole("alertdialog");
      // Checkbox label includes the count
      expect(dialog.textContent).toMatch(/Also delete 3 asset files/);
      // Confirm button reads "Delete" while unchecked
      expect(
        dialog.querySelector(".confirm-dialog-btn--danger")?.textContent,
      ).toBe("Delete");
      // Check the box → confirm label updates
      const checkbox = dialog.querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(
        dialog.querySelector(".confirm-dialog-btn--danger")?.textContent,
      ).toBe("Delete file + 3 assets");
      // Confirm
      fireEvent.click(dialog.querySelector(".confirm-dialog-btn--danger")!);
      await Promise.resolve();
      await Promise.resolve();
      expect(onDeleteFile).toHaveBeenCalledWith("/docs/readme.md", true);
    });

    it("does not show the checkbox when file has no assets", async () => {
      const onGetAssetSummary = vi.fn(async () => ({
        folders: [],
        assetCount: 0,
      }));
      render(
        <Sidebar
          {...defaultProps}
          onDeleteFile={vi.fn(async () => true)}
          onGetAssetSummary={onGetAssetSummary}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Delete"));
      const dialog = await screen.findByRole("alertdialog");
      expect(
        dialog.querySelector('input[type="checkbox"]'),
      ).not.toBeInTheDocument();
    });

    it("clicking Rename activates inline rename input, Enter submits the new name", async () => {
      const onRenameFile = vi.fn(async () => "/docs/renamed.md");
      render(
        <Sidebar
          {...defaultProps}
          onRenameFile={onRenameFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Rename"));
      const input = (await screen.findByLabelText(
        "New name",
      )) as HTMLInputElement;
      expect(input.value).toBe("readme.md");
      fireEvent.change(input, { target: { value: "renamed.md" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onRenameFile).toHaveBeenCalledWith(
        "/docs/readme.md",
        "renamed.md",
      );
    });

    it("Escape during rename cancels without calling onRenameFile", async () => {
      const onRenameFile = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onRenameFile={onRenameFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("readme.md").closest("button")!);
      fireEvent.click(screen.getByText("Rename"));
      const input = (await screen.findByLabelText(
        "New name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "shouldnotsave.md" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onRenameFile).not.toHaveBeenCalled();
    });
  });

  describe("New File / New Folder", () => {
    it("folder context menu shows New File and New Folder", () => {
      render(
        <Sidebar
          {...defaultProps}
          onCreateFile={vi.fn(async () => "/docs/notes/untitled.md")}
          onCreateFolder={vi.fn(async () => "/docs/notes/new")}
          onShowToast={vi.fn()}
        />,
      );
      const folder = screen.getByText("notes").closest("button")!;
      fireEvent.contextMenu(folder);
      expect(screen.getByText("New File")).toBeInTheDocument();
      expect(screen.getByText("New Folder")).toBeInTheDocument();
    });

    it("right-clicking the tree background opens a root menu with New File and New Folder", () => {
      const { container } = render(
        <Sidebar
          {...defaultProps}
          onCreateFile={vi.fn(async () => "/docs/untitled.md")}
          onCreateFolder={vi.fn(async () => "/docs/new")}
          onShowToast={vi.fn()}
        />,
      );
      const tree = container.querySelector(".sidebar-tree") as HTMLElement;
      fireEvent.contextMenu(tree);
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
      expect(screen.getByText("New File")).toBeInTheDocument();
      expect(screen.getByText("New Folder")).toBeInTheDocument();
    });

    it("submitting a new file name calls onCreateFile with (parentDir, name)", async () => {
      const onCreateFile = vi.fn(async () => "/docs/notes/draft.md");
      render(
        <Sidebar
          {...defaultProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      fireEvent.click(screen.getByText("New File"));
      const input = (await screen.findByLabelText(
        "New file name",
      )) as HTMLInputElement;
      expect(input.value).toBe("");
      fireEvent.change(input, { target: { value: "draft" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onCreateFile).toHaveBeenCalledWith("/docs/notes", "draft");
    });

    it("submitting a new folder name calls onCreateFolder with (parentDir, name)", async () => {
      const onCreateFolder = vi.fn(async () => "/docs/notes/archive");
      render(
        <Sidebar
          {...defaultProps}
          onCreateFolder={onCreateFolder}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      fireEvent.click(screen.getByText("New Folder"));
      const input = (await screen.findByLabelText(
        "New folder name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "archive" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onCreateFolder).toHaveBeenCalledWith("/docs/notes", "archive");
    });

    it("creating at the root targets the workspace root folderPath", async () => {
      const onCreateFile = vi.fn(async () => "/docs/draft.md");
      const { container } = render(
        <Sidebar
          {...defaultProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      const tree = container.querySelector(".sidebar-tree") as HTMLElement;
      fireEvent.contextMenu(tree);
      fireEvent.click(screen.getByText("New File"));
      const input = (await screen.findByLabelText(
        "New file name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "draft" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onCreateFile).toHaveBeenCalledWith("/docs", "draft");
    });

    it("Escape during create cancels without calling the handler", async () => {
      const onCreateFile = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      fireEvent.click(screen.getByText("New File"));
      const input = await screen.findByLabelText("New file name");
      fireEvent.change(input, { target: { value: "willcancel" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onCreateFile).not.toHaveBeenCalled();
      expect(screen.queryByLabelText("New file name")).not.toBeInTheDocument();
    });

    it("empty name submit cancels without calling the handler", async () => {
      const onCreateFile = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      fireEvent.click(screen.getByText("New File"));
      const input = await screen.findByLabelText("New file name");
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCreateFile).not.toHaveBeenCalled();
    });

    it("invalid-character folder name shows validation and does not call the handler", async () => {
      const onCreateFolder = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onCreateFolder={onCreateFolder}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      fireEvent.click(screen.getByText("New Folder"));
      const input = (await screen.findByLabelText(
        "New folder name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "bad/name" } });
      // Inline validation appears
      expect(screen.getByText("Invalid character")).toBeInTheDocument();
      // The error sits BELOW the input inside the create-field column wrapper,
      // not to its right, so a long name can never push it off-screen.
      const field = input.closest(".tree-item-create-field");
      expect(field).not.toBeNull();
      expect(field!.querySelector(".tree-item-create-error")).not.toBeNull();
      // Enter does not submit while invalid
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCreateFolder).not.toHaveBeenCalled();
    });

    it("does not show New File / New Folder when create handlers are absent", () => {
      render(<Sidebar {...defaultProps} onShowToast={vi.fn()} />);
      fireEvent.contextMenu(screen.getByText("notes").closest("button")!);
      expect(screen.queryByText("New File")).not.toBeInTheDocument();
      expect(screen.queryByText("New Folder")).not.toBeInTheDocument();
    });
  });

  // BUG 1: a selected-but-empty workspace must not be a dead end. The empty
  // state surfaces inline New File / New Folder affordances (and a right-click
  // menu) targeting the workspace root, reusing the same create flow as the
  // tree context menu.
  describe("Empty-but-selected workspace create affordances", () => {
    const emptyProps = { ...defaultProps, tree: [] as FileTreeEntry[] };

    it("renders New File and New Folder buttons in the empty state when create handlers are wired", () => {
      render(
        <Sidebar
          {...emptyProps}
          onCreateFile={vi.fn(async () => "/docs/untitled.md")}
          onCreateFolder={vi.fn(async () => "/docs/new")}
          onShowToast={vi.fn()}
        />,
      );
      // No tree, but the create buttons are reachable from the empty state.
      expect(screen.getByText("New File")).toBeInTheDocument();
      expect(screen.getByText("New Folder")).toBeInTheDocument();
    });

    it("does not render the create buttons when no create handlers are wired", () => {
      render(<Sidebar {...emptyProps} onShowToast={vi.fn()} />);
      expect(screen.queryByText("New File")).not.toBeInTheDocument();
      expect(screen.queryByText("New Folder")).not.toBeInTheDocument();
      // Falls back to the existing Change Folder affordance.
      expect(screen.getByText("Change Folder")).toBeInTheDocument();
    });

    it("does not render the create buttons when no workspace is selected", () => {
      render(
        <Sidebar
          {...emptyProps}
          folderPath={null}
          onCreateFile={vi.fn(async () => "/x")}
          onCreateFolder={vi.fn(async () => "/y")}
          onShowToast={vi.fn()}
        />,
      );
      // The no-workspace state keeps its "Open Folder" affordance only.
      expect(screen.getByText("Open Folder")).toBeInTheDocument();
      expect(screen.queryByText("New File")).not.toBeInTheDocument();
      expect(screen.queryByText("New Folder")).not.toBeInTheDocument();
    });

    it("clicking New File starts the inline create flow at the workspace root and submits with (folderPath, name)", async () => {
      const onCreateFile = vi.fn(async () => "/docs/draft.md");
      render(
        <Sidebar
          {...emptyProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("New File"));
      const input = (await screen.findByLabelText(
        "New file name",
      )) as HTMLInputElement;
      expect(input.value).toBe("");
      fireEvent.change(input, { target: { value: "draft" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      // Targets the workspace ROOT (folderPath), not some nested dir.
      expect(onCreateFile).toHaveBeenCalledWith("/docs", "draft");
    });

    it("clicking New Folder starts the inline create flow at the workspace root and submits with (folderPath, name)", async () => {
      const onCreateFolder = vi.fn(async () => "/docs/archive");
      render(
        <Sidebar
          {...emptyProps}
          onCreateFolder={onCreateFolder}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("New Folder"));
      const input = (await screen.findByLabelText(
        "New folder name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "archive" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onCreateFolder).toHaveBeenCalledWith("/docs", "archive");
    });

    it("right-clicking the empty state opens the root create menu targeting the workspace root", async () => {
      const onCreateFile = vi.fn(async () => "/docs/draft.md");
      const { container } = render(
        <Sidebar
          {...emptyProps}
          onCreateFile={onCreateFile}
          onCreateFolder={vi.fn(async () => "/docs/new")}
          onShowToast={vi.fn()}
        />,
      );
      const empty = container.querySelector(".sidebar-empty") as HTMLElement;
      fireEvent.contextMenu(empty);
      const menu = screen.getByRole("menu");
      expect(menu).toBeInTheDocument();
      // The menu's New File entry starts the same root-targeted create flow.
      // Scope to the menu since the empty state also renders a "New File"
      // button.
      const menuNewFile = within(menu).getByText("New File");
      fireEvent.click(menuNewFile);
      const input = (await screen.findByLabelText(
        "New file name",
      )) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "fromMenu" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await Promise.resolve();
      expect(onCreateFile).toHaveBeenCalledWith("/docs", "fromMenu");
    });

    it("Escape during the empty-state create cancels and restores the buttons", async () => {
      const onCreateFile = vi.fn();
      render(
        <Sidebar
          {...emptyProps}
          onCreateFile={onCreateFile}
          onShowToast={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByText("New File"));
      const input = await screen.findByLabelText("New file name");
      fireEvent.change(input, { target: { value: "willcancel" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(onCreateFile).not.toHaveBeenCalled();
      // Buttons return after cancel.
      expect(screen.getByText("New File")).toBeInTheDocument();
    });
  });

  describe("Drag and drop", () => {
    function makeDataTransfer() {
      const store: Record<string, string> = {};
      return {
        types: [] as string[],
        effectAllowed: "" as string,
        dropEffect: "" as string,
        setData: (k: string, v: string) => {
          store[k] = v;
        },
        getData: (k: string) => store[k] ?? "",
      };
    }

    it("file rows are draggable when onMoveFile is provided", () => {
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={vi.fn(async () => ({ ok: true, newPath: "/x" }))}
        />,
      );
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      expect(fileBtn).toHaveAttribute("draggable", "true");
    });

    it("file rows are not draggable when onMoveFile is missing", () => {
      render(<Sidebar {...defaultProps} />);
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      // draggable attribute is "false" or missing
      expect(fileBtn.getAttribute("draggable")).not.toBe("true");
    });

    it("drag start sets the source path on dataTransfer", () => {
      const onMoveFile = vi.fn(async () => ({ ok: true, newPath: "/x" }));
      render(<Sidebar {...defaultProps} onMoveFile={onMoveFile} />);
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      expect(dt.getData("application/x-pennivo-path")).toBe("/docs/readme.md");
    });

    it("dropping a file on a folder calls onMoveFile with src + destDir", async () => {
      const onMoveFile = vi.fn(async () => ({
        ok: true,
        newPath: "/docs/notes/readme.md",
      }));
      const onShowToast = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={onMoveFile}
          onShowToast={onShowToast}
        />,
      );
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      const folderBtn = screen.getByText("notes").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      fireEvent.dragOver(folderBtn, { dataTransfer: dt });
      fireEvent.drop(folderBtn, { dataTransfer: dt });
      // Allow the async tryMove → onMoveFile to settle
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).toHaveBeenCalledWith(
        "/docs/readme.md",
        "/docs/notes",
        false,
      );
    });

    it("dropping into the same folder is a silent no-op", async () => {
      const onMoveFile = vi.fn(async () => ({ ok: true, newPath: "" }));
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      // readme.md lives at /docs/readme.md; dropping it into the /docs root should no-op
      // We simulate dropping it onto a folder whose path matches the file's parent dir.
      // Since notes lives at /docs/notes (different dir), use that for a positive control:
      const fileBtn = screen.getByText("guide.md").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      // Drop on a synthetic same-dir target by re-firing on the file's own parent — the
      // tree only renders folders, so we hit the root tree via .sidebar-tree drop.
      // Since the file is at root /docs and we drop on root /docs, expect no call.
      const tree = document.querySelector(".sidebar-tree") as HTMLElement;
      // Make currentTarget === target by dispatching directly with that target
      const dropEvent = new Event("drop", {
        bubbles: false,
      }) as unknown as DragEvent;
      Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
      Object.defineProperty(dropEvent, "target", { value: tree });
      Object.defineProperty(dropEvent, "currentTarget", { value: tree });
      tree.dispatchEvent(dropEvent);
      await Promise.resolve();
      // guide.md was at /docs and dropped on /docs root — no move
      expect(onMoveFile).not.toHaveBeenCalled();
    });

    it("collision: shows replace-existing dialog, confirm retries with overwrite=true", async () => {
      const onMoveFile = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "collision" })
        .mockResolvedValueOnce({
          ok: true,
          newPath: "/docs/notes/readme.md",
        });
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      const folderBtn = screen.getByText("notes").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      fireEvent.drop(folderBtn, { dataTransfer: dt });
      // First call: overwrite=false
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).toHaveBeenNthCalledWith(
        1,
        "/docs/readme.md",
        "/docs/notes",
        false,
      );
      // Replace dialog should have appeared
      const dialog = await screen.findByRole("alertdialog", {
        name: "Replace existing file?",
      });
      expect(dialog).toBeInTheDocument();
      const replaceBtn = dialog.querySelector(
        ".confirm-dialog-btn--danger",
      ) as HTMLButtonElement;
      fireEvent.click(replaceBtn);
      await Promise.resolve();
      await Promise.resolve();
      // Second call: overwrite=true
      expect(onMoveFile).toHaveBeenNthCalledWith(
        2,
        "/docs/readme.md",
        "/docs/notes",
        true,
      );
    });

    it("collision: cancel closes the dialog without retrying", async () => {
      const onMoveFile = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "collision" });
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      const folderBtn = screen.getByText("notes").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      fireEvent.drop(folderBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      const dialog = await screen.findByRole("alertdialog", {
        name: "Replace existing file?",
      });
      fireEvent.click(dialog.querySelector(".confirm-dialog-btn--cancel")!);
      expect(onMoveFile).toHaveBeenCalledTimes(1);
    });

    it("error result surfaces a 'Move failed' toast", async () => {
      const onMoveFile = vi.fn(async () => ({
        ok: false,
        reason: "error" as const,
      }));
      const onShowToast = vi.fn();
      render(
        <Sidebar
          {...defaultProps}
          onMoveFile={onMoveFile}
          onShowToast={onShowToast}
        />,
      );
      const fileBtn = screen.getByText("readme.md").closest("button")!;
      const folderBtn = screen.getByText("notes").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(fileBtn, { dataTransfer: dt });
      fireEvent.drop(folderBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onShowToast).toHaveBeenCalledWith("Move failed", true);
    });
  });

  // Phase 11f: folder rows are draggable + droppable, with a client-side guard
  // against dropping a folder onto itself / a descendant. A nested tree lets us
  // exercise the descendant case.
  describe("Folder drag and drop", () => {
    function makeDataTransfer() {
      const store: Record<string, string> = {};
      return {
        types: [] as string[],
        effectAllowed: "" as string,
        dropEffect: "" as string,
        setData: (k: string, v: string) => {
          store[k] = v;
        },
        getData: (k: string) => store[k] ?? "",
      };
    }

    const nestedTree: FileTreeEntry[] = [
      {
        name: "stuff",
        path: "/docs/stuff",
        type: "folder",
        children: [
          { name: "inner.md", path: "/docs/stuff/inner.md", type: "file" },
          {
            name: "deep",
            path: "/docs/stuff/deep",
            type: "folder",
            children: [
              {
                name: "leaf.md",
                path: "/docs/stuff/deep/leaf.md",
                type: "file",
              },
            ],
          },
        ],
      },
      {
        name: "archive",
        path: "/docs/archive",
        type: "folder",
        children: [],
      },
      { name: "readme.md", path: "/docs/readme.md", type: "file" },
    ];

    it("folder rows are draggable when onMoveFile is provided", () => {
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={vi.fn(async () => ({ ok: true, newPath: "/x" }))}
        />,
      );
      const folderBtn = screen.getByText("archive").closest("button")!;
      expect(folderBtn).toHaveAttribute("draggable", "true");
    });

    it("folder rows are not draggable when onMoveFile is missing", () => {
      render(<Sidebar {...defaultProps} tree={nestedTree} />);
      const folderBtn = screen.getByText("archive").closest("button")!;
      expect(folderBtn.getAttribute("draggable")).not.toBe("true");
    });

    it("drag start on a folder sets the folder path on dataTransfer", () => {
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={vi.fn(async () => ({ ok: true, newPath: "/x" }))}
        />,
      );
      const folderBtn = screen.getByText("stuff").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(folderBtn, { dataTransfer: dt });
      expect(dt.getData("application/x-pennivo-path")).toBe("/docs/stuff");
    });

    it("dropping a folder onto a different folder calls onMoveFile with src + destDir", async () => {
      const onMoveFile = vi.fn(async () => ({
        ok: true,
        newPath: "/docs/archive/stuff",
      }));
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      const stuffBtn = screen.getByText("stuff").closest("button")!;
      const archiveBtn = screen.getByText("archive").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(stuffBtn, { dataTransfer: dt });
      fireEvent.dragOver(archiveBtn, { dataTransfer: dt });
      fireEvent.drop(archiveBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).toHaveBeenCalledWith(
        "/docs/stuff",
        "/docs/archive",
        false,
      );
    });

    it("dropping a folder onto its own descendant is prevented (no move)", async () => {
      const onMoveFile = vi.fn(async () => ({ ok: true, newPath: "" }));
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      // Drag "stuff" onto its descendant "deep" (/docs/stuff/deep).
      const stuffBtn = screen.getByText("stuff").closest("button")!;
      const deepBtn = screen.getByText("deep").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(stuffBtn, { dataTransfer: dt });
      fireEvent.drop(deepBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).not.toHaveBeenCalled();
    });

    it("dropping a folder onto itself is prevented (no move)", async () => {
      const onMoveFile = vi.fn(async () => ({ ok: true, newPath: "" }));
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      const stuffBtn = screen.getByText("stuff").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(stuffBtn, { dataTransfer: dt });
      fireEvent.drop(stuffBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).not.toHaveBeenCalled();
    });

    it("dropping a folder onto its own current parent is a silent no-op", async () => {
      const onMoveFile = vi.fn(async () => ({ ok: true, newPath: "" }));
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      // "deep" lives at /docs/stuff/deep; its parent is "stuff" (/docs/stuff).
      const deepBtn = screen.getByText("deep").closest("button")!;
      const stuffBtn = screen.getByText("stuff").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(deepBtn, { dataTransfer: dt });
      fireEvent.drop(stuffBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).not.toHaveBeenCalled();
    });

    it("collision on a folder move shows the 'Replace existing folder?' dialog and confirm retries with overwrite=true", async () => {
      const onMoveFile = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason: "collision" })
        .mockResolvedValueOnce({ ok: true, newPath: "/docs/archive/stuff" });
      render(
        <Sidebar
          {...defaultProps}
          tree={nestedTree}
          onMoveFile={onMoveFile}
          onShowToast={vi.fn()}
        />,
      );
      const stuffBtn = screen.getByText("stuff").closest("button")!;
      const archiveBtn = screen.getByText("archive").closest("button")!;
      const dt = makeDataTransfer();
      fireEvent.dragStart(stuffBtn, { dataTransfer: dt });
      fireEvent.drop(archiveBtn, { dataTransfer: dt });
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).toHaveBeenNthCalledWith(
        1,
        "/docs/stuff",
        "/docs/archive",
        false,
      );
      const dialog = await screen.findByRole("alertdialog", {
        name: "Replace existing folder?",
      });
      expect(dialog).toBeInTheDocument();
      const replaceBtn = dialog.querySelector(
        ".confirm-dialog-btn--danger",
      ) as HTMLButtonElement;
      fireEvent.click(replaceBtn);
      await Promise.resolve();
      await Promise.resolve();
      expect(onMoveFile).toHaveBeenNthCalledWith(
        2,
        "/docs/stuff",
        "/docs/archive",
        true,
      );
    });
  });

  describe("Trash entry", () => {
    it("does not render when trashCount is 0", () => {
      const { container } = render(
        <Sidebar {...defaultProps} trashCount={0} onShowTrash={vi.fn()} />,
      );
      expect(container.querySelector(".sidebar-trash-entry")).toBeNull();
    });

    it("renders 'Trash · N' when trashCount > 0 and onShowTrash is wired", () => {
      const { container } = render(
        <Sidebar {...defaultProps} trashCount={3} onShowTrash={vi.fn()} />,
      );
      const entry = container.querySelector(".sidebar-trash-entry");
      expect(entry).toBeInTheDocument();
      expect(entry?.textContent).toContain("Trash");
      expect(entry?.textContent).toContain("3");
    });

    it("clicking the Trash entry fires onShowTrash", () => {
      const onShowTrash = vi.fn();
      const { container } = render(
        <Sidebar {...defaultProps} trashCount={1} onShowTrash={onShowTrash} />,
      );
      const entry = container.querySelector(
        ".sidebar-trash-entry",
      ) as HTMLButtonElement;
      expect(entry).toBeInTheDocument();
      fireEvent.click(entry);
      expect(onShowTrash).toHaveBeenCalledOnce();
    });

    it("does not render when onShowTrash is missing (defensive)", () => {
      const { container } = render(
        <Sidebar {...defaultProps} trashCount={5} />,
      );
      expect(container.querySelector(".sidebar-trash-entry")).toBeNull();
    });
  });
});
