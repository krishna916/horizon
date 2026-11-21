import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { getCurrentOwnerRevision, getCurrentSessionEpoch } from '@/user/session/sessionRuntime';
import { noteApi } from './api';
import { noteQueryKeys } from './queries';
import type {
  NoteDetail,
  NoteLifecycleOperation,
  NoteLifecycleResult,
  NoteLifecycleTarget,
  NoteListResponse,
} from './types';

export interface NoteLifecycleNotice {
  id: string;
  ownerId: number;
  noteId: number;
  operation: NoteLifecycleOperation;
  archivedBefore: boolean;
  version: number | null;
  kind: 'undo' | 'delete-unconfirmed';
  error: string | null;
  pending: boolean;
}

interface LifecycleState {
  pending: boolean;
  error: string | null;
  note?: NoteDetail;
}

interface RetryIntent {
  target: NoteLifecycleTarget;
  operation: NoteLifecycleOperation;
}

interface NoteLifecycleContextValue {
  ownerId: number;
  run: (
    ownerId: number,
    target: NoteLifecycleTarget,
    operation: NoteLifecycleOperation
  ) => Promise<NoteLifecycleResult | null>;
  undo: (noticeId: string) => Promise<boolean>;
  retryDelete: (noticeId: string) => Promise<boolean>;
  dismiss: (noticeId: string) => void;
  notices: readonly NoteLifecycleNotice[];
  stateFor: (
    ownerId: number,
    noteId: number
  ) => {
    pending: boolean;
    error: string | null;
    note: NoteDetail | undefined;
    retry: () => void;
  };
}

const LifecycleContext = createContext<NoteLifecycleContextValue | null>(null);

function operationKey(ownerId: number, noteId: number) {
  return `${ownerId}:${noteId}`;
}

function responseError(operation: NoteLifecycleOperation | 'undo') {
  if (operation === 'undo') return "Couldn't restore this note. Try again.";
  return `Couldn't ${operation === 'delete' ? 'move this note to Trash' : `${operation} this note`}. Try again.`;
}

export function NoteLifecycleProvider({
  ownerId,
  children,
}: {
  ownerId: number;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [notices, setNotices] = useState<NoteLifecycleNotice[]>([]);
  const [states, setStates] = useState<Map<string, LifecycleState>>(() => new Map());
  const noticesRef = useRef(notices);
  const statesRef = useRef(states);
  const pendingRef = useRef(
    new Map<string, { token: symbol; ownerRevision: number; sessionEpoch: number }>()
  );
  const retryIntentsRef = useRef(new Map<string, RetryIntent>());
  const mountedRef = useRef(true);
  const ownerIdRef = useRef(ownerId);

  useLayoutEffect(() => {
    if (ownerIdRef.current !== ownerId) {
      ownerIdRef.current = ownerId;
      noticesRef.current = [];
      statesRef.current = new Map();
      retryIntentsRef.current.clear();
      setNotices([]);
      setStates(new Map());
      return;
    }
    noticesRef.current = notices;
    statesRef.current = states;
    ownerIdRef.current = ownerId;
  }, [notices, ownerId, states]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isCurrent = useCallback(
    (expectedOwner: number, expectedRevision: number, expectedEpoch: number) =>
      mountedRef.current &&
      ownerIdRef.current === expectedOwner &&
      getCurrentOwnerRevision() === expectedRevision &&
      getCurrentSessionEpoch() === expectedEpoch,
    []
  );

  const acquire = useCallback(
    (key: string, expectedOwner: number) => {
      const ownerRevision = getCurrentOwnerRevision();
      const sessionEpoch = getCurrentSessionEpoch();
      if (!isCurrent(expectedOwner, ownerRevision, sessionEpoch)) return null;
      const current = pendingRef.current.get(key);
      if (current?.ownerRevision === ownerRevision && current.sessionEpoch === sessionEpoch)
        return null;
      const token = Symbol(key);
      pendingRef.current.set(key, { token, ownerRevision, sessionEpoch });
      return { token, ownerRevision, sessionEpoch };
    },
    [isCurrent]
  );

  const release = useCallback((key: string, token: symbol) => {
    if (pendingRef.current.get(key)?.token === token) pendingRef.current.delete(key);
  }, []);

  const publishNotices = useCallback(
    (update: (current: NoteLifecycleNotice[]) => NoteLifecycleNotice[]) => {
      const next = update(noticesRef.current);
      noticesRef.current = next;
      setNotices(next);
    },
    []
  );

  const publishState = useCallback((key: string, value: LifecycleState | null) => {
    const next = new Map(statesRef.current);
    if (value) next.set(key, { ...next.get(key), ...value });
    else next.delete(key);
    statesRef.current = next;
    setStates(next);
  }, []);

  const reconcile = useCallback(
    async (
      expectedOwner: number,
      expectedRevision: number,
      expectedEpoch: number,
      note: NoteDetail | null,
      noteId: number
    ) => {
      const listKey = ['notes', expectedOwner, 'list'] as const;
      const detailKey = noteQueryKeys.detail(expectedOwner, noteId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listKey }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      if (!isCurrent(expectedOwner, expectedRevision, expectedEpoch)) return;

      for (const query of queryClient.getQueryCache().findAll({ queryKey: listKey })) {
        queryClient.setQueryData<InfiniteData<AxiosResponse<NoteListResponse>>>(
          query.queryKey,
          (current) => {
            if (!current) return current;
            return {
              ...current,
              pages: current.pages.map((page) => ({
                ...page,
                data: {
                  ...page.data,
                  items: page.data.items.filter((item) => item.id !== noteId),
                },
              })),
            };
          }
        );
      }

      if (note)
        queryClient.setQueryData<AxiosResponse<NoteDetail>>(detailKey, {
          data: note,
        } as AxiosResponse<NoteDetail>);
      else queryClient.removeQueries({ queryKey: detailKey, exact: true });
      void queryClient.invalidateQueries({ queryKey: listKey });
    },
    [isCurrent, queryClient]
  );

  const run = useCallback(
    async (
      requestedOwnerId: number,
      target: NoteLifecycleTarget,
      operation: NoteLifecycleOperation
    ): Promise<NoteLifecycleResult | null> => {
      const key = operationKey(requestedOwnerId, target.id);
      if (requestedOwnerId !== ownerId) return null;
      const lock = acquire(key, requestedOwnerId);
      if (!lock) return null;
      const { token, ownerRevision, sessionEpoch } = lock;
      retryIntentsRef.current.set(key, { target, operation });
      publishState(key, { pending: true, error: null });
      publishNotices((current) => current.filter((notice) => notice.noteId !== target.id));

      try {
        if (operation === 'delete') {
          const response = await noteApi.softDelete(target.id, target.version);
          if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
          const receipt = response.data;
          if (receipt.id !== target.id || !Number.isInteger(receipt.version))
            throw new Error('Invalid Note deletion receipt');
          await reconcile(requestedOwnerId, ownerRevision, sessionEpoch, null, target.id);
          if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
          publishNotices((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              ownerId: requestedOwnerId,
              noteId: target.id,
              operation,
              archivedBefore: target.archivedAt !== null,
              version: receipt.version,
              kind: 'undo',
              error: null,
              pending: false,
            },
          ]);
          retryIntentsRef.current.delete(key);
          return { kind: 'deleted', receipt };
        }

        const response =
          operation === 'archive'
            ? await noteApi.archive(target.id, target.version)
            : await noteApi.restoreArchived(target.id, target.version);
        if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
        await reconcile(requestedOwnerId, ownerRevision, sessionEpoch, null, target.id);
        if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
        queryClient.setQueryData(noteQueryKeys.detail(requestedOwnerId, target.id), response);
        publishState(operationKey(requestedOwnerId, target.id), {
          pending: false,
          error: null,
          note: response.data,
        });
        if (operation === 'archive') {
          publishNotices((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              ownerId: requestedOwnerId,
              noteId: target.id,
              operation,
              archivedBefore: target.archivedAt !== null,
              version: response.data.version,
              kind: 'undo',
              error: null,
              pending: false,
            },
          ]);
        }
        retryIntentsRef.current.delete(key);
        return { kind: 'note', note: response.data };
      } catch {
        if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
        publishState(key, { pending: false, error: responseError(operation) });
        if (operation === 'delete') {
          publishNotices((current) => {
            const existing = current.find((notice) => notice.noteId === target.id);
            if (existing?.kind === 'delete-unconfirmed') {
              return current.map((notice) =>
                notice.id === existing.id
                  ? { ...notice, error: responseError('delete'), pending: false }
                  : notice
              );
            }
            return [
              ...current,
              {
                id: crypto.randomUUID(),
                ownerId: requestedOwnerId,
                noteId: target.id,
                operation,
                archivedBefore: target.archivedAt !== null,
                version: null,
                kind: 'delete-unconfirmed',
                error: responseError('delete'),
                pending: false,
              },
            ];
          });
        }
        return null;
      } finally {
        release(key, token);
        if (isCurrent(requestedOwnerId, ownerRevision, sessionEpoch))
          publishState(key, {
            ...statesRef.current.get(key),
            pending: false,
            error: statesRef.current.get(key)?.error ?? null,
          });
      }
    },
    [acquire, isCurrent, ownerId, publishNotices, publishState, queryClient, reconcile, release]
  );

  const undo = useCallback(
    async (noticeId: string) => {
      const notice = noticesRef.current.find(
        (item) => item.id === noticeId && item.ownerId === ownerId
      );
      if (!notice || notice.kind !== 'undo' || notice.version === null || notice.pending) return false;
      const key = operationKey(ownerId, notice.noteId);
      const lock = acquire(key, ownerId);
      if (!lock) return false;
      const { token, ownerRevision, sessionEpoch } = lock;
      publishNotices((current) =>
        current.map((item) =>
          item.id === noticeId ? { ...item, pending: true, error: null } : item
        )
      );
      try {
        const response =
          notice.operation === 'delete'
            ? await noteApi.restoreDeleted(notice.noteId, notice.version)
            : await noteApi.restoreArchived(notice.noteId, notice.version);
        if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
        await reconcile(ownerId, ownerRevision, sessionEpoch, response.data, notice.noteId);
        if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
        publishState(operationKey(ownerId, notice.noteId), {
          pending: false,
          error: null,
          note: response.data,
        });
        publishNotices((current) => current.filter((item) => item.id !== noticeId));
        return true;
      } catch {
        if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
        publishNotices((current) =>
          current.map((item) =>
            item.id === noticeId ? { ...item, pending: false, error: responseError('undo') } : item
          )
        );
        return false;
      } finally {
        release(key, token);
        if (isCurrent(ownerId, ownerRevision, sessionEpoch))
          publishState(key, { pending: false });
      }
    },
    [acquire, isCurrent, ownerId, publishNotices, publishState, reconcile, release]
  );

  const retryDelete = useCallback(
    async (noticeId: string) => {
      const notice = noticesRef.current.find(
        (item) => item.id === noticeId && item.ownerId === ownerId
      );
      if (!notice || notice.kind !== 'delete-unconfirmed') return false;
      const intent = retryIntentsRef.current.get(operationKey(ownerId, notice.noteId));
      if (!intent || intent.operation !== 'delete') return false;
      const result = await run(ownerId, intent.target, 'delete');
      return result?.kind === 'deleted';
    },
    [ownerId, run]
  );

  const dismiss = useCallback(
    (noticeId: string) => {
      const notice = noticesRef.current.find((item) => item.id === noticeId);
      if (notice?.pending) return;
      publishNotices((current) => current.filter((item) => item.id !== noticeId));
      if (notice) retryIntentsRef.current.delete(operationKey(notice.ownerId, notice.noteId));
    },
    [publishNotices]
  );

  const stateFor = useCallback(
    (requestedOwnerId: number, noteId: number) => {
      const key = operationKey(requestedOwnerId, noteId);
      const state = states.get(key);
      return {
        pending: state?.pending ?? false,
        error: state?.error ?? null,
        note: state?.note,
        retry: () => {
          const intent = retryIntentsRef.current.get(key);
          if (intent) void run(requestedOwnerId, intent.target, intent.operation);
        },
      };
    },
    [run, states]
  );

  return (
    <LifecycleContext.Provider
      value={{ ownerId, run, undo, retryDelete, dismiss, notices, stateFor }}
    >
      {children}
    </LifecycleContext.Provider>
  );
}

export function useNoteLifecycle() {
  const value = useContext(LifecycleContext);
  if (!value) throw new Error('useNoteLifecycle must be used within NoteLifecycleProvider');
  return value;
}
