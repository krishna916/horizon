import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { taskApi } from './api';
import type { TaskDetail, TaskListResponse, TaskSummary, UpdateTaskPayload } from './types';

interface UpdateTaskVariables {
  taskId: number;
  patch: UpdateTaskPayload;
  ownerId: number;
}

function toSummary(task: TaskDetail): TaskSummary {
  const {
    description: _description,
    deletedAt: _deletedAt,
    checklist: _checklist,
    ...summary
  } = task;
  return summary;
}

export function useUpdateTask(userId: number) {
  const queryClient = useQueryClient();
  const currentUserId = useRef<number | undefined>(userId);
  useEffect(() => {
    currentUserId.current = userId;
    return () => {
      currentUserId.current = undefined;
    };
  }, [userId]);

  const mutation = useMutation({
    mutationFn: async ({ taskId, patch }: UpdateTaskVariables) => {
      const response = await taskApi.update(taskId, patch);
      return response.data;
    },
    retry: false,
    onSuccess: (task, variables) => {
      if (currentUserId.current !== variables.ownerId) {
        return;
      }

      const detailKey = ['tasks', variables.ownerId, 'detail', task.id] as const;
      const listKey = ['tasks', variables.ownerId] as const;
      queryClient.setQueryData<TaskDetail>(detailKey, (current) => {
        const updated = { ...task, ...current };
        if ('title' in variables.patch) updated.title = task.title;
        if ('priority' in variables.patch) updated.priority = task.priority;
        if ('dueDate' in variables.patch) updated.dueDate = task.dueDate;
        updated.updatedAt = task.updatedAt;
        return updated;
      });
      queryClient.setQueryData<TaskListResponse>(listKey, (current) =>
        current
          ? {
              items: current.items.map((item) => {
                if (item.id !== task.id) return item;
                const updated = { ...toSummary(task), ...item };
                if ('title' in variables.patch) updated.title = task.title;
                if ('priority' in variables.patch) updated.priority = task.priority;
                if ('dueDate' in variables.patch) updated.dueDate = task.dueDate;
                updated.updatedAt = task.updatedAt;
                return updated;
              }),
            }
          : current
      );
      void queryClient.invalidateQueries({ queryKey: listKey, exact: true });
    },
  });

  return {
    ...mutation,
    updateTask: (taskId: number, patch: UpdateTaskPayload): Promise<TaskDetail> =>
      mutation.mutateAsync({ taskId, patch, ownerId: userId }),
  };
}
