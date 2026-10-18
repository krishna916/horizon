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

export interface TaskListResponse {
  items: TaskSummary[];
}
