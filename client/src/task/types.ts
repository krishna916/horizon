import type { Tag as TaskTag, TagSelection as TaskTagSelection } from '@/tag/types';

export type TaskPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type UpdateTaskPayload =
  | { title: string }
  | { priority: TaskPriority | null }
  | { dueDate: string | null }
  | { description: Record<string, unknown> | null }
  | { tags: TaskTagSelection[] };

export type { Tag as TaskTag, TagSelection as TaskTagSelection } from '@/tag/types';

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
  tags: TaskTag[];
}

export interface TaskDetail extends TaskSummary {
  description: Record<string, unknown> | null;
  deletedAt: string | null;
  checklist: ChecklistItem[];
}

export interface ChecklistItem {
  id: number;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
}

export interface TaskListResponse {
  items: TaskSummary[];
}

export interface CreateTaskPayload {
  title: string;
  description?: Record<string, unknown> | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  checklist?: { title: string; dueDate?: string | null }[];
  tags?: TaskTagSelection[];
}
