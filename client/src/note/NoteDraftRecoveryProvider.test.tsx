import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthSessionProvider, useAuthSession } from '@/user/session/AuthSessionProvider';
import { notifySessionUnauthorized, getCurrentSessionEpoch } from '@/user/session/sessionRuntime';
import { NoteDraftRecoveryProvider, useNoteDraftRecovery } from './NoteDraftRecoveryProvider';
import type { NoteDraft } from './noteDraft';
import { userApi } from '@/user/api';
import { publishSessionMarker, SESSION_MARKER_KEY } from '@/user/session/sessionMarker';

vi.mock('@/user/api', () => ({
  userApi: {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

const draft: NoteDraft = {
  title: 'Memory only',
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
};

function RecoveryProbe() {
  const session = useAuthSession();
  const recovery = useNoteDraftRecovery();
  const available = recovery.peekForVerifiedOwner(1);
  return (
    <div>
      <output data-testid="session">{`${session.phase}:${session.verifiedUserId ?? 'none'}`}</output>
      <output data-testid="recovery">{available?.draft.title ?? 'hidden'}</output>
      <output data-testid="recovery-key">{available?.frozenCreateRequest?.key ?? 'none'}</output>
      <button
        type="button"
        onClick={() =>
          recovery.stash(1, '/notes/new', draft, undefined, {
            body: { title: 'Memory only', content: draft.content },
            key: '79c95e5a-c4e8-47f3-a4a0-bbc7fd0c3241',
          })
        }
      >
        Stash
      </button>
      <button type="button" onClick={() => void session.verifySession()}>
        Verify
      </button>
      <button type="button" onClick={session.acceptLocalLogout}>
        Logout
      </button>
    </div>
  );
}

function renderRecovery() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <NoteDraftRecoveryProvider>
          <RecoveryProbe />
        </NoteDraftRecoveryProvider>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

describe('NoteDraftRecoveryProvider', () => {
  it('hides an expired draft and restores it only after same-owner verification', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    renderRecovery();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));

    fireEvent.click(screen.getByRole('button', { name: 'Stash' }));
    expect(screen.getByTestId('recovery')).toHaveTextContent('Memory only');
    act(() => notifySessionUnauthorized(getCurrentSessionEpoch()));
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:none')
    );
    expect(screen.getByTestId('recovery')).toHaveTextContent('hidden');

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    expect(screen.getByTestId('recovery')).toHaveTextContent('Memory only');
    expect(screen.getByTestId('recovery-key')).toHaveTextContent(
      '79c95e5a-c4e8-47f3-a4a0-bbc7fd0c3241'
    );
  });

  it('discards memory after explicit logout', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    renderRecovery();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Stash' }));

    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('hidden'));
  });

  it('discards memory when a different owner is verified', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce({
      data: { id: 2, email: 'two@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    renderRecovery();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Stash' }));

    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:2'));
    expect(screen.getByTestId('recovery')).toHaveTextContent('hidden');
  });

  it('discards memory on an explicit cross-tab logout marker', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    vi.mocked(userApi.getCurrentUser).mockRejectedValueOnce({ response: { status: 401 } });
    renderRecovery();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Stash' }));
    const marker = publishSessionMarker('logout');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: SESSION_MARKER_KEY, newValue: marker })
      );
    });

    await waitFor(() => expect(screen.getByTestId('recovery')).toHaveTextContent('hidden'));
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:none')
    );
  });
});
