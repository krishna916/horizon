import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteLifecycleNoticeList } from './NoteLifecycleNoticeList';
import { NoteLifecycleProvider, useNoteLifecycle } from './NoteLifecycleProvider';
import { noteApi } from './api';
import type { NoteDetail } from './types';

const note = (id: number, version = 4, archivedAt: string | null = null): NoteDetail => ({
  id,
  title: `Planning ${id}`,
  tags: [],
  version,
  inbox: false,
  archivedAt,
  createdAt: '2026-11-21T10:00:00Z',
  updatedAt: '2026-11-21T10:00:00Z',
  content: null,
});

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    const lifecycle = useNoteLifecycle();
    return (
      <>
        <button
          onClick={() =>
            void lifecycle.run(1, { id: 7, version: 4, archivedAt: null }, 'archive')
          }
        >
          Archive 7
        </button>
        <button
          onClick={() =>
            void lifecycle.run(1, { id: 8, version: 6, archivedAt: null }, 'delete')
          }
        >
          Delete 8
        </button>
        <NoteLifecycleNoticeList />
      </>
    );
  }
  function App({ ownerId = 1 }: { ownerId?: number }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NoteLifecycleProvider ownerId={ownerId}>
          <Harness />
        </NoteLifecycleProvider>
      </QueryClientProvider>
    );
  }
  const view = render(<App />);
  return { queryClient, view, App };
}

afterEach(() => vi.restoreAllMocks());

describe('NoteLifecycleNoticeList', () => {
  it('keeps independent confirmed notices visible and dismisses only the selected note', async () => {
    vi.spyOn(noteApi, 'archive').mockImplementation(async (id) => ({ data: note(id, 9, '2026-11-21T11:00:00Z') }) as never);
    vi.spyOn(noteApi, 'softDelete').mockImplementation(async (id) => ({ data: { id, version: 10 } }) as never);
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Archive 7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete 8' }));
    const status = await screen.findAllByRole('status');
    expect(status).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Undo Note 7 archive' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Undo Note 8 delete' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Note 7 notice' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Undo Note 8 delete' })).toBeVisible();
  });

  it('offers Retry but no Undo when delete outcome is unconfirmed', async () => {
    const remove = vi.spyOn(noteApi, 'softDelete').mockRejectedValueOnce(new Error('timeout'));
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Delete 8' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't move this note to Trash");
    expect(screen.queryByRole('button', { name: 'Undo Note 8 delete' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry delete for Note 8' })).toBeVisible();

    remove.mockResolvedValueOnce({ data: { id: 8, version: 10 } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete for Note 8' }));
    await screen.findByRole('button', { name: 'Undo Note 8 delete' });
    expect(remove).toHaveBeenNthCalledWith(1, 8, 6);
    expect(remove).toHaveBeenNthCalledWith(2, 8, 6);
  });

  it('clears notices and their recovery controls when the owner changes', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({ data: note(7, 9, '2026-11-21T11:00:00Z') } as never);
    const { view, App } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive 7' }));
    await screen.findByRole('button', { name: 'Undo Note 7 archive' });

    view.rerender(<App ownerId={2} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo Note 7 archive' })).not.toBeInTheDocument();
  });

  it('retains failed Undo with an accessible Retry and does not expire success automatically', async () => {
    const archive = vi.spyOn(noteApi, 'archive').mockResolvedValue({ data: note(7, 9, '2026-11-21T11:00:00Z') } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockRejectedValueOnce(new Error('conflict'));
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Archive 7' }));
    const undo = await screen.findByRole('button', { name: 'Undo Note 7 archive' });
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(screen.getByRole('status')).toBeVisible();
    vi.useRealTimers();
    undo.focus();
    expect(undo).toHaveFocus();
    fireEvent.click(undo);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't restore this note");
    expect(screen.getByRole('button', { name: 'Retry undo for Note 7' })).toBeVisible();
    expect(archive).toHaveBeenCalledWith(7, 4);
    expect(restore).toHaveBeenCalledWith(7, 9);
  });
});
