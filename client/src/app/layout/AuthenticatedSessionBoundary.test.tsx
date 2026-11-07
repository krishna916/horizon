import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { SESSION_MARKER_KEY } from '@/user/session/sessionMarker';
import { AuthSessionProvider } from '@/user/session/AuthSessionProvider';
import { AuthenticatedSessionBoundary } from './AuthenticatedSessionBoundary';

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/user/api', () => ({
  userApi: { getCurrentUser: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderBoundary(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <AuthenticatedSessionBoundary>{children}</AuthenticatedSessionBoundary>
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

describe('AuthenticatedSessionBoundary', () => {
  it('hides private content from visual and accessibility navigation while verifying', async () => {
    const pending = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    vi.mocked(userApi.getCurrentUser).mockReturnValueOnce(pending.promise);
    renderBoundary(<button>Account A task</button>);

    expect(screen.getByRole('status')).toHaveTextContent(/verifying session/i);
    expect(screen.queryByRole('button', { name: 'Account A task' })).not.toBeInTheDocument();
    expect(screen.getByTestId('private-content')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('private-content')).toHaveAttribute('inert');

    await act(async () =>
      pending.resolve({ data: { id: 1, email: 'one@example.com' } } as Awaited<
        ReturnType<typeof userApi.getCurrentUser>
      >)
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Account A task' })).toBeVisible()
    );
  });

  it('keeps mounted drafts through same-owner verification and offers retry on failure', async () => {
    const retry = deferred<Awaited<ReturnType<typeof userApi.getCurrentUser>>>();
    vi.mocked(userApi.getCurrentUser)
      .mockResolvedValueOnce({ data: { id: 1, email: 'one@example.com' } } as Awaited<
        ReturnType<typeof userApi.getCurrentUser>
      >)
      .mockReturnValueOnce(retry.promise)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { id: 1, email: 'one@example.com' } } as Awaited<
        ReturnType<typeof userApi.getCurrentUser>
      >);
    function Draft() {
      const [value, setValue] = useState('draft');
      return <button onClick={() => setValue('changed draft')}>{value}</button>;
    }
    renderBoundary(<Draft />);
    fireEvent.click(await screen.findByRole('button', { name: 'draft' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'changed draft' })).toBeVisible()
    );

    act(() => {
      localStorage.setItem(SESSION_MARKER_KEY, 'same-owner');
      window.dispatchEvent(
        new StorageEvent('storage', { key: SESSION_MARKER_KEY, newValue: 'same-owner' })
      );
    });
    expect(screen.queryByRole('button', { name: 'changed draft' })).not.toBeInTheDocument();
    await act(async () =>
      retry.resolve({ data: { id: 1, email: 'one@example.com' } } as Awaited<
        ReturnType<typeof userApi.getCurrentUser>
      >)
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'changed draft' })).toBeVisible()
    );

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(screen.getByRole('button', { name: /retry/i })).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'changed draft' })).toBeVisible()
    );
  });

  it('navigates to Login when the session is confirmed unauthenticated', async () => {
    vi.mocked(userApi.getCurrentUser)
      .mockResolvedValueOnce({ data: { id: 1, email: 'one@example.com' } } as Awaited<
        ReturnType<typeof userApi.getCurrentUser>
      >)
      .mockRejectedValueOnce({ response: { status: 401 } });
    renderBoundary(<button>Private</button>);
    await screen.findByRole('button', { name: 'Private' });

    act(() => {
      localStorage.setItem(SESSION_MARKER_KEY, 'logged-out');
      window.dispatchEvent(
        new StorageEvent('storage', { key: SESSION_MARKER_KEY, newValue: 'logged-out' })
      );
    });

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/login', replace: true }));
    expect(screen.queryByRole('button', { name: 'Private' })).not.toBeInTheDocument();
  });
});
