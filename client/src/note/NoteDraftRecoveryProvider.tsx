/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import type { CreateNoteRequest } from './types';
import type { NoteDraft } from './noteDraft';

export interface NoteDraftRecoveryEntry {
  ownerId: number;
  editorRoute: string;
  draft: NoteDraft;
  persistedVersion?: { id: number; version: number };
  frozenCreateRequest?: { body: CreateNoteRequest; key: string };
}

interface NoteDraftRecoveryValue {
  stash: (
    ownerId: number,
    editorRoute: string,
    draft: NoteDraft,
    persistedVersion?: { id: number; version: number },
    frozenCreateRequest?: { body: CreateNoteRequest; key: string }
  ) => void;
  peekForVerifiedOwner: (ownerId: number) => NoteDraftRecoveryEntry | null;
  consumeForVerifiedOwner: (ownerId: number) => NoteDraftRecoveryEntry | null;
  hasRecoveryForVerifiedOwner: (ownerId: number) => boolean;
  discard: () => void;
}

const NoteDraftRecoveryContext = createContext<NoteDraftRecoveryValue | null>(null);

function copyEntry(entry: NoteDraftRecoveryEntry): NoteDraftRecoveryEntry {
  return {
    ...entry,
    draft: { ...entry.draft },
    ...(entry.persistedVersion ? { persistedVersion: { ...entry.persistedVersion } } : {}),
    ...(entry.frozenCreateRequest
      ? { frozenCreateRequest: { ...entry.frozenCreateRequest, body: { ...entry.frozenCreateRequest.body } } }
      : {}),
  };
}

export function NoteDraftRecoveryProvider({ children }: { readonly children: ReactNode }) {
  const { phase, verifiedUserId, explicitLogoutRevision } = useAuthSession();
  const [entry, setEntry] = useState<NoteDraftRecoveryEntry | null>(null);
  const entryRef = useRef(entry);
  const observedLogoutRevision = useRef(explicitLogoutRevision);

  const discard = useCallback(() => {
    entryRef.current = null;
    setEntry(null);
  }, []);

  const stash = useCallback(
    (
      ownerId: number,
      editorRoute: string,
      draft: NoteDraft,
      persistedVersion?: { id: number; version: number },
      frozenCreateRequest?: { body: CreateNoteRequest; key: string }
    ) => {
      const next: NoteDraftRecoveryEntry = {
        ownerId,
        editorRoute,
        draft: { ...draft },
        ...(persistedVersion ? { persistedVersion: { ...persistedVersion } } : {}),
        ...(frozenCreateRequest
          ? { frozenCreateRequest: { ...frozenCreateRequest, body: { ...frozenCreateRequest.body } } }
          : {}),
      };
      entryRef.current = next;
      setEntry(next);
    },
    []
  );

  const peekForVerifiedOwner = useCallback(
    (ownerId: number) => {
      const current = entryRef.current;
      if (phase !== 'verified' || verifiedUserId !== ownerId || !current) return null;
      if (current.ownerId !== ownerId) {
        discard();
        return null;
      }
      return copyEntry(current);
    },
    [discard, phase, verifiedUserId]
  );

  const consumeForVerifiedOwner = useCallback(
    (ownerId: number) => {
      const current = peekForVerifiedOwner(ownerId);
      if (!current) return null;
      discard();
      return current;
    },
    [discard, peekForVerifiedOwner]
  );

  const hasRecoveryForVerifiedOwner = useCallback(
    (ownerId: number) =>
      entry !== null &&
      entry.ownerId === ownerId &&
      phase === 'verified' &&
      verifiedUserId === ownerId,
    [entry, phase, verifiedUserId]
  );

  useEffect(() => {
    if (observedLogoutRevision.current === explicitLogoutRevision) return;
    observedLogoutRevision.current = explicitLogoutRevision;
    discard();
  }, [discard, explicitLogoutRevision]);

  useEffect(() => {
    if (phase === 'verified' && verifiedUserId !== null && entryRef.current?.ownerId !== verifiedUserId) {
      discard();
    }
  }, [discard, phase, verifiedUserId]);

  const value = {
    stash,
    peekForVerifiedOwner,
    consumeForVerifiedOwner,
    hasRecoveryForVerifiedOwner,
    discard,
  };
  return <NoteDraftRecoveryContext.Provider value={value}>{children}</NoteDraftRecoveryContext.Provider>;
}

export function useNoteDraftRecovery(): NoteDraftRecoveryValue {
  const value = useContext(NoteDraftRecoveryContext);
  if (!value) throw new Error('useNoteDraftRecovery must be used within NoteDraftRecoveryProvider.');
  return value;
}
