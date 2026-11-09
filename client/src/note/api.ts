import { apiClient } from '@/lib/api-client';
import type { NoteCollection, NoteDetail, NoteListResponse, NoteSort } from './types';

export const noteApi = {
  list: (collection: NoteCollection, sort: NoteSort, page: number, size = 20) =>
    apiClient.get<NoteListResponse>('/notes', {
      params: { collection, sort, page, size },
    }),
  get: (id: number) => apiClient.get<NoteDetail>(`/notes/${id}`),
};
