import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthSessionProvider, useAuthSession } from '@/user/session/AuthSessionProvider';
import { userApi } from '@/user/api';
import { noteApi } from './api';
import { noteQueryKeys } from './queries';
import { NoteDraftRecoveryProvider } from './NoteDraftRecoveryProvider';
import { useNoteAutosave } from './useNoteAutosave';
import type { NoteDraft } from './noteDraft';
import type { NoteDetail } from './types';

vi.mock('./api', () => ({
  noteApi: { create: vi.fn(), update: vi.fn(), get: vi.fn(), list: vi.fn() },
}));
vi.mock('@/user/api', () => ({
  userApi: { getCurrentUser: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() },
}));

const initial: NoteDetail = {
  id: 7,
  title: 'Existing',
  content: null,
  version: 2,
  inbox: false,
  archivedAt: null,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};
const localDraft: NoteDraft = {
  title: 'Existing',
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Local' }] }],
  },
};
const response = <T,>(data: T) => ({ data }) as never;

function AutosaveProbe() {
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const [draft, setDraft] = useState<NoteDraft>({
    title: initial.title ?? '',
    content: initial.content,
  });
  const autosave = useNoteAutosave({
    ownerId: 1,
    initialNote: initial,
    initialDraft: draft,
    editorRoute: '/notes/7',
    onCreated: vi.fn(),
  });
  return (
    <div>
      <output data-testid="phase">{`${session.phase}:${autosave.snapshot.phase}`}</output>
      <output data-testid="draft">{autosave.snapshot.draft.content ? 'body' : 'empty'}</output>
      <button
        type="button"
        onClick={() => {
          setDraft(localDraft);
          autosave.edit(localDraft);
        }}
      >
        Edit
      </button>
      <button type="button" onClick={() => void autosave.flush()}>
        Flush
      </button>
      <button type="button" onClick={() => void session.verifySession()}>
        Reverify
      </button>
      <button
        type="button"
        onClick={() => session.acceptLocalAuthentication({ id: 2, email: 'two@example.com' })}
      >
        Switch owner
      </button>
      <button
        type="button"
        onClick={() =>
          queryClient.setQueryData(
            noteQueryKeys.detail(1, 7),
            response({ ...initial, content: localDraft.content })
          )
        }
      >
        Refresh cache
      </button>
    </div>
  );
}

function renderAutosave(
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  strict = false
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <NoteDraftRecoveryProvider>{children}</NoteDraftRecoveryProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
  return {
    ...render(
      strict ? (
        <StrictMode>
          <AutosaveProbe />
        </StrictMode>
      ) : (
        <AutosaveProbe />
      ),
      { wrapper }
    ),
    queryClient,
  };
}

describe('useNoteAutosave', () => {
  afterEach(() => vi.clearAllMocks());

  it('keeps its coordinator alive across React Strict Mode effect replay', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    vi.mocked(noteApi.update).mockResolvedValue(
      response({ ...initial, version: 3, content: localDraft.content })
    );
    renderAutosave(undefined, true);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('draft')).toHaveTextContent('body');
    fireEvent.click(screen.getByRole('button', { name: 'Flush' }));

    await waitFor(() => expect(noteApi.update).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
  });

  it('updates only the owner list cache and writes the current detail without per-card refetch', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    vi.mocked(noteApi.update).mockResolvedValue(
      response({ ...initial, version: 3, content: localDraft.content })
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ownerOneList = noteQueryKeys.list(1, 'active', 'updated_desc');
    const ownerTwoList = noteQueryKeys.list(2, 'active', 'updated_desc');
    queryClient.setQueryData(ownerOneList, { pages: [], pageParams: [] });
    queryClient.setQueryData(ownerTwoList, { pages: [], pageParams: [] });
    queryClient.setQueryData(noteQueryKeys.detail(2, 7), response(initial));
    const rendered = renderAutosave(queryClient);
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    vi.mocked(noteApi.get).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flush' }));

    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    await waitFor(() => expect(queryClient.getQueryState(ownerOneList)?.isInvalidated).toBe(true));
    expect(queryClient.getQueryState(ownerTwoList)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(noteQueryKeys.detail(2, 7))?.isInvalidated).toBe(false);
    expect(noteApi.get).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(noteQueryKeys.detail(1, 7))).toMatchObject({
      data: { id: 7, version: 3, content: localDraft.content },
    });
    rendered.unmount();
  });

  it('keeps a dirty editor draft when its background detail cache changes', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    const rendered = renderAutosave();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh cache' }));

    expect(screen.getByTestId('draft')).toHaveTextContent('body');
    expect(screen.getByTestId('phase')).toHaveTextContent('verified:dirty');
    rendered.unmount();
  });

  it('reconciles an in-flight save after same-owner session re-verification', async () => {
    let resolveUpdate!: (value: never) => void;
    const updatePending = new Promise<never>((resolve) => {
      resolveUpdate = resolve;
    });
    let resolveVerification!: (value: never) => void;
    const verificationPending = new Promise<never>((resolve) => {
      resolveVerification = resolve;
    });
    vi.mocked(userApi.getCurrentUser)
      .mockResolvedValueOnce({ data: { id: 1, email: 'one@example.com' } } as never)
      .mockReturnValueOnce(verificationPending);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    vi.mocked(noteApi.update).mockReturnValueOnce(updatePending);
    const rendered = renderAutosave();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    vi.mocked(noteApi.get).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flush' }));
    await waitFor(() => expect(noteApi.update).toHaveBeenCalledOnce());
    const committed = { ...initial, version: 3, content: localDraft.content };
    vi.mocked(noteApi.get).mockResolvedValue(response(committed));
    fireEvent.click(screen.getByRole('button', { name: 'Reverify' }));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verifying:paused'));

    resolveUpdate(response(committed));
    await act(async () => {
      await Promise.resolve();
      resolveVerification({ data: { id: 1, email: 'one@example.com' } } as never);
    });
    await waitFor(() => expect(noteApi.get).toHaveBeenCalledWith(7));

    expect(noteApi.update).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(rendered.queryClient.getQueryData(noteQueryKeys.detail(1, 7))).toMatchObject({
        data: { version: 3, content: localDraft.content },
      })
    );
    rendered.unmount();
  });

  it('cancels pending autosave and ignores an old response after owner change', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    const rendered = renderAutosave();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(noteApi.update).not.toHaveBeenCalled();
    expect(rendered.queryClient.getQueryData(noteQueryKeys.detail(1, 7))).toBeUndefined();
    rendered.unmount();
    vi.useRealTimers();
  });

  it('does not update either owner cache when an old save resolves after account switch', async () => {
    let resolveUpdate!: (value: never) => void;
    const updatePending = new Promise<never>((resolve) => {
      resolveUpdate = resolve;
    });
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as never);
    vi.mocked(noteApi.get).mockResolvedValue(response(initial));
    vi.mocked(noteApi.update).mockReturnValueOnce(updatePending);
    const rendered = renderAutosave();
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified:saved'));
    const oldDetailKey = noteQueryKeys.detail(1, 7);
    rendered.queryClient.setQueryData(oldDetailKey, response(initial));
    vi.mocked(noteApi.get).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Flush' }));
    await waitFor(() => expect(noteApi.update).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    resolveUpdate(response({ ...initial, version: 3, content: localDraft.content }));
    await act(async () => Promise.resolve());

    expect(rendered.queryClient.getQueryData(oldDetailKey)).toBeUndefined();
    expect(rendered.queryClient.getQueryData(noteQueryKeys.detail(2, 7))).toBeUndefined();
    expect(noteApi.get).not.toHaveBeenCalled();
    rendered.unmount();
  });
});
