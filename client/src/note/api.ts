import { apiClient } from '@/lib/api-client';
import type {
  CreateNoteRequest,
  NoteCollection,
  NoteDetail,
  NoteListResponse,
  NoteDeletionReceipt,
  NoteSort,
  UpdateNoteRequest,
} from './types';

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
  create: (body: CreateNoteRequest, idempotencyKey: string) =>
    apiClient.post<NoteDetail>('/notes', body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  update: (id: number, body: UpdateNoteRequest) =>
    apiClient.patch<NoteDetail>(`/notes/${id}`, body),
  archive: (id: number, version: number) =>
    apiClient.post<NoteDetail>(`/notes/${id}/archive`, undefined, {
      headers: { 'X-Expected-Version': String(version) },
    }),
  restoreArchived: (id: number, version: number) =>
    apiClient.post<NoteDetail>(`/notes/${id}/restore`, undefined, {
      headers: { 'X-Expected-Version': String(version) },
    }),
  softDelete: (id: number, version: number) =>
    apiClient.delete<NoteDeletionReceipt>(`/notes/${id}`, {
      headers: { 'X-Expected-Version': String(version) },
    }),
  restoreDeleted: (id: number, version: number) =>
    apiClient.post<NoteDetail>(`/notes/${id}/restore-deleted`, undefined, {
      headers: { 'X-Expected-Version': String(version) },
    }),
};
