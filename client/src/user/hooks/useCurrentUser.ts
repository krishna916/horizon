import { useQuery } from '@tanstack/react-query';
import { userApi } from '../api';
import type { CurrentUserResponse } from '../types';
import { useOptionalAuthSession } from '../session/AuthSessionProvider';

export const useCurrentUser = () => {
  const authSession = useOptionalAuthSession();
  return useQuery<CurrentUserResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await userApi.getCurrentUser();
      return response.data;
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: authSession === null,
  });
};
