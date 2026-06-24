import { useQuery } from '@tanstack/react-query';
import { userApi } from '../api';
import type { CurrentUserResponse } from '../types';

export const useCurrentUser = () => {
  return useQuery<CurrentUserResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const response = await userApi.getCurrentUser();
      return response.data;
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
};
