import { createFileRoute, redirect } from '@tanstack/react-router';
import { isCancelledError } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { userApi } from '@/user/api';
import { AppShell } from '@/app/layout/AppShell';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    const fetchCurrentUser = () =>
      context.queryClient.fetchQuery({
        queryKey: ['me'],
        queryFn: async () => {
          const response = await userApi.getCurrentUser();
          return response.data;
        },
        staleTime: 0,
      });

    try {
      await fetchCurrentUser();
    } catch (error) {
      let sessionError = error;
      if (isCancelledError(error)) {
        try {
          await fetchCurrentUser();
          return;
        } catch (retryError) {
          sessionError = retryError;
        }
      }
      if (
        isAxiosError(sessionError) &&
        (sessionError.response?.status === 401 || sessionError.response?.status === 403)
      ) {
        throw redirect({
          to: '/login',
        });
      }
      throw sessionError;
    }
  },
  component: AppShell,
});
