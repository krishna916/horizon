import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';
import type { RegisterUserRequest, CurrentUserResponse } from '../types';

/**
 * Hook for registering a new user.
 * Wraps the `userApi.register` call with TanStack Query's `useMutation`.
 * On success it invalidates the cached `me` query (if any) so the UI
 * can refresh the authenticated user information.
 */
export const useRegisterUser = () => {
  const queryClient = useQueryClient();
  return useMutation<CurrentUserResponse, AxiosError<{ title?: string }>, RegisterUserRequest>({
    mutationFn: async (data) => {
      const response = await userApi.register(data);
      return response.data;
    },
    onSuccess: () => {
      // Invalidate any cached current‑user query so it refetches.
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};
