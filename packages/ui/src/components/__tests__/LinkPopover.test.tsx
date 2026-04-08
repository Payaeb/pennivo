import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { LinkPopover } from '../LinkPopover/LinkPopover';

const defaultAnchor = { top: 100, left: 200 };

describe('LinkPopover', () => {
  describe('Rendering', () => {
    it('returns null when anchorRect is null', () => {
      const { container } = render(
        <LinkPopover hasSelection={false} anchorRect={null} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it('shows URL input when visible', () => {
      render(
        <LinkPopover hasSelection={false} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByPlaceholderText('https://')).toBeInTheDocument();
    });

    it('shows text input when no selection', () => {
      render(
        <LinkPopover hasSelection={false} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByPlaceholderText('Link text')).toBeInTheDocument();
    });

    it('hides text input when there is a selection', () => {
      render(
        <LinkPopover hasSelection={true} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.queryByPlaceholderText('Link text')).not.toBeInTheDocument();
    });

    it('shows existing URL when editing', () => {
      render(
        <LinkPopover
          hasSelection={true}
          initialUrl="https://example.com"
          anchorRect={defaultAnchor}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      const input = screen.getByPlaceholderText('https://') as HTMLInputElement;
      expect(input.value).toBe('https://example.com');
    });

    it('shows Insert and Cancel buttons', () => {
      render(
        <LinkPopover hasSelection={false} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={vi.fn()} />,
      );
      expect(screen.getByText('Insert')).toBeInTheDocument();
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  describe('Interaction', () => {
    it('typing URL and pressing Enter calls onConfirm', () => {
      const onConfirm = vi.fn();
      render(
        <LinkPopover hasSelection={true} anchorRect={defaultAnchor} onConfirm={onConfirm} onCancel={vi.fn()} />,
      );
      const urlInput = screen.getByPlaceholderText('https://');
      fireEvent.change(urlInput, { target: { value: 'https://test.com' } });
      fireEvent.keyDown(urlInput, { key: 'Enter' });
      expect(onConfirm).toHaveBeenCalledWith('https://test.com', '');
    });

    it('clicking Cancel calls onCancel', () => {
      const onCancel = vi.fn();
      render(
        <LinkPopover hasSelection={false} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={onCancel} />,
      );
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('pressing Escape calls onCancel', () => {
      const onCancel = vi.fn();
      render(
        <LinkPopover hasSelection={false} anchorRect={defaultAnchor} onConfirm={vi.fn()} onCancel={onCancel} />,
      );
      const urlInput = screen.getByPlaceholderText('https://');
      fireEvent.keyDown(urlInput, { key: 'Escape' });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it('does not call onConfirm when URL is empty', () => {
      const onConfirm = vi.fn();
      render(
        <LinkPopover hasSelection={true} anchorRect={defaultAnchor} onConfirm={onConfirm} onCancel={vi.fn()} />,
      );
      const urlInput = screen.getByPlaceholderText('https://');
      fireEvent.keyDown(urlInput, { key: 'Enter' });
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('clicking Insert calls onConfirm', () => {
      const onConfirm = vi.fn();
      render(
        <LinkPopover hasSelection={true} anchorRect={defaultAnchor} onConfirm={onConfirm} onCancel={vi.fn()} />,
      );
      const urlInput = screen.getByPlaceholderText('https://');
      fireEvent.change(urlInput, { target: { value: 'https://insert.com' } });
      fireEvent.click(screen.getByText('Insert'));
      expect(onConfirm).toHaveBeenCalledWith('https://insert.com', '');
    });
  });
});
