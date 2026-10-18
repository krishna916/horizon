import { apiClient } from '@/lib/api-client';
import type { TaskListResponse } from './types';

export const taskApi = {
  list: () => apiClient.get<TaskListResponse>('/tasks'),
};
