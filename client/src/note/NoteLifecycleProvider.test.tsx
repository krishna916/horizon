import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteLifecycleProvider, useNoteLifecycle } from './NoteLifecycleProvider';
import { noteApi } from './api';
import { noteQueryKeys } from './queries';
import type { NoteDetail, NoteListResponse, NoteSummary } from './types';

const summary: NoteSummary = {
  id: 7,
  title: 'Planning',
  preview: null,
  tags: [],
  version: 4,
  inbox: true,
  archivedAt: null,
  createdAt: '2026-11-21T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
};

const detail = (version: number, archivedAt: string | null): NoteDetail => ({
  ...summary,
  version,
  archivedAt,
  content: null,
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData<InfiniteData<AxiosResponse<NoteListResponse>>>(
    noteQueryKeys.list(1, 'active', 'updated_desc'),
    {
      pages: [
        {
          data: {
            items: [summary],
            page: 0,
            size: 20,
            hasNext: false,
            counts: { active: 1, archived: 0 },
          },
        } as AxiosResponse<NoteListResponse>,
      ],
      pageParams: [0],
    }
  );
  function Harness() {
    const lifecycle = useNoteLifecycle();
    return (
      <>
        <button onClick={() => void lifecycle.run(1, summary, 'archive')}>Archive</button>
        <button onClick={() => void lifecycle.run(1, summary, 'delete')}>Delete</button>
        <button
          onClick={() =>
            void lifecycle.run(1, { ...summary, archivedAt: '2026-11-20T10:00:00Z' }, 'delete')
          }
        >
          Delete archived
        </button>
        <button
          onClick={() =>
            void lifecycle.run(1, { ...summary, archivedAt: '2026-11-20T10:00:00Z' }, 'restore')
          }
        >
          Restore archived
        </button>
        {lifecycle.notices.map((notice) => (
          <div key={notice.id}>
            <span>{notice.kind}</span>
            <span>{notice.operation}</span>
            <span>{notice.error}</span>
            <button onClick={() => void lifecycle.undo(notice.id)}>Undo</button>
            <button onClick={() => void lifecycle.retryDelete(notice.id)}>Retry delete</button>
          </div>
        ))}
      </>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <NoteLifecycleProvider ownerId={1}>
        <Harness />
      </NoteLifecycleProvider>
    </QueryClientProvider>
  );
  return { queryClient };
}

afterEach(() => vi.restoreAllMocks());

describe('NoteLifecycleProvider', () => {
  it('uses the server returned version for archive Undo and removes the old list row', async () => {
    const archived = detail(8, '2026-11-21T11:00:00Z');
    const archive = vi.spyOn(noteApi, 'archive').mockResolvedValue({ data: archived } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockResolvedValue({
      data: detail(9, null),
    } as never);
    const { queryClient } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    expect(archive).toHaveBeenCalledWith(7, 4);
    expect(
      queryClient.getQueryData<InfiniteData<AxiosResponse<NoteListResponse>>>(
        noteQueryKeys.list(1, 'active', 'updated_desc')
      )?.pages[0]?.data.items
    ).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(7, 8));
  });

  it('keeps uncertain deletion retryable at the original expected version', async () => {
    const remove = vi
      .spyOn(noteApi, 'softDelete')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ data: { id: 7, version: 5 } } as never);
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('delete-unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));
    await screen.findByText('undo');

    expect(remove).toHaveBeenNthCalledWith(1, 7, 4);
    expect(remove).toHaveBeenNthCalledWith(2, 7, 4);
  });

  it('uses the confirmed delete version to Undo an archived Note and preserves its archived placement', async () => {
    const remove = vi
      .spyOn(noteApi, 'softDelete')
      .mockResolvedValue({ data: { id: 7, version: 8 } } as never);
    const restore = vi.spyOn(noteApi, 'restoreDeleted').mockResolvedValue({
      data: detail(9, '2026-11-20T10:00:00Z'),
    } as never);
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete archived' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(7, 8));
    expect(remove).toHaveBeenCalledWith(7, 4);
  });

  it('supersedes an older Note notice when a newer lifecycle action runs for that Note', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    vi.spyOn(noteApi, 'softDelete').mockResolvedValue({ data: { id: 7, version: 9 } } as never);
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('archive');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('delete')).toBeInTheDocument();
    expect(screen.queryByText('archive')).not.toBeInTheDocument();
  });
});
