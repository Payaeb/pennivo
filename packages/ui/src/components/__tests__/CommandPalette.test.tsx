import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CommandPalette, type CommandItem } from '../CommandPalette/CommandPalette';

const commands: CommandItem[] = [
  { id: 'new-file', label: 'New File', shortcut: 'Ctrl+N', category: 'File' },
  { id: 'open-file', label: 'Open File', shortcut: 'Ctrl+O', category: 'File' },
  { id: 'save', label: 'Save', shortcut: 'Ctrl+S', category: 'File' },
  { id: 'toggle-bold', label: 'Bold', shortcut: 'Ctrl+B', category: 'Format' },
  { id: 'toggle-italic', label: 'Italic', shortcut: 'Ctrl+I', category: 'Format' },
  { id: 'toggle-theme', label: 'Toggle Theme', category: 'View' },
];

describe('CommandPalette', () => {
  describe('Rendering', () => {
    it('returns null when not visible', () => {
      const { container } = render(
        <CommandPalette visible={false} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('shows input and command list when visible', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByPlaceholderText('Type a command…')).toBeInTheDocument();
      expect(screen.getByText('New File')).toBeInTheDocument();
      expect(screen.getByText('Save')).toBeInTheDocument();
    });

    it('displays all commands when query is empty', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      for (const cmd of commands) {
        expect(screen.getByText(cmd.label)).toBeInTheDocument();
      }
    });

    it('shows keyboard shortcuts', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getByText('Ctrl+N')).toBeInTheDocument();
      expect(screen.getByText('Ctrl+S')).toBeInTheDocument();
    });

    it('shows category labels', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      expect(screen.getAllByText('File').length).toBeGreaterThan(0);
    });
  });

  describe('Interaction', () => {
    it('typing filters commands', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      const input = screen.getByPlaceholderText('Type a command…');
      fireEvent.change(input, { target: { value: 'bold' } });
      expect(screen.getByText('Bold')).toBeInTheDocument();
      expect(screen.queryByText('Save')).not.toBeInTheDocument();
    });

    it('pressing Enter selects the highlighted command', () => {
      const onSelect = vi.fn();
      render(
        <CommandPalette visible={true} commands={commands} onSelect={onSelect} onClose={vi.fn()} />,
      );
      const input = screen.getByPlaceholderText('Type a command…');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('new-file');
    });

    it('pressing Escape calls onClose', () => {
      const onClose = vi.fn();
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={onClose} />,
      );
      const input = screen.getByPlaceholderText('Type a command…');
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('arrow keys navigate the command list', () => {
      const onSelect = vi.fn();
      render(
        <CommandPalette visible={true} commands={commands} onSelect={onSelect} onClose={vi.fn()} />,
      );
      const input = screen.getByPlaceholderText('Type a command…');

      // Arrow down to second item
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('open-file');
    });

    it('clicking a command calls onSelect', () => {
      const onSelect = vi.fn();
      render(
        <CommandPalette visible={true} commands={commands} onSelect={onSelect} onClose={vi.fn()} />,
      );
      fireEvent.click(screen.getByText('Toggle Theme'));
      expect(onSelect).toHaveBeenCalledWith('toggle-theme');
    });

    it('shows "No matching commands" when filter yields nothing', () => {
      render(
        <CommandPalette visible={true} commands={commands} onSelect={vi.fn()} onClose={vi.fn()} />,
      );
      const input = screen.getByPlaceholderText('Type a command…');
      fireEvent.change(input, { target: { value: 'xyznotfound' } });
      expect(screen.getByText('No matching commands')).toBeInTheDocument();
    });
  });
});
