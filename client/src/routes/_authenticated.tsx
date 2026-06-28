import { createFileRoute, redirect } from '@tanstack/react-router';
import { isAxiosError } from 'axios';
import { userApi } from '@/user/api';
import { AppShell } from '@/app/layout/AppShell';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData({
        queryKey: ['me'],
        queryFn: async () => {
          const response = await userApi.getCurrentUser();
          return response.data;
        },
      });
    } catch (error) {
      if (
        isAxiosError(error) &&
        (error.response?.status === 401 || error.response?.status === 403)
      ) {
        throw redirect({
          to: '/login',
        });
      }
      throw error;
    }
  },
  component: AppShell,
});
