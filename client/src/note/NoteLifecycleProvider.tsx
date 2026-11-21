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
  canRetry?: boolean;
}

interface LifecycleState {
  pending: boolean;
  error: string | null;
  note?: NoteDetail;
  outcomeUnknown?: boolean;
  retryOperation?: NoteLifecycleOperation;
  retryTarget?: NoteLifecycleTarget;
}

export interface NoteEditorUndoGateway {
  prepare: () => Promise<{ id: number; version: number } | null>;
  complete: (note: NoteDetail | null) => void;
  cancel: () => void;
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
  registerEditor: (noteId: number, gateway: NoteEditorUndoGateway) => () => void;
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
    outcomeUnknown: boolean;
    retryOperation: NoteLifecycleOperation | undefined;
    retryTarget: NoteLifecycleTarget | undefined;
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

type LifecycleErrorKind = 'conflict' | 'unavailable' | 'unknown' | 'other';

function classifyLifecycleError(error: unknown): LifecycleErrorKind {
  if (error instanceof Error && error.message === 'Invalid Note deletion receipt') return 'other';
  const status =
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'status' in error.response
      ? Number(error.response.status)
      : null;
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403 || status === 404) return 'unavailable';
  if (status !== null) return status >= 500 ? 'unknown' : 'other';
  return 'unknown';
}

const conflictError = 'This note changed elsewhere. Review the latest version before trying again.';

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
  const editorGatewaysRef = useRef(
    new Map<
      string,
      { gateway: NoteEditorUndoGateway; ownerRevision: number; sessionEpoch: number }
    >()
  );
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

  const registerEditor = useCallback((noteId: number, gateway: NoteEditorUndoGateway) => {
    const key = operationKey(ownerIdRef.current, noteId);
    const record = {
      gateway,
      ownerRevision: getCurrentOwnerRevision(),
      sessionEpoch: getCurrentSessionEpoch(),
    };
    editorGatewaysRef.current.set(key, record);
    return () => {
      if (editorGatewaysRef.current.get(key) === record) editorGatewaysRef.current.delete(key);
    };
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
      publishState(key, {
        pending: true,
        error: null,
      });
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
          publishState(key, {
            pending: false,
            error: null,
            outcomeUnknown: false,
            retryOperation: undefined,
            retryTarget: undefined,
          });
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
          outcomeUnknown: false,
          retryOperation: undefined,
          retryTarget: undefined,
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
      } catch (error) {
        if (!isCurrent(requestedOwnerId, ownerRevision, sessionEpoch)) return null;
        const errorKind = classifyLifecycleError(error);
        const message = errorKind === 'conflict' ? conflictError : responseError(operation);
        publishState(key, {
          pending: false,
          error: message,
          outcomeUnknown: operation === 'delete' && errorKind === 'unknown',
          retryOperation: errorKind === 'unknown' ? operation : undefined,
          retryTarget: errorKind === 'unknown' ? target : undefined,
        });
        if (errorKind !== 'unknown') retryIntentsRef.current.delete(key);
        if (operation === 'delete' && errorKind === 'unknown') {
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
      if (
        !notice ||
        notice.kind !== 'undo' ||
        notice.version === null ||
        notice.pending ||
        notice.canRetry === false
      )
        return false;
      const key = operationKey(ownerId, notice.noteId);
      const lock = acquire(key, ownerId);
      if (!lock) return false;
      const { token, ownerRevision, sessionEpoch } = lock;
      const registered = editorGatewaysRef.current.get(key);
      const editor =
        registered &&
        registered.ownerRevision === ownerRevision &&
        registered.sessionEpoch === sessionEpoch
          ? registered.gateway
          : null;
      let editorPrepared = false;
      publishState(key, { pending: true, error: null });
      publishNotices((current) =>
        current.map((item) =>
          item.id === noticeId ? { ...item, pending: true, error: null } : item
        )
      );
      try {
        if (editor) {
          const prepared = await editor.prepare();
          if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
          if (!prepared || prepared.id !== notice.noteId || prepared.version !== notice.version) {
            editor.cancel();
            publishNotices((current) =>
              current.map((item) =>
                item.id === noticeId ? { ...item, pending: false, error: conflictError } : item
              )
            );
            return false;
          }
          editorPrepared = true;
        }
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
          outcomeUnknown: false,
          retryOperation: undefined,
          retryTarget: undefined,
        });
        if (editorPrepared) editor?.complete(response.data);
        publishNotices((current) => current.filter((item) => item.id !== noticeId));
        return true;
      } catch (error) {
        if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
        const errorKind = classifyLifecycleError(error);
        if (errorKind === 'conflict' || errorKind === 'unknown') {
          try {
            const response = await noteApi.get(notice.noteId);
            if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
            const verified = notice.operation === 'delete' || response.data.archivedAt === null;
            if (verified) {
              await reconcile(ownerId, ownerRevision, sessionEpoch, response.data, notice.noteId);
              if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
              publishState(key, { pending: false, error: null, note: response.data });
              if (editorPrepared) editor?.complete(response.data);
              publishNotices((current) => current.filter((item) => item.id !== noticeId));
              return true;
            }
            if (editorPrepared) editor?.complete(response.data);
            editorPrepared = false;
          } catch {
            if (!isCurrent(ownerId, ownerRevision, sessionEpoch)) return false;
          }
        }
        const message = errorKind === 'conflict' ? conflictError : responseError('undo');
        publishNotices((current) =>
          current.map((item) =>
            item.id === noticeId
              ? { ...item, pending: false, error: message, canRetry: errorKind !== 'conflict' }
              : item
          )
        );
        publishState(key, { pending: false, error: message });
        if (editorPrepared && errorKind === 'other') editor?.cancel();
        return false;
      } finally {
        if (editorPrepared && !isCurrent(ownerId, ownerRevision, sessionEpoch)) {
          // Keep the coordinator held across session transitions; its own session guard pauses writes.
        }
        release(key, token);
        if (isCurrent(ownerId, ownerRevision, sessionEpoch))
          publishState(key, {
            pending: false,
            error: statesRef.current.get(key)?.error ?? null,
          });
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
      if (result?.kind === 'deleted') {
        const registered = editorGatewaysRef.current.get(operationKey(ownerId, notice.noteId));
        if (
          registered?.ownerRevision === getCurrentOwnerRevision() &&
          registered.sessionEpoch === getCurrentSessionEpoch()
        )
          registered.gateway.complete(null);
      }
      return result?.kind === 'deleted';
    },
    [ownerId, run]
  );

  const dismiss = useCallback(
    (noticeId: string) => {
      const notice = noticesRef.current.find((item) => item.id === noticeId);
      if (!notice) return;
      const key = operationKey(notice.ownerId, notice.noteId);
      const state = statesRef.current.get(key);
      if (notice.pending || state?.pending || pendingRef.current.has(key)) return;
      publishNotices((current) => current.filter((item) => item.id !== noticeId));
      if (notice.kind === 'delete-unconfirmed') {
        const remainingForNote = noticesRef.current.some(
          (item) => item.ownerId === notice.ownerId && item.noteId === notice.noteId
        );
        const intent = retryIntentsRef.current.get(key);
        const editor = editorGatewaysRef.current.get(key);
        const editorIsCurrent =
          editor?.ownerRevision === getCurrentOwnerRevision() &&
          editor.sessionEpoch === getCurrentSessionEpoch();
        if (!remainingForNote && intent?.operation === 'delete' && !editorIsCurrent) {
          retryIntentsRef.current.delete(key);
          publishState(key, null);
        }
      }
    },
    [publishNotices, publishState]
  );

  const stateFor = useCallback(
    (requestedOwnerId: number, noteId: number) => {
      const key = operationKey(requestedOwnerId, noteId);
      const state = statesRef.current.get(key);
      return {
        pending: state?.pending ?? false,
        error: state?.error ?? null,
        note: state?.note,
        outcomeUnknown: state?.outcomeUnknown ?? false,
        retryOperation: state?.retryOperation,
        retryTarget: state?.retryTarget,
        retry: () => {
          const intent = retryIntentsRef.current.get(key);
          if (!intent) return;
          if (intent.operation === 'delete') {
            const notice = noticesRef.current.find(
              (item) =>
                item.ownerId === requestedOwnerId &&
                item.noteId === noteId &&
                item.kind === 'delete-unconfirmed'
            );
            if (notice) {
              void retryDelete(notice.id);
            } else {
              void run(requestedOwnerId, intent.target, 'delete').then((result) => {
                if (result?.kind !== 'deleted') return;
                const editor = editorGatewaysRef.current.get(key);
                if (
                  editor?.ownerRevision === getCurrentOwnerRevision() &&
                  editor.sessionEpoch === getCurrentSessionEpoch()
                )
                  editor.gateway.complete(null);
              });
            }
            return;
          }
          void run(requestedOwnerId, intent.target, intent.operation);
        },
      };
    },
    [retryDelete, run]
  );

  return (
    <LifecycleContext.Provider
      value={{ ownerId, run, undo, registerEditor, retryDelete, dismiss, notices, stateFor }}
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
