import type { AxiosResponse } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { noteApi } from './api';
import type { NoteDetail, NoteListResponse, NoteSummary } from './types';

const summary: NoteSummary = {
  id: 7,
  title: null,
  preview: null,
  tags: [],
  version: 1,
  inbox: false,
  archivedAt: null,
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};

const response = <T>(data: T) => ({ data }) as AxiosResponse<T>;

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
    expect('tags' in summary).toBe(true);
    expect('files' in summary).toBe(false);
  });

  it('passes query cancellation signals through to Axios', async () => {
    const signal = new AbortController().signal;
    const getSpy = vi.spyOn(apiClient, 'get').mockResolvedValue(
      response<NoteDetail>({
        ...summary,
        content: null,
      }) as never
    );

    await noteApi.get(7, signal);
    await noteApi.list('active', 'updated_desc', 2, 20, signal);

    expect(getSpy).toHaveBeenNthCalledWith(1, '/notes/7', { signal });
    expect(getSpy).toHaveBeenNthCalledWith(2, '/notes', {
      params: { collection: 'active', sort: 'updated_desc', page: 2, size: 20 },
      signal,
    });
  });

  it('creates a nullable-title note with the required idempotency key', async () => {
    const detail: NoteDetail = { ...summary, content: null };
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue(response(detail) as never);
    const body = { title: null, content: null, tags: [] };

    await expect(
      noteApi.create(body, 'f3d8e47a-7775-45eb-a226-4cc01eacb2f1')
    ).resolves.toMatchObject({
      data: { id: 7, title: null, content: null },
    });
    expect(postSpy).toHaveBeenCalledWith('/notes', body, {
      headers: { 'Idempotency-Key': 'f3d8e47a-7775-45eb-a226-4cc01eacb2f1' },
    });
  });

  it('updates a note with its expected version and nullable title', async () => {
    const detail: NoteDetail = { ...summary, content: null };
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue(response(detail) as never);
    const body = { expectedVersion: 4, title: null, tags: [{ id: 9 }] };

    await expect(noteApi.update(7, body)).resolves.toMatchObject({ data: { id: 7, version: 1 } });
    expect(patchSpy).toHaveBeenCalledWith('/notes/7', body);
  });
});
