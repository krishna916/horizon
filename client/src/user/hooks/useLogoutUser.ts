import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { userApi } from '../api';

export const useLogoutUser = () => {
  const queryClient = useQueryClient();
  return useMutation<void, AxiosError>({
    mutationFn: async () => {
      await userApi.logout();
    },
    onSuccess: () => {
      // Invalidate current user query and set query data to null
      queryClient.setQueryData(['me'], null);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
};
