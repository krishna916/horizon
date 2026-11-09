import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '../api';
import { AuthSessionProvider, useAuthSession } from './AuthSessionProvider';

vi.mock('../api', () => ({
  userApi: { getCurrentUser: vi.fn() },
}));

function SessionProbe({ queryClient }: { queryClient: QueryClient }) {
  const session = useAuthSession();
  return (
    <div>
      <output data-testid="user">{session.verifiedUserId ?? 'none'}</output>
      <button
        onClick={() => session.acceptLocalAuthentication({ id: 2, email: 'two@example.com' })}
      >
        Switch account
      </button>
      <button onClick={session.acceptLocalLogout}>Logout</button>
      <button onClick={() => void session.verifySession()}>Verify again</button>
      <button
        onClick={() => {
          queryClient.setQueryData(['notes', 1, 'list', 'active', 'updated_desc'], ['private']);
          queryClient.setQueryData(['notes', 1, 'detail', 7], { title: 'private' });
        }}
      >
        Cache Notes
      </button>
    </div>
  );
}

function renderSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(
    <Wrapper>
      <AuthSessionProvider>
        <SessionProbe queryClient={queryClient} />
      </AuthSessionProvider>
    </Wrapper>
  );
  return queryClient;
}

describe('Notes private session queries', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
  });

  afterEach(() => vi.restoreAllMocks());

  it('removes Notes list and detail queries on account change and logout', async () => {
    const queryClient = renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));

    fireEvent.click(screen.getByRole('button', { name: 'Cache Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    expect(
      queryClient.getQueryData(['notes', 1, 'list', 'active', 'updated_desc'])
    ).toBeUndefined();
    expect(queryClient.getQueryData(['notes', 1, 'detail', 7])).toBeUndefined();
    expect(screen.getByTestId('user')).toHaveTextContent('2');

    queryClient.setQueryData(['notes', 2, 'list', 'active', 'updated_desc'], ['private']);
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(
      queryClient.getQueryData(['notes', 2, 'list', 'active', 'updated_desc'])
    ).toBeUndefined();
    expect(screen.getByTestId('user')).toHaveTextContent('none');
  });

  it('keeps same-owner Notes cache entries when session verification succeeds again', async () => {
    const queryClient = renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    queryClient.setQueryData(['notes', 1, 'list', 'active', 'updated_desc'], ['owner one']);

    fireEvent.click(screen.getByRole('button', { name: 'Verify again' }));

    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
    expect(queryClient.getQueryData(['notes', 1, 'list', 'active', 'updated_desc'])).toEqual([
      'owner one',
    ]);
  });

  it('cancels a pending Notes request when the owner logs out', async () => {
    const queryClient = renderSession();
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('1'));
    let requestSignal: AbortSignal | undefined;
    void queryClient
      .fetchQuery({
        queryKey: ['notes', 1, 'list', 'active', 'updated_desc'],
        queryFn: ({ signal }) => {
          requestSignal = signal;
          return new Promise<never>(() => undefined);
        },
      })
      .catch(() => undefined);

    await waitFor(() => expect(requestSignal).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));

    await waitFor(() => expect(requestSignal?.aborted).toBe(true));
    expect(
      queryClient.getQueryData(['notes', 1, 'list', 'active', 'updated_desc'])
    ).toBeUndefined();
  });
});
