import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AxiosResponse } from 'axios';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { getCurrentOwnerRevision, getCurrentSessionEpoch } from '@/user/session/sessionRuntime';
import { noteApi } from './api';
import { NoteSaveCoordinator } from './NoteSaveCoordinator';
import type { NoteSaveSnapshot } from './NoteSaveCoordinator';
import { useNoteDraftRecovery } from './NoteDraftRecoveryProvider';
import type { NoteDraftRecoveryEntry } from './NoteDraftRecoveryProvider';
import type { NoteDraft } from './noteDraft';
import { noteQueryKeys } from './queries';
import type { NoteDetail } from './types';

interface UseNoteAutosaveOptions {
  ownerId: number;
  initialNote: NoteDetail | null;
  initialDraft?: NoteDraft;
  editorRoute: string;
  recovery?: NoteDraftRecoveryEntry | null;
  onCreated: (note: NoteDetail) => void;
}

function requestResponse(note: NoteDetail): AxiosResponse<NoteDetail> {
  return { data: note } as AxiosResponse<NoteDetail>;
}

export function useNoteAutosave({
  ownerId,
  initialNote,
  initialDraft,
  editorRoute,
  recovery,
  onCreated,
}: UseNoteAutosaveOptions) {
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const recoveryContext = useNoteDraftRecovery();
  const sessionRef = useRef(session);
  const ownerRevisionAtMount = useRef(session.ownerRevision);
  const recoveryRef = useRef(recoveryContext);
  const ownerIdRef = useRef(ownerId);
  const editorRouteRef = useRef(editorRoute);
  const onCreatedRef = useRef(onCreated);
  const lifecycleRef = useRef(0);
  const discardedRef = useRef(false);
  const [snapshotState, setSnapshotState] = useState<NoteSaveSnapshot | null>(null);

  const publishSavedNote = useCallback(
    (note: NoteDetail, created: boolean) => {
      const currentSession = sessionRef.current;
      if (
        currentSession.phase !== 'verified' ||
        currentSession.verifiedUserId !== ownerIdRef.current ||
        currentSession.epoch !== getCurrentSessionEpoch() ||
        currentSession.ownerRevision !== getCurrentOwnerRevision()
      ) {
        return;
      }
      queryClient.setQueryData(
        noteQueryKeys.detail(ownerIdRef.current, note.id),
        requestResponse(note)
      );
      void queryClient.invalidateQueries({
        queryKey: ['notes', ownerIdRef.current, 'list'],
      });
      if (created) onCreatedRef.current(note);
    },
    [queryClient]
  );

  const [coordinator] = useState(() => {
    const restored = recovery ?? null;
    const draft = restored?.draft ??
      initialDraft ?? {
        title: initialNote?.title ?? '',
        content: initialNote?.content ?? null,
      };
    return new NoteSaveCoordinator({
      initialDraft: draft,
      initialNote,
      recovery: restored
        ? {
            ...(restored.persistedVersion ? { persistedVersion: restored.persistedVersion } : {}),
            ...(restored.frozenCreateRequest
              ? { frozenCreateRequest: restored.frozenCreateRequest }
              : {}),
          }
        : undefined,
      transport: {
        create: async (body, key) => (await noteApi.create(body, key)).data,
        update: async (id, body) => (await noteApi.update(id, body)).data,
        get: async (id) => (await noteApi.get(id)).data,
      },
      onChange: (next) => {
        if (discardedRef.current) return;
        if (
          sessionRef.current.epoch !== getCurrentSessionEpoch() ||
          sessionRef.current.ownerRevision !== getCurrentOwnerRevision()
        ) {
          return;
        }
        setSnapshotState(next);
        if (next.hasUnsavedChanges) {
          recoveryRef.current.stash(
            ownerIdRef.current,
            editorRouteRef.current,
            next.draft,
            next.persisted ?? undefined,
            next.frozenCreateRequest
          );
        } else if (next.phase === 'saved') {
          recoveryRef.current.discard();
        }
      },
      onCreated: (note) => publishSavedNote(note, true),
      onUpdated: (note) => publishSavedNote(note, false),
    });
  });

  const currentSnapshot = snapshotState ?? coordinator.snapshot();
  const snapshot =
    (session.phase === 'verified' && session.verifiedUserId === ownerId) ||
    (session.ownerRevision === ownerRevisionAtMount.current &&
      (session.phase === 'verifying' || session.phase === 'retryable-error'))
      ? currentSnapshot
      : {
          ...currentSnapshot,
          draft: { title: '', content: null },
          persisted: null,
          phase: 'paused' as const,
          hasUnsavedChanges: false,
        };

  useLayoutEffect(() => {
    sessionRef.current = session;
    recoveryRef.current = recoveryContext;
    ownerIdRef.current = ownerId;
    editorRouteRef.current = editorRoute;
    onCreatedRef.current = onCreated;
  }, [editorRoute, onCreated, ownerId, recoveryContext, session]);

  useEffect(() => {
    if (session.phase === 'verified' && session.verifiedUserId === ownerId) {
      void coordinator.resume();
    } else {
      coordinator.pause();
    }
  }, [coordinator, session.epoch, ownerId, session.phase, session.verifiedUserId]);

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    return () => {
      const current = coordinator.snapshot();
      if (current.hasUnsavedChanges && !discardedRef.current) {
        const saveRecovery = coordinator.recoverySnapshot();
        recoveryRef.current.stash(
          ownerIdRef.current,
          editorRouteRef.current,
          current.draft,
          saveRecovery.persistedVersion,
          saveRecovery.frozenCreateRequest
        );
      }
      // React Strict Mode replays effect cleanup/setup without unmounting the editor.
      queueMicrotask(() => {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        if (lifecycleRef.current === lifecycle) coordinator.dispose();
      });
    };
  }, [coordinator]);

  const edit = useCallback((draft: NoteDraft) => coordinator.edit(draft), [coordinator]);
  const flush = useCallback(() => coordinator.flush(), [coordinator]);
  const retry = useCallback(() => coordinator.retry(), [coordinator]);
  const resolveConflict = useCallback(
    (choice: 'keep-local' | 'load-server') => coordinator.resolveConflict(choice),
    [coordinator]
  );
  const discardDraft = useCallback(() => {
    discardedRef.current = true;
    coordinator.dispose();
    recoveryContext.discard();
  }, [coordinator, recoveryContext]);
  const canLeaveNow = useCallback(() => {
    const latest = coordinator.snapshot();
    return !latest.hasUnsavedChanges && latest.phase !== 'saving';
  }, [coordinator]);

  return {
    snapshot,
    edit,
    flush,
    retry,
    resolveConflict,
    discardDraft,
    canLeave: !snapshot.hasUnsavedChanges && snapshot.phase !== 'saving',
    canLeaveNow,
  };
}
