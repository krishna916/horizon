import { useQuery } from '@tanstack/react-query';
import { taskApi } from './api';

export function useTaskDetail(userId: number | undefined, taskId: number | null) {
  const validUserId = userId !== undefined && Number.isSafeInteger(userId) && userId > 0;
  const validTaskId = taskId !== null && Number.isSafeInteger(taskId) && taskId > 0;

  return useQuery({
    queryKey: ['tasks', userId, 'detail', taskId],
    queryFn: async () => {
      if (taskId === null) {
        throw new Error('A task ID is required to fetch task details.');
      }
      const response = await taskApi.get(taskId);
      return response.data;
    },
    enabled: validUserId && validTaskId,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
