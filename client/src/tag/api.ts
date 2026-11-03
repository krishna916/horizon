import { apiClient } from '@/lib/api-client';
import type { TaskTag } from '@/task/types';

export interface TagSuggestionResponse {
  items: TaskTag[];
}

export const tagApi = {
  suggest: (prefix: string) =>
    apiClient.get<TagSuggestionResponse>('/tags/suggestions', { params: { q: prefix } }),
};
