import { apiClient } from '@/lib/api-client';
import type {
  ChecklistItem,
  CreateTaskPayload,
  TaskDetail,
  TaskListResponse,
  UpdateTaskPayload,
} from './types';

export const taskApi = {
  list: () => apiClient.get<TaskListResponse>('/tasks'),
  get: (id: number) => apiClient.get<TaskDetail>(`/tasks/${id}`),
  update: (id: number, patch: UpdateTaskPayload) =>
    apiClient.patch<TaskDetail>(`/tasks/${id}`, patch),
  complete: (id: number) => apiClient.post<TaskDetail>(`/tasks/${id}/complete`),
  reopen: (id: number) => apiClient.post<TaskDetail>(`/tasks/${id}/reopen`),
  create: (payload: CreateTaskPayload, requestKey: string) =>
    apiClient.post<TaskDetail>('/tasks', payload, {
      headers: { 'Idempotency-Key': requestKey },
    }),
};

export const taskChecklistApi = {
  add: (taskId: number, title: string) =>
    apiClient.post<ChecklistItem>(`/tasks/${taskId}/checklist-items`, { title }),
  patch: (taskId: number, itemId: number, patch: { title: string } | { dueDate: string | null }) =>
    apiClient.patch<ChecklistItem>(`/tasks/${taskId}/checklist-items/${itemId}`, patch),
  complete: (taskId: number, itemId: number) =>
    apiClient.post<ChecklistItem>(`/tasks/${taskId}/checklist-items/${itemId}/complete`),
  reopen: (taskId: number, itemId: number) =>
    apiClient.post<ChecklistItem>(`/tasks/${taskId}/checklist-items/${itemId}/reopen`),
  reorder: (taskId: number, itemIds: number[]) =>
    apiClient.put<ChecklistItem[]>(`/tasks/${taskId}/checklist-items/order`, { itemIds }),
  remove: (taskId: number, itemId: number) =>
    apiClient.delete<void>(`/tasks/${taskId}/checklist-items/${itemId}`),
  restore: (taskId: number, itemId: number) =>
    apiClient.post<ChecklistItem>(`/tasks/${taskId}/checklist-items/${itemId}/restore`),
};
