import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { OutlinePanel } from '../OutlinePanel/OutlinePanel';

const MARKDOWN_WITH_HEADINGS = `# Introduction

Some text here.

## Getting Started

More text.

### Installation

Install steps.

## Usage

Usage details.
`;

const EMPTY_MARKDOWN = 'Just a paragraph with no headings.';

describe('OutlinePanel', () => {
  it('returns null when not visible', () => {
    const { container } = render(
      <OutlinePanel visible={false} markdown={MARKDOWN_WITH_HEADINGS} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders heading list from markdown', () => {
    render(
      <OutlinePanel visible={true} markdown={MARKDOWN_WITH_HEADINGS} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
    expect(screen.getByText('Installation')).toBeInTheDocument();
    expect(screen.getByText('Usage')).toBeInTheDocument();
  });

  it('shows heading level indicators', () => {
    render(
      <OutlinePanel visible={true} markdown={MARKDOWN_WITH_HEADINGS} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(screen.getByText('H1')).toBeInTheDocument();
    expect(screen.getAllByText('H2')).toHaveLength(2);
    expect(screen.getByText('H3')).toBeInTheDocument();
  });

  it('shows empty message when no headings', () => {
    render(
      <OutlinePanel visible={true} markdown={EMPTY_MARKDOWN} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(screen.getByText('No headings found')).toBeInTheDocument();
  });

  it('calls onHeadingClick when a heading is clicked', () => {
    const onHeadingClick = vi.fn();
    render(
      <OutlinePanel visible={true} markdown={MARKDOWN_WITH_HEADINGS} sourceMode={false} onHeadingClick={onHeadingClick} />,
    );
    fireEvent.click(screen.getByText('Getting Started'));
    expect(onHeadingClick).toHaveBeenCalledOnce();
    expect(onHeadingClick).toHaveBeenCalledWith(
      expect.objectContaining({ level: 2, text: 'Getting Started' }),
    );
  });

  it('ignores headings inside code blocks', () => {
    const md = '```\n# Not a heading\n```\n\n# Real Heading';
    render(
      <OutlinePanel visible={true} markdown={md} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(screen.getByText('Real Heading')).toBeInTheDocument();
    expect(screen.queryByText('Not a heading')).not.toBeInTheDocument();
  });

  it('shows the outline title', () => {
    render(
      <OutlinePanel visible={true} markdown={MARKDOWN_WITH_HEADINGS} sourceMode={false} onHeadingClick={vi.fn()} />,
    );
    expect(screen.getByText('Outline')).toBeInTheDocument();
  });
});
