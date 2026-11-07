import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';
import type { LoginRequest, CurrentUserResponse } from '../types';
import { useAuthSession } from '../session/AuthSessionProvider';
import { publishSessionMarker } from '../session/sessionMarker';

/**
 * Hook for authenticating an existing user.
 * Wraps the `userApi.login` call with TanStack Query's `useMutation`.
 * On success it invalidates the cached `me` query so the UI
 * can refresh the authenticated user information.
 */
export const useLoginUser = () => {
  const { acceptLocalAuthentication } = useAuthSession();
  return useMutation<CurrentUserResponse, AxiosError<{ title?: string }>, LoginRequest>({
    mutationFn: async (data) => {
      const response = await userApi.login(data);
      return response.data;
    },
    onSuccess: (user) => {
      acceptLocalAuthentication(user);
      publishSessionMarker();
    },
  });
};
