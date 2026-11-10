import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AxiosResponse } from 'axios';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noteApi } from './api';
import type { NoteListResponse } from './types';
import { useNoteList } from './queries';

const page = (
  pageNumber: number,
  hasNext: boolean,
  title: string
): AxiosResponse<NoteListResponse> =>
  ({
    data: {
      items: [
        {
          id: pageNumber + 1,
          title,
          preview: null,
          version: 1,
          inbox: false,
          archivedAt: null,
          createdAt: '2026-11-09T10:00:00Z',
          updatedAt: '2026-11-09T10:00:00Z',
        },
      ],
      page: pageNumber,
      size: 20,
      hasNext,
      counts: { active: 21, archived: 0 },
    },
  }) as AxiosResponse<NoteListResponse>;

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { Wrapper, queryClient };
}

describe('Notes list query', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not request notes until an owner is available', () => {
    const listSpy = vi.spyOn(noteApi, 'list');
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useNoteList(undefined, 'active', 'updated_desc'), {
      wrapper: Wrapper,
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('loads 20-item pages under owner, collection, and sort specific keys', async () => {
    const listSpy = vi
      .spyOn(noteApi, 'list')
      .mockResolvedValueOnce(page(0, true, 'First page'))
      .mockResolvedValueOnce(page(1, false, 'Second page'));
    const { Wrapper, queryClient } = createWrapper();
    const { result } = renderHook(() => useNoteList(1, 'active', 'updated_desc'), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1));
    expect(listSpy).toHaveBeenNthCalledWith(
      1,
      'active',
      'updated_desc',
      0,
      20,
      expect.any(AbortSignal)
    );
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(listSpy).toHaveBeenNthCalledWith(
      2,
      'active',
      'updated_desc',
      1,
      20,
      expect.any(AbortSignal)
    );
    expect(result.current.data?.pages.map(({ data }) => data.items[0]?.title)).toEqual([
      'First page',
      'Second page',
    ]);
    expect(
      queryClient.getQueryCache().find({ queryKey: ['notes', 1, 'list', 'active', 'updated_desc'] })
    ).toBeDefined();
    expect(
      queryClient.getQueryCache().find({ queryKey: ['notes', 2, 'list', 'active', 'updated_desc'] })
    ).toBeUndefined();
  });

  it('keeps inactive Notes pages for the same-owner session', async () => {
    vi.spyOn(noteApi, 'list').mockResolvedValue(page(0, false, 'Cached'));
    const { Wrapper, queryClient } = createWrapper();
    const { unmount } = renderHook(() => useNoteList(1, 'active', 'updated_desc'), {
      wrapper: Wrapper,
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(['notes', 1, 'list', 'active', 'updated_desc'])).toBeDefined()
    );
    unmount();
    const cachedList = queryClient.getQueryCache().find({
      queryKey: ['notes', 1, 'list', 'active', 'updated_desc'],
    });
    expect(cachedList?.options.gcTime).toBe(Infinity);
    const refetchOnMount = (
      cachedList?.options as
        | { refetchOnMount?: (query: { state: { isInvalidated: boolean } }) => boolean }
        | undefined
    )?.refetchOnMount;
    expect(refetchOnMount?.(cachedList!)).toBe(false);
    expect(queryClient.getQueryData(['notes', 1, 'list', 'active', 'updated_desc'])).toBeDefined();
  });

  it('refreshes invalidated cached pages on return without dropping loaded pagination', async () => {
    const listSpy = vi
      .spyOn(noteApi, 'list')
      .mockResolvedValueOnce(page(0, true, 'Old first'))
      .mockResolvedValueOnce(page(1, false, 'Old second'));
    const { Wrapper, queryClient } = createWrapper();
    const renderList = () => renderHook(() => useNoteList(1, 'active', 'title_asc'), { wrapper: Wrapper });
    const firstVisit = renderList();
    await waitFor(() => expect(firstVisit.result.current.data?.pages).toHaveLength(1));
    await act(async () => firstVisit.result.current.fetchNextPage());
    await waitFor(() => expect(firstVisit.result.current.data?.pages).toHaveLength(2));
    firstVisit.unmount();

    await queryClient.invalidateQueries({ queryKey: ['notes', 1, 'list', 'active', 'title_asc'] });
    listSpy
      .mockResolvedValueOnce(page(0, true, 'Fresh first'))
      .mockResolvedValueOnce(page(1, false, 'Fresh second'));
    const returning = renderList();
    expect(returning.result.current.data?.pages).toHaveLength(2);
    await waitFor(() => expect(listSpy).toHaveBeenCalledTimes(4));
    await waitFor(() =>
      expect(returning.result.current.data?.pages.map(({ data }) => data.items[0]?.title)).toEqual([
        'Fresh first',
        'Fresh second',
      ])
    );
    returning.unmount();
  });
});
