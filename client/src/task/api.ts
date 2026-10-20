import { apiClient } from '@/lib/api-client';
import type { CreateTaskPayload, TaskDetail, TaskListResponse, UpdateTaskPayload } from './types';

export const taskApi = {
  list: () => apiClient.get<TaskListResponse>('/tasks'),
  get: (id: number) => apiClient.get<TaskDetail>(`/tasks/${id}`),
  update: (id: number, patch: UpdateTaskPayload) =>
    apiClient.patch<TaskDetail>(`/tasks/${id}`, patch),
  create: (payload: CreateTaskPayload, requestKey: string) =>
    apiClient.post<TaskDetail>('/tasks', payload, {
      headers: { 'Idempotency-Key': requestKey },
    }),
};
