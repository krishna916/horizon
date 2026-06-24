import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';
import type { LoginRequest, CurrentUserResponse } from '../types';

/**
 * Hook for authenticating an existing user.
 * Wraps the `userApi.login` call with TanStack Query's `useMutation`.
 * On success it invalidates the cached `me` query so the UI
 * can refresh the authenticated user information.
 */
export const useLoginUser = () => {
  const queryClient = useQueryClient();
  return useMutation<CurrentUserResponse, AxiosError<{ title?: string }>, LoginRequest>({
    mutationFn: async (data) => {
      const response = await userApi.login(data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate any cached current‑user query so it refetches.
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};
