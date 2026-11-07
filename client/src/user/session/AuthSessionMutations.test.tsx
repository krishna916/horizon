import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '../api';
import { useLoginUser } from '../hooks/useLoginUser';
import { useLogoutUser } from '../hooks/useLogoutUser';
import { useRegisterUser } from '../hooks/useRegisterUser';
import { AuthSessionProvider, useAuthSession } from './AuthSessionProvider';
import { SESSION_MARKER_KEY } from './sessionMarker';

vi.mock('../api', () => ({
  userApi: {
    getCurrentUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

function AuthMutationControls() {
  const session = useAuthSession();
  const login = useLoginUser();
  const register = useRegisterUser();
  const logout = useLogoutUser();
  return (
    <div>
      <output data-testid="session">{`${session.phase}:${session.verifiedUserId ?? 'none'}`}</output>
      <button onClick={() => login.mutate({ email: 'two@example.com', password: 'Password123!' })}>
        Login B
      </button>
      <button
        onClick={() => register.mutate({ email: 'three@example.com', password: 'Password123!' })}
      >
        Register C
      </button>
      <button onClick={() => logout.mutate()}>Logout</button>
      <output data-testid="login-status">
        {login.isSuccess ? 'login success' : login.isError ? 'login error' : ''}
      </output>
      <output data-testid="register-status">
        {register.isSuccess ? 'register success' : register.isError ? 'register error' : ''}
      </output>
      <output data-testid="logout-status">{logout.isSuccess ? 'logout success' : ''}</output>
    </div>
  );
}

function renderControls() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthSessionProvider>
        <AuthMutationControls />
      </AuthSessionProvider>
    </QueryClientProvider>
  );
}

describe('auth mutation session changes', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
    vi.mocked(userApi.login).mockResolvedValue({
      data: { id: 2, email: 'two@example.com' },
    } as Awaited<ReturnType<typeof userApi.login>>);
    vi.mocked(userApi.register).mockResolvedValue({
      data: { id: 3, email: 'three@example.com' },
    } as Awaited<ReturnType<typeof userApi.register>>);
    vi.mocked(userApi.logout).mockResolvedValue({} as Awaited<ReturnType<typeof userApi.logout>>);
  });

  afterEach(() => vi.restoreAllMocks());

  it('updates the sender and publishes exactly one marker after successful login and registration', async () => {
    const nativeSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      nativeSetItem.call(this, key, value);
    });
    renderControls();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));

    fireEvent.click(screen.getByRole('button', { name: 'Login B' }));
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:2'));
    const loginMarker = localStorage.getItem(SESSION_MARKER_KEY);
    expect(loginMarker).toBeTruthy();
    expect(setItemSpy.mock.calls.filter(([key]) => key === SESSION_MARKER_KEY)).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Register C' }));
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:3'));
    const registrationMarker = localStorage.getItem(SESSION_MARKER_KEY);
    expect(registrationMarker).toBeTruthy();
    expect(registrationMarker).not.toBe(loginMarker);
    expect(setItemSpy.mock.calls.filter(([key]) => key === SESSION_MARKER_KEY)).toHaveLength(2);
  });

  it('publishes logout only after the server confirms success', async () => {
    const nativeSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      nativeSetItem.call(this, key, value);
    });
    renderControls();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('unauthenticated:none')
    );
    expect(screen.getByTestId('logout-status')).toHaveTextContent('logout success');
    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeTruthy();
    expect(setItemSpy.mock.calls.filter(([key]) => key === SESSION_MARKER_KEY)).toHaveLength(1);
  });

  it('does not publish failed auth operations and preserves the authenticated sender state', async () => {
    vi.mocked(userApi.login).mockRejectedValueOnce({ response: { status: 401 } });
    vi.mocked(userApi.register).mockRejectedValueOnce(new Error('registration failed'));
    vi.mocked(userApi.logout).mockRejectedValueOnce(new Error('logout failed'));
    renderControls();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));

    fireEvent.click(screen.getByRole('button', { name: 'Login B' }));
    await waitFor(() =>
      expect(screen.getByTestId('login-status')).toHaveTextContent('login error')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Register C' }));
    await waitFor(() =>
      expect(screen.getByTestId('register-status')).toHaveTextContent('register error')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(userApi.logout).toHaveBeenCalledTimes(1));

    expect(localStorage.getItem(SESSION_MARKER_KEY)).toBeNull();
    expect(screen.getByTestId('session')).toHaveTextContent('verified:1');
  });

  it('does not turn a successful auth operation into failure when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key) => {
      if (key === SESSION_MARKER_KEY) throw new DOMException('Blocked', 'SecurityError');
    });
    renderControls();
    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:1'));
    fireEvent.click(screen.getByRole('button', { name: 'Login B' }));

    await waitFor(() => expect(screen.getByTestId('session')).toHaveTextContent('verified:2'));
    expect(screen.getByTestId('login-status')).toHaveTextContent('login success');
  });
});
