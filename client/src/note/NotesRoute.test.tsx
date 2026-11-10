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
const route = vi.hoisted(() => ({
  pathname: '/notes',
  locationState: {} as Record<string, unknown>,
  navigate: vi.fn(),
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
  }) => select({ location: { pathname: route.pathname } }),
  useRouter: () => ({
    state: { location: { state: route.locationState } },
    history: { back: vi.fn() },
  }),
  useNavigate: () => route.navigate,
}));

vi.mock('./NoteEditorPage', () => ({
  NoteEditorPage: ({ onCreated }: { onCreated: (note: { id: number }) => void }) => (
    <button type="button" onClick={() => onCreated({ id: 501 } as never)}>
      Create done
    </button>
  ),
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
    route.pathname = '/notes';
    route.locationState = {};
    route.navigate.mockReset();
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

  it('starts the editor at the top and preserves scroll during new-to-created-ID replacement', () => {
    const main = document.createElement('main');
    document.body.append(main);
    main.scrollTop = 700;
    const view = render(<NotesRoute />);
    route.pathname = '/notes/new';
    view.rerender(<NotesRoute />);
    expect(main.scrollTop).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: 'Create done' }));
    main.scrollTop = 143;
    route.pathname = '/notes/501';
    view.rerender(<NotesRoute />);
    expect(main.scrollTop).toBe(143);
    main.remove();
  });

  it('carries workspace origin through create only when the new route was trusted', () => {
    const view = render(<NotesRoute />);
    route.pathname = '/notes/new';
    route.locationState = {};
    view.rerender(<NotesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Create done' }));
    expect(route.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: { horizonNoteNavigation: undefined } })
    );

    route.pathname = '/notes/new';
    route.locationState = { horizonNoteNavigation: { kind: 'from-workspace' } };
    view.rerender(<NotesRoute />);
    fireEvent.click(screen.getByRole('button', { name: 'Create done' }));
    expect(route.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: { horizonNoteNavigation: { kind: 'from-workspace', noteId: 501 } },
      })
    );
  });
});
