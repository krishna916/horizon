import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { AuthSessionProvider, useAuthSession } from '@/user/session/AuthSessionProvider';
import { SessionOwnedTree } from './SessionOwnedTree';

vi.mock('@/user/api', () => ({ userApi: { getCurrentUser: vi.fn() } }));

function DraftProbe() {
  const [draft, setDraft] = useState('original draft');
  return <button onClick={() => setDraft('changed draft')}>{draft}</button>;
}

function SwitchOwner() {
  const { acceptLocalAuthentication } = useAuthSession();
  return (
    <button onClick={() => acceptLocalAuthentication({ id: 2, email: 'two@example.com' })}>
      Switch owner
    </button>
  );
}

describe('SessionOwnedTree', () => {
  beforeEach(() => {
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 1, email: 'one@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);
  });

  it('preserves a draft after same-owner verification and discards it after an owner switch', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AuthSessionProvider>
          <SwitchOwner />
          <SessionOwnedTree>
            <DraftProbe />
          </SessionOwnedTree>
        </AuthSessionProvider>
      </QueryClientProvider>
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'original draft' })).toBeVisible()
    );
    fireEvent.click(screen.getByRole('button', { name: 'original draft' }));
    expect(screen.getByRole('button', { name: 'changed draft' })).toBeVisible();

    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'changed draft' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Switch owner' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'original draft' })).toBeVisible()
    );
    expect(screen.queryByRole('button', { name: 'changed draft' })).not.toBeInTheDocument();
  });
});
