import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { noteApi } from './api';
import type { NoteCollection, NoteSort } from './types';

export const noteQueryKeys = {
  all: ['notes'] as const,
  list: (userId: number, collection: NoteCollection, sort: NoteSort) =>
    ['notes', userId, 'list', collection, sort] as const,
  detail: (userId: number, id: number) => ['notes', userId, 'detail', id] as const,
};

export function useNoteList(
  userId: number | undefined,
  collection: NoteCollection,
  sort: NoteSort
) {
  return useInfiniteQuery({
    queryKey:
      userId === undefined
        ? [...noteQueryKeys.all, undefined, 'list', collection, sort]
        : noteQueryKeys.list(userId, collection, sort),
    queryFn: ({ pageParam }) => noteApi.list(collection, sort, pageParam, 20),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.data.hasNext ? lastPage.data.page + 1 : undefined),
    enabled: userId !== undefined,
    refetchOnWindowFocus: false,
  });
}

export function useNoteDetail(userId: number | undefined, id: number | null) {
  return useQuery({
    queryKey:
      userId === undefined || id === null
        ? [...noteQueryKeys.all, userId, 'detail', id]
        : noteQueryKeys.detail(userId, id),
    queryFn: () => {
      if (id === null) throw new Error('A valid Note ID is required');
      return noteApi.get(id);
    },
    enabled: userId !== undefined && id !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
