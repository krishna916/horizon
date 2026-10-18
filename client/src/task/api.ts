import { apiClient } from '@/lib/api-client';
import type { TaskDetail, TaskListResponse } from './types';

export const taskApi = {
  list: () => apiClient.get<TaskListResponse>('/tasks'),
  get: (id: number) => apiClient.get<TaskDetail>(`/tasks/${id}`),
};
