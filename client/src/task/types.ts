export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface TaskSummary {
  id: number;
  key: string;
  title: string;
  priority: TaskPriority | null;
  dueDate: string | null;
  inbox: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDetail extends TaskSummary {
  description: Record<string, unknown> | null;
  deletedAt: string | null;
}

export interface TaskListResponse {
  items: TaskSummary[];
}

export interface CreateTaskPayload {
  title: string;
  description?: Record<string, unknown> | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
}
