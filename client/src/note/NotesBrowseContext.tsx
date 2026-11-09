import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { readNoteViewPreference, writeNoteViewPreference } from './viewPreference';
import type { NoteCollection, NoteSort, NoteViewMode } from './types';

export interface NotesBrowseState {
  collection: NoteCollection;
  sort: NoteSort;
  view: NoteViewMode;
  scrollTop: number;
}

interface NotesBrowseValue {
  state: NotesBrowseState;
  setCollection: (collection: NoteCollection) => void;
  setSort: (sort: NoteSort) => void;
  setView: (view: NoteViewMode) => void;
  rememberScroll: (scrollTop: number) => void;
}

const NotesBrowseContext = createContext<NotesBrowseValue | null>(null);

export function NotesBrowseProvider({
  userId,
  children,
}: {
  readonly userId: number;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<NotesBrowseState>(() => ({
    collection: 'active',
    sort: 'updated_desc',
    view: readNoteViewPreference(userId),
    scrollTop: 0,
  }));

  const setCollection = useCallback((collection: NoteCollection) => {
    setState((current) => ({ ...current, collection }));
  }, []);
  const setSort = useCallback((sort: NoteSort) => {
    setState((current) => ({ ...current, sort }));
  }, []);
  const setView = useCallback(
    (view: NoteViewMode) => {
      writeNoteViewPreference(userId, view);
      setState((current) => ({ ...current, view }));
    },
    [userId]
  );
  const rememberScroll = useCallback((scrollTop: number) => {
    if (!Number.isFinite(scrollTop)) return;
    setState((current) => ({ ...current, scrollTop: Math.max(0, scrollTop) }));
  }, []);

  const value = useMemo(
    () => ({ state, setCollection, setSort, setView, rememberScroll }),
    [state, setCollection, setSort, setView, rememberScroll]
  );

  return <NotesBrowseContext.Provider value={value}>{children}</NotesBrowseContext.Provider>;
}

export function useNotesBrowse(): NotesBrowseValue {
  const value = useContext(NotesBrowseContext);
  if (!value) throw new Error('useNotesBrowse must be used within NotesBrowseProvider.');
  return value;
}
