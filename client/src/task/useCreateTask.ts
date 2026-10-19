import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { taskApi } from './api';
import type { CreateTaskPayload, TaskDetail, TaskListResponse, TaskSummary } from './types';

interface CreateTaskVariables {
  payload: CreateTaskPayload;
  requestKey: string;
  ownerId: number;
}

function toSummary(task: TaskDetail): TaskSummary {
  const { description: _description, deletedAt: _deletedAt, ...summary } = task;
  return summary;
}

export function useCreateTask(userId: number) {
  const queryClient = useQueryClient();
  const currentUserId = useRef<number | undefined>(userId);
  useEffect(() => {
    currentUserId.current = userId;
    return () => {
      currentUserId.current = undefined;
    };
  }, [userId]);

  const mutation = useMutation({
    mutationFn: async ({ payload, requestKey }: CreateTaskVariables) => {
      const response = await taskApi.create(payload, requestKey);
      return response.data;
    },
    retry: false,
    onSuccess: async (task, variables) => {
      if (currentUserId.current !== variables.ownerId) {
        return;
      }

      const listKey = ['tasks', variables.ownerId] as const;
      queryClient.setQueryData(['tasks', variables.ownerId, 'detail', task.id], task);
      queryClient.setQueryData<TaskListResponse>(listKey, (current) =>
        current
          ? {
              items: [toSummary(task), ...current.items.filter((item) => item.id !== task.id)],
            }
          : current
      );
      await queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
  });

  return {
    ...mutation,
    createTask: (payload: CreateTaskPayload, requestKey: string): Promise<TaskDetail> =>
      mutation.mutateAsync({ payload, requestKey, ownerId: userId }),
  };
}
