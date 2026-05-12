import { render, screen, fireEvent } from "@testing-library/react";
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

    it('shows "No markdown files found" when folder is set but tree is empty', () => {
      render(<Sidebar {...defaultProps} tree={[]} />);
      expect(screen.getByText("No markdown files found")).toBeInTheDocument();
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
