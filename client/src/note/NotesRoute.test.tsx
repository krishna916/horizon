import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotesBrowse } from '@/note/NotesBrowseContext';
import { NotesRoute } from './NotesRoute';

const session = vi.hoisted(() => ({
  value: {
    phase: 'verified' as string,
    verifiedUserId: 1 as number | null,
    ownerRevision: 0,
  },
}));

vi.mock('@/user/session/AuthSessionProvider', () => ({
  useAuthSession: () => session.value,
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => () => ({}),
  Outlet: () => <BrowseProbe />,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: '/notes' } }),
  useRouter: () => ({ state: { location: { state: {} } }, history: { back: vi.fn() } }),
  useNavigate: () => vi.fn(),
}));

function BrowseProbe() {
  const { state, setCollection } = useNotesBrowse();
  return (
    <>
      <output data-testid="browse-state">{`${state.collection}:${state.view}`}</output>
      <button type="button" onClick={() => setCollection('archived')}>
        Archive filter
      </button>
    </>
  );
}

describe('NotesRoute session ownership', () => {
  afterEach(() => {
    session.value = { phase: 'verified', verifiedUserId: 1, ownerRevision: 0 };
  });

  it('gates an initially unverified Notes route until an owner is available', () => {
    session.value = { phase: 'verifying', verifiedUserId: null, ownerRevision: 0 };
    render(<NotesRoute />);
    expect(screen.getByText('Verifying your session…')).toBeInTheDocument();
    expect(screen.queryByTestId('browse-state')).toBeNull();
  });

  it('retains the same owner browse provider during transient verification', () => {
    const view = render(<NotesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive filter' }));
    expect(screen.getByTestId('browse-state')).toHaveTextContent('archived:cards');

    session.value = { phase: 'verifying', verifiedUserId: null, ownerRevision: 0 };
    view.rerender(<NotesRoute />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('archived:cards');

    session.value = { phase: 'retryable-error', verifiedUserId: null, ownerRevision: 0 };
    view.rerender(<NotesRoute />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('archived:cards');
  });

  it('resets the browse provider when verification returns a different owner', () => {
    const view = render(<NotesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive filter' }));

    session.value = { phase: 'verified', verifiedUserId: 2, ownerRevision: 1 };
    view.rerender(<NotesRoute />);
    expect(screen.getByTestId('browse-state')).toHaveTextContent('active:cards');
  });

  it('removes the browse provider on logout', () => {
    const view = render(<NotesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive filter' }));
    session.value = { phase: 'unauthenticated', verifiedUserId: null, ownerRevision: 1 };
    view.rerender(<NotesRoute />);
    expect(screen.queryByTestId('browse-state')).toBeNull();
  });
});
