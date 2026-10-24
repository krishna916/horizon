import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { taskChecklistApi } from './api';
import type { ChecklistItem, TaskDetail } from './types';

type ChecklistMutationResult = ChecklistItem | ChecklistItem[] | void;

type ChecklistMutation =
  | { kind: 'add'; title: string }
  | { kind: 'patch'; itemId: number; patch: { title: string } | { dueDate: string | null } }
  | { kind: 'complete'; itemId: number }
  | { kind: 'reopen'; itemId: number }
  | { kind: 'reorder'; itemIds: number[] }
  | { kind: 'remove'; itemId: number }
  | { kind: 'restore'; itemId: number };

type MutationContext = ChecklistMutation & {
  ownerId: number;
  taskId: number;
};

export function useTaskChecklist(userId: number, taskId: number) {
  const queryClient = useQueryClient();
  const activeIdentity = useRef({ userId, taskId });

  useEffect(() => {
    activeIdentity.current = { userId, taskId };
    return () => {
      activeIdentity.current = { userId: -1, taskId: -1 };
    };
  }, [userId, taskId]);

  const mutation = useMutation<ChecklistMutationResult, Error, MutationContext>({
    mutationFn: async (variables) => {
      const requestedTaskId = variables.taskId;
      switch (variables.kind) {
        case 'add':
          return (await taskChecklistApi.add(requestedTaskId, variables.title)).data;
        case 'patch':
          return (await taskChecklistApi.patch(requestedTaskId, variables.itemId, variables.patch))
            .data;
        case 'complete':
          return (await taskChecklistApi.complete(requestedTaskId, variables.itemId)).data;
        case 'reopen':
          return (await taskChecklistApi.reopen(requestedTaskId, variables.itemId)).data;
        case 'reorder':
          return (await taskChecklistApi.reorder(requestedTaskId, variables.itemIds)).data;
        case 'remove':
          await taskChecklistApi.remove(requestedTaskId, variables.itemId);
          return;
        case 'restore':
          return (await taskChecklistApi.restore(requestedTaskId, variables.itemId)).data;
      }
    },
    retry: false,
    onSuccess: (result, variables) => {
      if (!isCurrentIdentity(activeIdentity.current, variables)) return;
      const detailKey = ['tasks', variables.ownerId, 'detail', variables.taskId] as const;
      queryClient.setQueryData<TaskDetail>(detailKey, (current) => {
        if (!current) return current;
        let checklist = current.checklist;
        switch (variables.kind) {
          case 'add':
            checklist = [...checklist, result as ChecklistItem];
            break;
          case 'patch':
          case 'complete':
          case 'reopen':
          case 'restore': {
            const updated = result as ChecklistItem;
            checklist = checklist.some((item) => item.id === updated.id)
              ? checklist.map((item) => (item.id === updated.id ? updated : item))
              : [...checklist, updated];
            break;
          }
          case 'reorder':
            checklist = result as ChecklistItem[];
            break;
          case 'remove':
            checklist = checklist.filter((item) => item.id !== variables.itemId);
            break;
        }
        return {
          ...current,
          checklist: [...checklist].sort((left, right) => left.position - right.position),
        };
      });
      void queryClient.invalidateQueries({
        queryKey: detailKey,
        exact: true,
      });
    },
    onError: (_error, variables) => {
      // A write may have reached the server even when its response was lost.
      // Refetch the selected task so the UI does not treat an uncertain result as confirmed.
      if (!isCurrentIdentity(activeIdentity.current, variables)) return;
      void queryClient.invalidateQueries({
        queryKey: ['tasks', variables.ownerId, 'detail', variables.taskId],
        exact: true,
      });
    },
  });

  const execute = (command: ChecklistMutation) =>
    mutation.mutateAsync({ ...command, ownerId: userId, taskId });

  return {
    ...mutation,
    addItem: (title: string): Promise<ChecklistItem> =>
      execute({ kind: 'add', title }) as Promise<ChecklistItem>,
    patchItem: (
      itemId: number,
      patch: { title: string } | { dueDate: string | null }
    ): Promise<ChecklistItem> =>
      execute({ kind: 'patch', itemId, patch }) as Promise<ChecklistItem>,
    completeItem: (itemId: number): Promise<ChecklistItem> =>
      execute({ kind: 'complete', itemId }) as Promise<ChecklistItem>,
    reopenItem: (itemId: number): Promise<ChecklistItem> =>
      execute({ kind: 'reopen', itemId }) as Promise<ChecklistItem>,
    reorderItems: (itemIds: number[]): Promise<ChecklistItem[]> =>
      execute({ kind: 'reorder', itemIds }) as Promise<ChecklistItem[]>,
    removeItem: (itemId: number): Promise<void> =>
      execute({ kind: 'remove', itemId }) as Promise<void>,
    restoreItem: (itemId: number): Promise<ChecklistItem> =>
      execute({ kind: 'restore', itemId }) as Promise<ChecklistItem>,
  };
}

function isCurrentIdentity(
  current: { userId: number; taskId: number },
  requested: { ownerId: number; taskId: number }
): boolean {
  return current.userId === requested.ownerId && current.taskId === requested.taskId;
}
