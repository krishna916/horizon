import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteSummary } from './types';
import { NoteListRow } from './NoteListRow';

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
    expect(container.querySelector('img, button')).toBeNull();
    expect(screen.queryByText(/file|tag/i)).toBeNull();
  });
});
