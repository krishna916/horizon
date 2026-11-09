import { apiClient } from '@/lib/api-client';
import type { NoteCollection, NoteDetail, NoteListResponse, NoteSort } from './types';

export const noteApi = {
  list: (
    collection: NoteCollection,
    sort: NoteSort,
    page: number,
    size = 20,
    signal?: AbortSignal
  ) =>
    apiClient.get<NoteListResponse>('/notes', {
      params: { collection, sort, page, size },
      ...(signal ? { signal } : {}),
    }),
  get: (id: number, signal?: AbortSignal) =>
    signal
      ? apiClient.get<NoteDetail>(`/notes/${id}`, { signal })
      : apiClient.get<NoteDetail>(`/notes/${id}`),
};
