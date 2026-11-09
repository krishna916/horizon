import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { noteApi } from './api';
import type { NoteDetail, NoteListResponse, NoteSummary } from './types';

const summary: NoteSummary = {
  id: 7,
  title: null,
  preview: null,
  version: 1,
  inbox: false,
  archivedAt: null,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};

const response = <T,>(data: T) => ({ data }) as AxiosResponse<T>;

describe('noteApi', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists 20 active notes in the requested server sort order', async () => {
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(
      response<NoteListResponse>({
        items: [summary],
        page: 0,
        size: 20,
        hasNext: true,
        counts: { active: 21, archived: 2 },
      }) as never
    );

    await expect(noteApi.list('active', 'updated_desc', 0)).resolves.toMatchObject({
      data: { items: [{ id: 7, title: null }], page: 0, hasNext: true },
    });
    expect(getSpy).toHaveBeenCalledWith('/notes', {
      params: { collection: 'active', sort: 'updated_desc', page: 0, size: 20 },
    });
  });

  it('loads one full note by ID and keeps title and content nullable', async () => {
    const detail: NoteDetail = { ...summary, content: null };
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(response(detail) as never);

    await expect(noteApi.get(7)).resolves.toMatchObject({ data: { id: 7, content: null } });
    expect(getSpy).toHaveBeenCalledWith('/notes/7');
    expect('tags' in summary).toBe(false);
    expect('files' in summary).toBe(false);
  });
});
