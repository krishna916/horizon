import { apiClient } from '@/lib/api-client';
import type { Tag } from './types';

export interface TagSuggestionResponse {
  items: Tag[];
}

export const tagApi = {
  suggest: (prefix: string) =>
    apiClient.get<TagSuggestionResponse>('/tags/suggestions', { params: { q: prefix } }),
};
