import { useQuery } from '@tanstack/react-query';
import { taskApi } from './api';

export function useTaskList(userId: number | undefined) {
  return useQuery({
    queryKey: ['tasks', userId],
    queryFn: async () => {
      const response = await taskApi.list();
      return response.data;
    },
    enabled: userId !== undefined,
  });
}
