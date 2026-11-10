import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteApi } from './api';
import type { NoteListResponse, NoteSummary } from './types';
import { NotesBrowseProvider } from './NotesBrowseContext';
import { NotesWorkspacePage } from './NotesWorkspacePage';

const session = vi.hoisted(() => ({
  value: {
    phase: 'verified',
    verifiedUserId: 1,
    verifySession: vi.fn(),
  },
}));
const retainedRecovery = vi.hoisted(() => ({
  entry: null as null | {
    ownerId: number;
    editorRoute: string;
    draft: { title: string; content: null };
    persistedVersion?: { id: number; version: number };
  },
}));

vi.mock('@/user/session/AuthSessionProvider', () => ({
  useAuthSession: () => session.value,
}));

vi.mock('./NoteDraftRecoveryProvider', () => ({
  useNoteDraftRecovery: () => ({
    peekForVerifiedOwner: (ownerId: number) =>
      retainedRecovery.entry?.ownerId === ownerId ? retainedRecovery.entry : null,
    discard: vi.fn(),
  }),
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
    <a className={className} href={to.replace('$id', params?.id ?? '')}>
      {children}
    </a>
  ),
}));

function summary(id: number, title: string | null = `Note ${id}`): NoteSummary {
  return {
    id,
    title,
    preview: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: `Preview ${id}` }] }],
    },
    version: 1,
    inbox: false,
    archivedAt: null,
    createdAt: '2026-11-09T10:00:00Z',
    updatedAt: '2026-11-09T10:00:00Z',
  };
}

function page(
  items: NoteSummary[],
  pageNumber: number,
  hasNext: boolean
): AxiosResponse<NoteListResponse> {
  return {
    data: {
      items,
      page: pageNumber,
      size: 20,
      hasNext,
      counts: { active: 21, archived: 3 },
    },
  } as AxiosResponse<NoteListResponse>;
}

function renderWorkspace() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NotesBrowseProvider userId={1}>
          <main className="overflow-y-auto">{children}</main>
        </NotesBrowseProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<NotesWorkspacePage />, { wrapper: Wrapper });
  return { ...view, queryClient };
}

describe('NotesWorkspacePage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    session.value = { phase: 'verified', verifiedUserId: 1, verifySession: vi.fn() };
    retainedRecovery.entry = null;
  });

  it('starts in Cards, switches views without refetching, and uses server filters', async () => {
    const listSpy = vi.spyOn(noteApi, 'list').mockResolvedValue(page([summary(1)], 0, false));
    const detailSpy = vi.spyOn(noteApi, 'get');
    renderWorkspace();

    const cardsButton = screen.getByRole('button', { name: 'Cards' });
    expect(cardsButton).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Note 1/ })).toHaveAttribute('href', '/notes/1')
    );
    expect(screen.getByRole('button', { name: /Active/ })).toHaveTextContent('21');
    expect(screen.getByRole('button', { name: /Archived/ })).toHaveTextContent('3');
    expect(listSpy).toHaveBeenCalledWith('active', 'updated_desc', 0, 20, expect.any(AbortSignal));

    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
    expect(listSpy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(listSpy).toHaveBeenCalledTimes(1);

    listSpy.mockResolvedValue(page([summary(9)], 0, false));
    const main = document.querySelector('main')!;
    main.scrollTop = 250;
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    expect(main.scrollTop).toBe(0);
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        'archived',
        'updated_desc',
        0,
        20,
        expect.any(AbortSignal)
      )
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort notes' }), {
      target: { value: 'title_asc' },
    });
    await waitFor(() =>
      expect(listSpy).toHaveBeenLastCalledWith(
        'archived',
        'title_asc',
        0,
        20,
        expect.any(AbortSignal)
      )
    );
    expect(detailSpy).not.toHaveBeenCalled();
  });

  it('loads 20 notes at a time and appends the next page in order', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => summary(index + 1));
    const secondPage = Array.from({ length: 20 }, (_, index) => summary(index + 21));
    const listSpy = vi
      .spyOn(noteApi, 'list')
      .mockResolvedValueOnce(page(firstPage, 0, true))
      .mockResolvedValueOnce(page(secondPage, 1, false));
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('link', { name: /Note 20/ })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /Note 21/ })).toBeNull();
    const loadMore = screen.getByRole('button', { name: 'Load more notes' });
    expect(loadMore).toBeEnabled();
    fireEvent.click(loadMore);

    await waitFor(() => expect(screen.getByRole('link', { name: /Note 40/ })).toBeInTheDocument());
    expect(listSpy).toHaveBeenNthCalledWith(
      2,
      'active',
      'updated_desc',
      1,
      20,
      expect.any(AbortSignal)
    );
    expect(screen.queryByRole('button', { name: 'Load more notes' })).toBeNull();
    const grid = screen.getByRole('list', { name: 'Notes cards' });
    const titles = within(grid)
      .getAllByRole('heading', { level: 2 })
      .map((heading) => heading.textContent);
    expect(titles[0]).toBe('Note 1');
    expect(titles[19]).toBe('Note 20');
    expect(titles[20]).toBe('Note 21');
  });

  it('does not restore the old scroll position again when another page is appended', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => summary(index + 1));
    let resolveNext!: (value: AxiosResponse<NoteListResponse>) => void;
    vi.spyOn(noteApi, 'list')
      .mockResolvedValueOnce(page(firstPage, 0, true))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveNext = resolve)) as never);
    renderWorkspace();

    await waitFor(() => expect(screen.getByRole('link', { name: /Note 20/ })).toBeInTheDocument());
    const main = document.querySelector('main')!;
    main.scrollTop = 410;
    fireEvent.click(screen.getByRole('button', { name: 'Load more notes' }));
    await waitFor(() => expect(resolveNext).toBeTypeOf('function'));
    await act(async () =>
      resolveNext(
        page(
          Array.from({ length: 20 }, (_, index) => summary(index + 21)),
          1,
          false
        )
      )
    );
    await waitFor(() => expect(screen.getByRole('link', { name: /Note 40/ })).toBeInTheDocument());
    expect(main.scrollTop).toBe(410);
  });

  it('keeps loaded notes after a next-page error and lets the user retry', async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) => summary(index + 1));
    const secondPage = Array.from({ length: 20 }, (_, index) => summary(index + 21));
    const listSpy = vi
      .spyOn(noteApi, 'list')
      .mockResolvedValueOnce(page(firstPage, 0, true))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(page(secondPage, 1, false));
    renderWorkspace();

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Note 1' })).toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more notes' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load more/i));
    expect(screen.getByRole('heading', { name: 'Note 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading more notes' }));

    await waitFor(() => expect(screen.getByRole('link', { name: /Note 40/ })).toBeInTheDocument());
    expect(listSpy).toHaveBeenCalledTimes(3);
  });

  it('shows an accessible loading state, empty state, and retryable initial error', async () => {
    let resolveList!: (value: AxiosResponse<NoteListResponse>) => void;
    const listSpy = vi
      .spyOn(noteApi, 'list')
      .mockImplementationOnce(() => new Promise((resolve) => (resolveList = resolve)) as never);
    const view = renderWorkspace();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await act(async () => resolveList(page([], 0, false)));
    await waitFor(() => expect(screen.getByText('No active notes yet')).toBeInTheDocument());
    view.unmount();

    listSpy.mockRejectedValueOnce(new Error('offline'));
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load your notes/i)
    );
    listSpy.mockResolvedValueOnce(page([summary(1, null)], 0, false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Untitled note' })).toBeInTheDocument()
    );
  });

  it('shows a Resume entry only to the verified draft owner without exposing draft text', async () => {
    retainedRecovery.entry = {
      ownerId: 1,
      editorRoute: '/notes/6',
      draft: { title: 'Private unsaved text', content: null },
      persistedVersion: { id: 6, version: 2 },
    };
    vi.spyOn(noteApi, 'list').mockResolvedValue(page([], 0, false));
    const view = renderWorkspace();

    expect(await screen.findByRole('link', { name: 'Resume unsaved note' })).toHaveAttribute(
      'href',
      '/notes/6'
    );
    expect(screen.queryByText('Private unsaved text')).toBeNull();

    session.value.verifiedUserId = 2;
    view.rerender(<NotesWorkspacePage />);
    expect(screen.queryByRole('link', { name: 'Resume unsaved note' })).toBeNull();
  });
});
