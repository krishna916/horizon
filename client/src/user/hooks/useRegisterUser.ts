import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';
import type { RegisterUserRequest, CurrentUserResponse } from '../types';
import { useAuthSession } from '../session/AuthSessionProvider';
import { publishSessionMarker } from '../session/sessionMarker';

/**
 * Hook for registering a new user.
 * Wraps the `userApi.register` call with TanStack Query's `useMutation`.
 * On success it invalidates the cached `me` query (if any) so the UI
 * can refresh the authenticated user information.
 */
export const useRegisterUser = () => {
  const { acceptLocalAuthentication } = useAuthSession();
  return useMutation<CurrentUserResponse, AxiosError<{ title?: string }>, RegisterUserRequest>({
    mutationFn: async (data) => {
      const response = await userApi.register(data);
      return response.data;
    },
    onSuccess: (user) => {
      acceptLocalAuthentication(user);
      publishSessionMarker();
    },
  });
};
