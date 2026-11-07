import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AxiosError } from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { userApi } from '../api';
import { AuthSessionProvider, useAuthSession } from './AuthSessionProvider';

vi.mock('../api', () => ({
  userApi: { getCurrentUser: vi.fn() },
}));

function SessionStatus() {
  const session = useAuthSession();
  return (
    <div>
      <output data-testid="session">{`${session.phase}:${session.verifiedUserId ?? 'none'}`}</output>
      <button
        onClick={() => session.acceptLocalAuthentication({ id: 2, email: 'two@example.com' })}
      >
        Switch to B
      </button>
    </div>
  );
}

function renderSession() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <SessionStatus />
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

function unauthorized(config: InternalAxiosRequestConfig) {
  return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
    data: {},
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });
}

describe('api client authentication failures', () => {
  beforeEach(() => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
  });

  it('hides private state after a protected request returns 401', async () => {
    renderSession();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));

    await act(async () => {
      await expect(
        apiClient.get('/tasks', {
          adapter: (config) => Promise.reject(unauthorized(config)),
        })
      ).rejects.toMatchObject({ response: { status: 401 } });
    });

    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:none')
    );
  });

  it('does not treat login credential rejection as a session loss', async () => {
    renderSession();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));

    await expect(
      apiClient.post(
        '/auth/login',
        {},
        {
          adapter: (config) => Promise.reject(unauthorized(config)),
        }
      )
    ).rejects.toMatchObject({ response: { status: 401 } });

    expect(screen.getByTestId('session')).toHaveTextContent('verified:1');
  });

  it('ignores an old protected 401 after a newer local identity is accepted', async () => {
    let rejectRequest!: () => void;
    renderSession();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    const request = apiClient.get('/tasks', {
      adapter: (config) =>
        new Promise((_resolve, reject) => {
          rejectRequest = () => reject(unauthorized(config));
        }),
    });
    await waitFor(() => expect(rejectRequest).toBeTypeOf('function'));

    fireEvent.click(screen.getByRole('button', { name: 'Switch to B' }));
    expect(screen.getByTestId('session')).toHaveTextContent('verified:2');
    await act(async () => {
      rejectRequest();
      await request.catch(() => undefined);
    });

    expect(screen.getByTestId('session')).toHaveTextContent('verified:2');
  });
});
