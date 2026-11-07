import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '../api';
import { SESSION_MARKER_KEY } from './sessionMarker';
import { AuthSessionProvider, useAuthSession } from './AuthSessionProvider';

vi.mock('../api', () => ({
  userApi: { getCurrentUser: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function SessionState() {
  const session = useAuthSession();
  return (
    <div>
      <span data-testid="phase">{session.phase}</span>
      <span data-testid="user">{session.verifiedUserId ?? 'none'}</span>
      <span data-testid="revision">{session.ownerRevision}</span>
      <span data-testid="epoch">{session.epoch}</span>
      <button onClick={() => void session.verifySession()}>retry</button>
      <button
        onClick={() => session.acceptLocalAuthentication({ id: 8, email: 'eight@example.com' })}
      >
        accept
      </button>
      <button onClick={() => session.acceptLocalLogout()}>logout</button>
    </div>
  );
}

function renderSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <SessionState />
      </AuthSessionProvider>
    </QueryClientProvider>
  );
  return { ...view, queryClient };
}

function user(id: number): Awaited<ReturnType<typeof userApi.getCurrentUser>> {
  return { data: { id, email: `${id}@example.com` } } as Awaited<
    ReturnType<typeof userApi.getCurrentUser>
  >;
}

function changeMarker(marker: string) {
  localStorage.setItem(SESSION_MARKER_KEY, marker);
  window.dispatchEvent(new StorageEvent('storage', { key: SESSION_MARKER_KEY, newValue: marker }));
}

describe('AuthSessionProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(userApi.getCurrentUser).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the verified user before a storage-change verification resolves', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce(user(1));
    const pending = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    vi.mocked(userApi.getCurrentUser).mockReturnValueOnce(pending.promise);
    renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));

    act(() => changeMarker('opaque-next'));

    expect(screen.getByTestId('phase')).toHaveTextContent('verifying');
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    await act(async () => pending.resolve(user(2)));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('2'));
  });

  it('deduplicates the same marker and verifies again on resume', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue(user(1));
    renderSession();
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(1));

    act(() => changeMarker('opaque-next'));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
    act(() => changeMarker('opaque-next'));
    expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(3));
  });

  it('does not increment owner revision when the same owner is verified again', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue(user(1));
    renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    act(() => changeMarker('same-owner'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('verified'));
    expect(screen.getByTestId('revision')).toHaveTextContent('0');
  });

  it('increments owner revision when a different owner is verified', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValueOnce(user(1)).mockResolvedValueOnce(user(2));
    renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    act(() => changeMarker('different-owner'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('2'));
    expect(screen.getByTestId('revision')).toHaveTextContent('1');
  });

  it('does not let an older verification overwrite a newer one', async () => {
    const initial = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    const older = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    const newer = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    vi.mocked(userApi.getCurrentUser)
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    renderSession();
    await act(async () => initial.resolve(user(1)));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));

    act(() => changeMarker('epoch-2'));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
    act(() => changeMarker('epoch-3'));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(3));
    await act(async () => newer.resolve(user(3)));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('3'));
    await act(async () => older.resolve(user(2)));
    expect(screen.getByTestId('user')).toHaveTextContent('3');
  });

  it('keeps network failures retryable and restores only a verified account', async () => {
    vi.mocked(userApi.getCurrentUser)
      .mockResolvedValueOnce(user(1))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(user(1));
    renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    act(() => changeMarker('retryable'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('retryable-error'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    act(() => screen.getByText('retry').click());
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
  });

  it('marks a 401 session check unauthenticated', async () => {
    vi.mocked(userApi.getCurrentUser)
      .mockResolvedValueOnce(user(1))
      .mockRejectedValueOnce({ response: { status: 401 } });
    renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    act(() => changeMarker('unauthenticated'));
    await waitFor(() => expect(screen.getByTestId('phase')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('still verifies on focus when storage cannot be read', async () => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue(user(1));
    renderSession();
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(1));
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
  });
});
