import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../Sidebar/Sidebar';

const sampleTree: FileTreeEntry[] = [
  { name: 'notes', path: '/docs/notes', type: 'folder', children: [
    { name: 'todo.md', path: '/docs/notes/todo.md', type: 'file' },
    { name: 'ideas.md', path: '/docs/notes/ideas.md', type: 'file' },
  ]},
  { name: 'readme.md', path: '/docs/readme.md', type: 'file' },
  { name: 'guide.md', path: '/docs/guide.md', type: 'file' },
];

const defaultProps = {
  visible: true,
  folderPath: '/docs',
  tree: sampleTree,
  currentFilePath: null as string | null,
  onFileClick: vi.fn(),
  onChooseFolder: vi.fn(),
};

describe('Sidebar', () => {
  describe('Rendering', () => {
    it('returns null when visible=false', () => {
      const { container } = render(<Sidebar {...defaultProps} visible={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders folder name in header', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('docs')).toBeInTheDocument();
    });

    it('renders files in tree', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('readme.md')).toBeInTheDocument();
      expect(screen.getByText('guide.md')).toBeInTheDocument();
    });

    it('renders folders in tree', () => {
      render(<Sidebar {...defaultProps} />);
      expect(screen.getByText('notes')).toBeInTheDocument();
    });

    it('shows empty state when folderPath is null', () => {
      render(<Sidebar {...defaultProps} folderPath={null} tree={[]} />);
      expect(screen.getByText('Open a folder to browse files')).toBeInTheDocument();
    });

    it('shows "No markdown files found" when folder is set but tree is empty', () => {
      render(<Sidebar {...defaultProps} tree={[]} />);
      expect(screen.getByText('No markdown files found')).toBeInTheDocument();
    });

    it('highlights current file', () => {
      const { container } = render(
        <Sidebar {...defaultProps} currentFilePath="/docs/readme.md" />,
      );
      const activeItem = container.querySelector('.tree-item--active');
      expect(activeItem).toBeInTheDocument();
      expect(activeItem?.textContent).toContain('readme.md');
    });
  });

  describe('Interaction', () => {
    it('clicking a file calls onFileClick', () => {
      const onFileClick = vi.fn();
      render(<Sidebar {...defaultProps} onFileClick={onFileClick} />);
      fireEvent.click(screen.getByText('readme.md'));
      expect(onFileClick).toHaveBeenCalledWith('/docs/readme.md');
    });

    it('clicking folder toggles expansion', () => {
      render(<Sidebar {...defaultProps} />);
      // Folder children should be visible initially (depth 0 starts expanded)
      expect(screen.getByText('todo.md')).toBeInTheDocument();

      // Click folder to collapse
      fireEvent.click(screen.getByText('notes'));
      expect(screen.queryByText('todo.md')).not.toBeInTheDocument();

      // Click folder to expand again
      fireEvent.click(screen.getByText('notes'));
      expect(screen.getByText('todo.md')).toBeInTheDocument();
    });

    it('clicking "Open Folder" button calls onChooseFolder', () => {
      const onChooseFolder = vi.fn();
      render(<Sidebar {...defaultProps} folderPath={null} tree={[]} onChooseFolder={onChooseFolder} />);
      fireEvent.click(screen.getByText('Open Folder'));
      expect(onChooseFolder).toHaveBeenCalledOnce();
    });

    it('clicking set-folder button calls onChooseFolder', () => {
      const onChooseFolder = vi.fn();
      render(<Sidebar {...defaultProps} onChooseFolder={onChooseFolder} />);
      fireEvent.click(screen.getByTitle('Set Folder'));
      expect(onChooseFolder).toHaveBeenCalledOnce();
    });
  });
});
