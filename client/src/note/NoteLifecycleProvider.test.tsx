import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteLifecycleProvider, useNoteLifecycle } from './NoteLifecycleProvider';
import type { NoteEditorUndoGateway } from './NoteLifecycleProvider';
import { noteApi } from './api';
import { NoteLifecycleActions } from './NoteLifecycleActions';
import { noteQueryKeys } from './queries';
import type { NoteDetail, NoteListResponse, NoteSummary } from './types';
import { useEffect } from 'react';
import { setCurrentOwnerRevision, setCurrentSessionEpoch } from '@/user/session/sessionRuntime';

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

function setup(gateway?: NoteEditorUndoGateway, showActions = false) {
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
    const registerEditor = lifecycle.registerEditor;
    useEffect(() => (gateway ? registerEditor(7, gateway) : undefined), [registerEditor]);
    return (
      <>
        <button onClick={() => void lifecycle.run(1, summary, 'archive')}>Archive</button>
        <button onClick={() => void lifecycle.run(1, summary, 'delete')}>Delete</button>
        <button onClick={() => void lifecycle.run(1, summary, 'archive')}>
          Run archive for Note 7
        </button>
        <button
          onClick={() =>
            void lifecycle.run(1, { ...summary, archivedAt: '2026-11-20T10:00:00Z' }, 'restore')
          }
        >
          Run restore for Note 7
        </button>
        <button onClick={() => void lifecycle.run(1, { ...summary }, 'delete')}>
          Run delete for Note 7
        </button>
        <button onClick={() => void lifecycle.run(1, { ...summary, id: 8 }, 'archive')}>
          Archive other note
        </button>
        <button onClick={() => void lifecycle.run(1, { ...summary, id: 8 }, 'delete')}>
          Delete other note
        </button>
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
            {notice.canRetry !== false && (
              <button onClick={() => void lifecycle.undo(notice.id)}>Undo</button>
            )}
            {notice.kind === 'delete-unconfirmed' && (
              <button onClick={() => void lifecycle.retryDelete(notice.id)}>Retry delete</button>
            )}
            <button onClick={() => lifecycle.dismiss(notice.id)}>Dismiss</button>
          </div>
        ))}
        <button
          onClick={() => {
            const notice = lifecycle.notices.find((item) => item.kind === 'undo');
            if (notice) void lifecycle.undo(notice.id);
          }}
        >
          Undo again
        </button>
        <span>{lifecycle.stateFor(1, 7).error}</span>
        <span>{lifecycle.stateFor(1, 8).error}</span>
        <button onClick={() => lifecycle.stateFor(1, 7).retry()}>Retry state 7</button>
        <button onClick={() => lifecycle.stateFor(1, 7).checkStatus()}>Check note status</button>
        {showActions && (
          <>
            <NoteLifecycleActions target={summary} placement="card" label="Planning card" />
            <NoteLifecycleActions target={summary} placement="list" label="Planning list" />
            <NoteLifecycleActions target={summary} placement="editor" label="Planning editor" />
          </>
        )}
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

afterEach(() => {
  vi.restoreAllMocks();
  setCurrentOwnerRevision(0);
  setCurrentSessionEpoch(0);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });

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

  it.each([409, 404])(
    'reconciles an uncertain DELETE retry %s from a readable Note without confirming deletion',
    async (status) => {
      const current = detail(7, null);
      const remove = vi
        .spyOn(noteApi, 'softDelete')
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(httpError(status));
      const get = vi.spyOn(noteApi, 'get').mockResolvedValue({ data: current } as never);
      const recover = vi.fn();
      setup({ prepare: vi.fn(), complete: vi.fn(), cancel: vi.fn(), recover });

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByText('delete-unconfirmed');
      fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));

      await waitFor(() => expect(recover).toHaveBeenCalledWith(current));
      expect(remove).toHaveBeenNthCalledWith(1, 7, 4);
      expect(remove).toHaveBeenNthCalledWith(2, 7, 4);
      expect(get).toHaveBeenCalledOnce();
      expect(screen.queryByText('undo')).not.toBeInTheDocument();
    }
  );

  it.each([404, 500])(
    'keeps recovery held and offers status-only recheck when retry or GET returns %s',
    async (status) => {
      const remove = vi
        .spyOn(noteApi, 'softDelete')
        .mockRejectedValueOnce(new Error('timeout'))
        .mockRejectedValueOnce(httpError(409));
      const get = vi.spyOn(noteApi, 'get').mockRejectedValue(httpError(status));
      const recover = vi.fn();
      setup({ prepare: vi.fn(), complete: vi.fn(), cancel: vi.fn(), recover });

      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await screen.findByText('delete-unconfirmed');
      fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));
      await screen.findByText(/Editing remains paused/);
      expect(screen.getByRole('button', { name: 'Check note status' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Check note status' }));
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

      expect(recover).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('undo')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Check note status' })).toBeInTheDocument();
    }
  );

  it('blocks lifecycle mutations while uncertain-delete recovery is required and re-enables after a safe status check', async () => {
    const current = detail(4, null);
    const remove = vi
      .spyOn(noteApi, 'softDelete')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(httpError(409));
    const archive = vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(5, '2026-11-21T11:00:00Z'),
    } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockResolvedValue({
      data: detail(5, null),
    } as never);
    const get = vi
      .spyOn(noteApi, 'get')
      .mockRejectedValueOnce(httpError(503))
      .mockRejectedValueOnce(httpError(500));
    const recover = vi.fn().mockReturnValue(true);
    setup({ prepare: vi.fn(), complete: vi.fn(), cancel: vi.fn(), recover }, true);

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await screen.findByText('delete-unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));
    await screen.findAllByText(/Editing remains paused/);

    const cardMenu = screen.getByRole('button', { name: 'More actions for Planning card' });
    const listMenu = screen.getByRole('button', { name: 'More actions for Planning list' });
    const editorArchive = screen.getAllByRole('button', { name: /^Archive$/ })[1]!;
    expect(cardMenu).toBeDisabled();
    expect(listMenu).toBeDisabled();
    expect(editorArchive).toBeDisabled();
    const editorRetry = screen.queryByRole('button', { name: 'Retry' });
    if (editorRetry) expect(editorRetry).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Check note status' })).toHaveLength(4);
    expect(
      screen
        .getAllByRole('button', { name: 'Check note status' })
        .every((button) => !button.hasAttribute('disabled'))
    ).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Run archive for Note 7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run restore for Note 7' }));
    fireEvent.click(screen.getByRole('button', { name: 'Run delete for Note 7' }));
    expect(archive).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText(/Editing remains paused/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Archive other note' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(8, 4));
    expect(screen.getAllByText(/Editing remains paused/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Check note status' })[0]!);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await screen.findAllByText(/Editing remains paused/);
    expect(cardMenu).toBeDisabled();
    expect(listMenu).toBeDisabled();
    expect(remove).toHaveBeenCalledTimes(2);

    const pendingGet = deferred<{ data: NoteDetail }>();
    get.mockReturnValueOnce(pendingGet.promise as never);
    fireEvent.click(screen.getAllByRole('button', { name: 'Check note status' })[0]!);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
    expect(
      screen
        .getAllByRole('button', { name: 'Check note status' })
        .slice(1)
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    await act(async () => pendingGet.resolve({ data: current }));

    await waitFor(() => expect(recover).toHaveBeenCalledWith(current));
    expect(screen.queryByText(/Editing remains paused/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for Planning card' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'More actions for Planning list' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: /^Archive$/ })[1]!).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Run archive for Note 7' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith(7, 4));
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('does not apply a recovery status result after the session changes', async () => {
    const current = detail(4, null);
    const remove = vi
      .spyOn(noteApi, 'softDelete')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(httpError(409));
    const get = vi.spyOn(noteApi, 'get').mockRejectedValueOnce(httpError(503));
    const recover = vi.fn();
    setup({ prepare: vi.fn(), complete: vi.fn(), cancel: vi.fn(), recover });

    fireEvent.click(screen.getByRole('button', { name: /^Delete$/ }));
    await screen.findByText('delete-unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry delete' }));
    await screen.findByText(/Editing remains paused/);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    const staleStatus = deferred<{ data: NoteDetail }>();
    get.mockReturnValueOnce(staleStatus.promise as never);
    fireEvent.click(screen.getByRole('button', { name: 'Check note status' }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    setCurrentOwnerRevision(12);
    setCurrentSessionEpoch(12);
    await act(async () => staleStatus.resolve({ data: current }));

    expect(recover).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
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

  it('serializes Undo and another lifecycle command for the same Note', async () => {
    const restoreDeferred = deferred<never>();
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockReturnValue(restoreDeferred.promise);
    const archive = vi
      .spyOn(noteApi, 'archive')
      .mockResolvedValue({ data: detail(10, '2026-11-21T12:00:00Z') } as never);
    const remove = vi
      .spyOn(noteApi, 'softDelete')
      .mockResolvedValue({ data: { id: 7, version: 11 } } as never);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => restoreDeferred.resolve({ data: detail(9, null) } as never));
    await waitFor(() => expect(screen.queryByText('undo')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7, 4));
    expect(archive).toHaveBeenCalledWith(7, 4);
  });

  it('dispatches only one request for a double Undo', async () => {
    const restoreDeferred = deferred<never>();
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockReturnValue(restoreDeferred.promise);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo again' }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    await act(async () => restoreDeferred.resolve({ data: detail(9, null) } as never));
  });

  it('keeps a newer session lock when an old Undo settles late', async () => {
    const oldUndo = deferred<never>();
    const currentArchive = deferred<never>();
    const remove = vi.spyOn(noteApi, 'softDelete');
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockReturnValue(oldUndo.promise);
    const archive = vi
      .spyOn(noteApi, 'archive')
      .mockResolvedValueOnce({ data: detail(8, '2026-11-21T11:00:00Z') } as never)
      .mockReturnValueOnce(currentArchive.promise);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    setCurrentOwnerRevision(12);
    setCurrentSessionEpoch(12);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledTimes(2));
    await act(async () => oldUndo.resolve({ data: detail(9, null) } as never));
    await Promise.resolve();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    currentArchive.resolve({ data: detail(10, '2026-11-21T12:00:00Z') } as never);
    await waitFor(() => expect(screen.getByText('undo')).toBeInTheDocument());
    setCurrentOwnerRevision(0);
    setCurrentSessionEpoch(0);
  });

  it('treats a DELETE 409 as a conflict, not an unconfirmed deletion', async () => {
    const remove = vi.spyOn(noteApi, 'softDelete').mockRejectedValue(httpError(409));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/changed elsewhere/)).toBeInTheDocument();
    expect(screen.queryByText('delete-unconfirmed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reconciles a lost Undo response only when the scoped GET confirms restoration', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockRejectedValue(httpError(409));
    const get = vi.spyOn(noteApi, 'get').mockResolvedValue({ data: detail(9, null) } as never);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('undo')).not.toBeInTheDocument());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('disables stale Undo after GET does not confirm restoration and ignores repeated clicks', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived').mockRejectedValue(httpError(409));
    const get = vi
      .spyOn(noteApi, 'get')
      .mockResolvedValue({ data: detail(8, '2026-11-21T11:00:00Z') } as never);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findAllByText(/changed elsewhere/);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledWith(7, 8);
    expect(get).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole('button', { name: 'Undo again' }));
    await Promise.resolve();
    expect(restore).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('keeps the conflict visible without a stale Undo when verification GET returns 404', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    vi.spyOn(noteApi, 'restoreArchived').mockRejectedValue(httpError(409));
    const get = vi.spyOn(noteApi, 'get').mockRejectedValue(httpError(404));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findAllByText(/changed elsewhere/);
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry delete' })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(7);
  });

  it('prepares the mounted editor at the notice version before dispatching Undo', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restored = detail(9, null);
    const restore = vi
      .spyOn(noteApi, 'restoreArchived')
      .mockResolvedValue({ data: restored } as never);
    const gateway: NoteEditorUndoGateway = {
      prepare: vi.fn().mockResolvedValue({ id: 7, version: 8 }),
      complete: vi.fn(),
      cancel: vi.fn(),
      recover: vi.fn(),
    };
    setup(gateway);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(7, 8));
    await waitFor(() => expect(gateway.complete).toHaveBeenCalledWith(restored));
    expect(gateway.prepare).toHaveBeenCalledTimes(1);
    expect(gateway.cancel).not.toHaveBeenCalled();
  });

  it('does not restore from a stale Undo notice when the editor prepared a newer version', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restore = vi.spyOn(noteApi, 'restoreArchived');
    const gateway: NoteEditorUndoGateway = {
      prepare: vi.fn().mockResolvedValue({ id: 7, version: 9 }),
      complete: vi.fn(),
      cancel: vi.fn(),
      recover: vi.fn(),
    };
    setup(gateway);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findAllByText(/changed elsewhere/);
    expect(restore).not.toHaveBeenCalled();
    expect(gateway.cancel).toHaveBeenCalledTimes(1);
  });

  it('dismisses an unconfirmed Delete and clears its inline error and retry intent', async () => {
    const remove = vi.spyOn(noteApi, 'softDelete').mockRejectedValue(new Error('timeout'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('delete-unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('delete-unconfirmed')).not.toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't move this note to Trash. Try again.")
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry state 7' }));
    await Promise.resolve();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('dismissing one uncertain Note does not clear another Note’s recovery', async () => {
    const remove = vi.spyOn(noteApi, 'softDelete').mockRejectedValue(new Error('timeout'));
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('delete-unconfirmed');
    fireEvent.click(screen.getByRole('button', { name: 'Delete other note' }));
    await waitFor(() => expect(screen.getAllByText('delete-unconfirmed')).toHaveLength(2));
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss' })[0]!);
    expect(screen.getAllByText('delete-unconfirmed')).toHaveLength(1);
    expect(screen.getAllByText("Couldn't move this note to Trash. Try again.")).toHaveLength(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('ignores dismissal while an Undo mutation is pending', async () => {
    vi.spyOn(noteApi, 'archive').mockResolvedValue({
      data: detail(8, '2026-11-21T11:00:00Z'),
    } as never);
    const restoreDeferred = deferred<never>();
    vi.spyOn(noteApi, 'restoreArchived').mockReturnValue(restoreDeferred.promise);
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await screen.findByText('undo');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByText('undo')).toBeInTheDocument();
    await act(async () => restoreDeferred.resolve({ data: detail(9, null) } as never));
  });
});
