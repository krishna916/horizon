import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from './types';
import { NoteCard } from './NoteCard';

const lifecycle = vi.hoisted(() => ({
  ownerId: 12,
  run: vi.fn(async () => null),
  stateFor: vi.fn(() => ({ pending: false, error: null, retry: vi.fn() })),
}));

vi.mock('./NoteLifecycleProvider', () => ({
  useNoteLifecycle: () => lifecycle,
}));

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
  tags: [],
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
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'More actions for Untitled note' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/tag|file/i)).toBeNull();
  });

  it('shows the first two Tags in stable order with an overflow count inside the linked card', () => {
    render(
      <NoteCard
        note={summary({
          tags: [
            { id: 4, name: 'Travel' },
            { id: 2, name: 'books' },
            { id: 3, name: 'Work' },
            { id: 1, name: 'Art' },
          ],
        })}
      />
    );

    const link = screen.getByRole('link', { name: /Trip notes/ });
    expect(link).toHaveAttribute('href', '/notes/7');
    expect(link).toHaveTextContent('Art');
    expect(link).toHaveTextContent('books');
    expect(link).toHaveTextContent('+2');
    expect(link).not.toHaveTextContent('Travel');
    expect(link).not.toHaveTextContent('Work');
    expect(link.querySelector('time')).toHaveTextContent(/Updated/);
    expect(link.className).toContain('max-h-[440px]');
  });

  it('keeps lifecycle actions outside the note link and archives without opening the note', async () => {
    lifecycle.run.mockClear();
    lifecycle.run.mockResolvedValueOnce({ kind: 'note' } as never);
    render(
      <ul>
        <li data-note-row>
          <NoteCard note={summary()} />
        </li>
        <li data-note-row>
          <NoteCard note={summary({ id: 8, title: 'Next note' })} />
        </li>
      </ul>
    );
    const link = screen.getByRole('link', { name: /Trip notes/ });
    const menu = screen.getByRole('button', { name: 'More actions for Trip notes' });
    expect(link).not.toContainElement(menu);

    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    await waitFor(() =>
      expect(lifecycle.run).toHaveBeenCalledWith(
        12,
        { id: 7, version: 1, archivedAt: null },
        'archive'
      )
    );
    await waitFor(() => expect(screen.getByRole('link', { name: /Next note/ })).toHaveFocus());
  });

  it('closes its menu with Escape and returns focus to the trigger', async () => {
    lifecycle.run.mockClear();
    render(<NoteCard note={summary()} />);
    const trigger = screen.getByRole('button', { name: 'More actions for Trip notes' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(lifecycle.run).not.toHaveBeenCalled();
  });

  it('does not call the API when Trash confirmation is cancelled', async () => {
    lifecycle.run.mockClear();
    render(<NoteCard note={summary()} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for Trip notes' }), {
      key: 'Enter',
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(lifecycle.run).not.toHaveBeenCalled();
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
