import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from './types';
import { NoteCard } from './NoteCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={to.replace('$id', params?.id ?? '')} className={className}>
      {children}
    </a>
  ),
}));

const summary = (overrides: Partial<NoteSummary> = {}): NoteSummary => ({
  id: 7,
  title: 'Trip notes',
  preview: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Train leaves at nine.' }] }],
  },
  version: 1,
  inbox: false,
  archivedAt: null,
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
  ...overrides,
});

describe('NoteCard', () => {
  it('opens the canonical full-page route as a keyboard-focusable link', () => {
    render(<NoteCard note={summary()} />);
    const link = screen.getByRole('link', { name: /Trip notes/ });
    expect(link).toHaveAttribute('href', '/notes/7');
    link.focus();
    expect(link).toHaveFocus();
    expect(link).toHaveTextContent('Train leaves at nine.');
    expect(link).not.toContainElement(screen.queryByRole('button'));
  });

  it('uses a display-only title fallback and renders no invented metadata', () => {
    const { container } = render(<NoteCard note={summary({ title: null, preview: null })} />);

    expect(screen.getByRole('heading', { name: 'Untitled note' })).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notes/7');
    expect(container.querySelector('img, button')).toBeNull();
    expect(screen.queryByText(/tag|file/i)).toBeNull();
  });

  it('keeps safe rich-text links noninteractive inside the card navigation link', () => {
    render(
      <NoteCard
        note={summary({
          preview: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Official site',
                    marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                  },
                ],
              },
            ],
          },
        })}
      />
    );

    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Official site/ })).toHaveAttribute('href', '/notes/7');
  });

  it('keeps a leading image and attachment-only card fixture in its reserved reading order', () => {
    const imageFirst = render(
      <NoteCard
        note={summary({
          preview: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Before media' }] }],
          },
        })}
      />
    );
    expect(imageFirst.getByRole('link')).toHaveTextContent('Before media');

    const attachmentOnlyFixture = render(
      <div>
        <NoteCard note={summary({ title: null, preview: null })} />
        <span data-fixture="attachment">File: itinerary.pdf</span>
      </div>
    );
    expect(
      attachmentOnlyFixture.getByRole('heading', { name: 'Untitled note' })
    ).toBeInTheDocument();
    expect(attachmentOnlyFixture.getByText('File: itinerary.pdf')).toBeInTheDocument();
    expect(attachmentOnlyFixture.queryByText('No content yet')).toBeNull();
  });
});
