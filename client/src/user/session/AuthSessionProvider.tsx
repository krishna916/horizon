/* eslint-disable react-refresh/only-export-components */
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { userApi } from '../api';
import type { CurrentUserResponse } from '../types';
import { readSessionMarker, SESSION_MARKER_KEY } from './sessionMarker';

export type AuthSessionPhase = 'verified' | 'verifying' | 'retryable-error' | 'unauthenticated';

interface AuthSessionValue {
  phase: AuthSessionPhase;
  verifiedUserId: number | null;
  ownerRevision: number;
  epoch: number;
  verifySession: () => Promise<void>;
  acceptLocalAuthentication: (user: CurrentUserResponse) => void;
  acceptLocalLogout: () => void;
}

interface AuthSessionState {
  phase: AuthSessionPhase;
  userId: number | null;
  ownerRevision: number;
  epoch: number;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

function isUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('response' in error)) return false;
  const response = error.response;
  return (
    !!response && typeof response === 'object' && 'status' in response && response.status === 401
  );
}

function isPrivateQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'tasks' || queryKey[0] === 'tags';
}

export function AuthSessionProvider({ children }: { readonly children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthSessionState>({
    phase: 'verifying',
    userId: null,
    ownerRevision: 0,
    epoch: 0,
  });
  const stateRef = useRef(state);
  const generationRef = useRef(0);
  const lastMarkerRef = useRef(readSessionMarker());
  const lastVerifiedUserIdRef = useRef<number | null>(null);
  const inFlightRef = useRef<{ generation: number; promise: Promise<void> } | null>(null);

  const updateState = useCallback((next: AuthSessionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const verifySession = useCallback(
    async (cancelCurrentUserQuery = true): Promise<void> => {
      const generation = ++generationRef.current;
      const previous = stateRef.current;
      const epoch = previous.epoch + 1;
      updateState({ ...previous, phase: 'verifying', userId: null, epoch });

      void Promise.all([
        ...(cancelCurrentUserQuery
          ? [queryClient.cancelQueries({ queryKey: ['me'], exact: true })]
          : []),
        queryClient.cancelQueries({ predicate: (query) => isPrivateQuery(query.queryKey) }),
      ]);

      const promise = (async () => {
        try {
          const response = await userApi.getCurrentUser();
          if (generation !== generationRef.current) return;

          const user = response.data;
          const priorOwnerId = lastVerifiedUserIdRef.current;
          const ownerRevision =
            priorOwnerId !== null && priorOwnerId !== user.id
              ? stateRef.current.ownerRevision + 1
              : stateRef.current.ownerRevision;

          queryClient.setQueryData(['me'], user);
          if (priorOwnerId !== null && priorOwnerId !== user.id) {
            queryClient.removeQueries({ predicate: (query) => isPrivateQuery(query.queryKey) });
          }

          lastVerifiedUserIdRef.current = user.id;
          updateState({ phase: 'verified', userId: user.id, ownerRevision, epoch });
        } catch (error) {
          if (generation !== generationRef.current) return;
          if (isUnauthorized(error)) {
            lastVerifiedUserIdRef.current = null;
            queryClient.removeQueries({ queryKey: ['me'], exact: true });
            queryClient.removeQueries({ predicate: (query) => isPrivateQuery(query.queryKey) });
            updateState({
              phase: 'unauthenticated',
              userId: null,
              ownerRevision: stateRef.current.ownerRevision,
              epoch,
            });
          } else {
            updateState({
              phase: 'retryable-error',
              userId: null,
              ownerRevision: stateRef.current.ownerRevision,
              epoch,
            });
          }
        } finally {
          if (inFlightRef.current?.generation === generation) inFlightRef.current = null;
        }
      })();
      inFlightRef.current = { generation, promise };
      return promise;
    },
    [queryClient, updateState]
  );

  const acceptLocalAuthentication = useCallback(
    (user: CurrentUserResponse) => {
      const previous = stateRef.current;
      const priorOwnerId = lastVerifiedUserIdRef.current;
      const changedOwner = priorOwnerId !== null && priorOwnerId !== user.id;
      generationRef.current += 1;
      inFlightRef.current = null;
      if (changedOwner) {
        queryClient.removeQueries({ predicate: (query) => isPrivateQuery(query.queryKey) });
      }
      lastVerifiedUserIdRef.current = user.id;
      inFlightRef.current = null;
      queryClient.setQueryData(['me'], user);
      lastMarkerRef.current = readSessionMarker();
      updateState({
        phase: 'verified',
        userId: user.id,
        ownerRevision: previous.ownerRevision + (changedOwner ? 1 : 0),
        epoch: previous.epoch + 1,
      });
    },
    [queryClient, updateState]
  );

  const acceptLocalLogout = useCallback(() => {
    const previous = stateRef.current;
    generationRef.current += 1;
    lastVerifiedUserIdRef.current = null;
    inFlightRef.current = null;
    queryClient.removeQueries({ queryKey: ['me'], exact: true });
    queryClient.removeQueries({ predicate: (query) => isPrivateQuery(query.queryKey) });
    lastMarkerRef.current = readSessionMarker();
    updateState({
      phase: 'unauthenticated',
      userId: null,
      ownerRevision: previous.ownerRevision + (previous.userId === null ? 0 : 1),
      epoch: previous.epoch + 1,
    });
  }, [queryClient, updateState]);

  useEffect(() => {
    const observeMarker = (marker: string | null) => {
      if (marker === lastMarkerRef.current) return false;
      lastMarkerRef.current = marker;
      void verifySession();
      return true;
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SESSION_MARKER_KEY || event.newValue === null) return;
      observeMarker(event.newValue);
    };
    const handleResume = () => {
      const marker = readSessionMarker();
      if (!observeMarker(marker) && !inFlightRef.current) void verifySession();
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleResume();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleResume);
    document.addEventListener('visibilitychange', handleVisibility);
    void verifySession(false);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleResume);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [verifySession]);

  const value = useMemo<AuthSessionValue>(
    () => ({
      phase: state.phase,
      verifiedUserId: state.phase === 'verified' ? state.userId : null,
      ownerRevision: state.ownerRevision,
      epoch: state.epoch,
      verifySession,
      acceptLocalAuthentication,
      acceptLocalLogout,
    }),
    [state, verifySession, acceptLocalAuthentication, acceptLocalLogout]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);
  if (!value) throw new Error('useAuthSession must be used within AuthSessionProvider.');
  return value;
}

export function useOptionalAuthSession(): AuthSessionValue | null {
  return useContext(AuthSessionContext);
}
