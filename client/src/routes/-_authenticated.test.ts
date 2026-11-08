import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userApi } from '@/user/api';
import { Route } from './_authenticated';

vi.mock('@/user/api', () => ({
  userApi: { getCurrentUser: vi.fn() },
}));

describe('authenticated route session guard', () => {
  beforeEach(() => {
    vi.mocked(userApi.getCurrentUser).mockReset();
  });

  it('revalidates a cached current user with the server before allowing the route', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['me'], { id: 1, email: 'account-a@example.com' });
    vi.mocked(userApi.getCurrentUser).mockResolvedValue({
      data: { id: 2, email: 'account-b@example.com' },
    } as Awaited<ReturnType<typeof userApi.getCurrentUser>>);

    await Route.options.beforeLoad?.({ context: { queryClient } } as never);

    expect(userApi.getCurrentUser).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(['me'])).toEqual({
      id: 2,
      email: 'account-b@example.com',
    });
  });

  it('retries the session check when verification removes its in-flight query', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let resolveFirstRequest!: (value: Awaited<ReturnType<typeof userApi.getCurrentUser>>) => void;
    vi.mocked(userApi.getCurrentUser)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirstRequest = resolve;
        })
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('Unauthorized'), {
          isAxiosError: true,
          response: { status: 401 },
        })
      );

    const routeCheck = Route.options.beforeLoad?.({ context: { queryClient } } as never);
    await vi.waitFor(() => expect(userApi.getCurrentUser).toHaveBeenCalledTimes(1));
    queryClient.removeQueries({ queryKey: ['me'], exact: true });
    resolveFirstRequest({ data: { id: 1, email: 'account-a@example.com' } } as Awaited<
      ReturnType<typeof userApi.getCurrentUser>
    >);

    await expect(routeCheck).rejects.toMatchObject({ options: { to: '/login' } });
    expect(userApi.getCurrentUser).toHaveBeenCalledTimes(2);
  });
});
