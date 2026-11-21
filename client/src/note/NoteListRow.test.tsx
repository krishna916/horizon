import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from './types';
import { NoteListRow } from './NoteListRow';

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

describe('NoteListRow', () => {
  it('uses the same canonical route and shows a single-line text excerpt', () => {
    render(<NoteListRow note={summary()} />);

    const link = screen.getByRole('link', { name: /Trip notes/ });
    expect(link).toHaveAttribute('href', '/notes/7');
    expect(link).toHaveTextContent('Train leaves at nine.');
    expect(screen.getByText(/Updated/).tagName).toBe('TIME');
    expect(screen.getByText(/Updated/)).toHaveAttribute('dateTime', '2026-11-09T10:00:00Z');
  });

  it('shows Untitled note for blank titles and remains readable without a preview', () => {
    const { container } = render(<NoteListRow note={summary({ title: ' ', preview: null })} />);

    expect(screen.getByRole('link', { name: /Untitled note/ })).toHaveAttribute('href', '/notes/7');
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'More actions for Untitled note' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/file|tag/i)).toBeNull();
  });

  it('offers Restore for archived Notes in a sibling menu without navigating', async () => {
    render(<NoteListRow note={summary({ archivedAt: '2026-11-08T10:00:00Z' })} />);
    const link = screen.getByRole('link', { name: /Trip notes/ });
    const menu = screen.getByRole('button', { name: 'More actions for Trip notes' });
    expect(link).not.toContainElement(menu);

    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));

    await waitFor(() =>
      expect(lifecycle.run).toHaveBeenCalledWith(
        12,
        { id: 7, version: 1, archivedAt: '2026-11-08T10:00:00Z' },
        'restore'
      )
    );
    expect(lifecycle.run).toHaveBeenCalledTimes(1);
  });

  it('restores List focus after Cancel and Escape without calling the API', async () => {
    lifecycle.run.mockClear();
    render(<NoteListRow note={summary()} />);
    const trigger = screen.getByRole('button', { name: 'More actions for Trip notes' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(lifecycle.run).not.toHaveBeenCalled();
  });

  it('shows Tags in a responsive metadata column without changing the note link', () => {
    render(
      <NoteListRow
        note={summary({
          tags: [
            { id: 2, name: 'Work' },
            { id: 1, name: 'Personal' },
          ],
        })}
      />
    );

    const link = screen.getByRole('link', { name: /Trip notes/ });
    expect(link).toHaveAttribute('href', '/notes/7');
    expect(link).toHaveTextContent('Personal');
    expect(link).toHaveTextContent('Work');
    const tags = screen.getByLabelText('Note Tags');
    expect(tags.className).toContain('hidden');
    expect(tags.className).toContain('sm:flex');
    expect(tags.querySelector('img')).toBeNull();
    expect(link).not.toHaveTextContent(/filter/i);
  });
});
