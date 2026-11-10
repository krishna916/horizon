import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { NotesBrowseProvider } from './NotesBrowseContext';
import { NoteEditorPage } from './NoteEditorPage';
import { isTrustedNoteOrigin, parseNoteId } from './noteNavigation';
import type { NoteDetail } from './types';

function getEditorIdentity(
  routeNoteId: string | null,
  routeId: number | null,
  locationKey: string,
  promotedCreatedNote: { id: number; sourceIdentity: string } | null
) {
  if (routeNoteId === null) return `new:${locationKey}`;
  if (routeId !== null && routeId === promotedCreatedNote?.id) {
    return promotedCreatedNote.sourceIdentity;
  }
  return `note:${routeNoteId}`;
}

function getEditorRouteNoteId(pathname: string) {
  return pathname === '/notes/new' ? null : pathname.slice('/notes/'.length);
}

function isNoteEditorPath(pathname: string) {
  return pathname === '/notes/new' || pathname.startsWith('/notes/');
}

function resolveOwner(
  phase: ReturnType<typeof useAuthSession>['phase'],
  verifiedUserId: number | null,
  ownerRevision: number,
  lastVerifiedOwner: { userId: number; ownerRevision: number } | null
) {
  if (phase === 'verified' && verifiedUserId !== null) {
    return { userId: verifiedUserId, ownerRevision };
  }
  return phase === 'unauthenticated' ? null : lastVerifiedOwner;
}

export function NotesRoute() {
  const { phase, verifiedUserId, ownerRevision } = useAuthSession();
  const [lastVerifiedOwner, setLastVerifiedOwner] = useState<{
    userId: number;
    ownerRevision: number;
  } | null>(null);
  const [promotedCreatedNote, setPromotedCreatedNote] = useState<{
    id: number;
    sourceIdentity: string;
  } | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const navigate = useNavigate({ from: '/notes' });
  const priorEditorRoute = useRef<{ pathname: string; identity: string } | null>(null);
  const [newDraftEntry, setNewDraftEntry] = useState(() => ({
    isActive: pathname === '/notes/new',
    sequence: pathname === '/notes/new' ? 1 : 0,
  }));

  if (pathname === '/notes/new' && !newDraftEntry.isActive) {
    setNewDraftEntry({ isActive: true, sequence: newDraftEntry.sequence + 1 });
  } else if (pathname !== '/notes/new' && newDraftEntry.isActive) {
    setNewDraftEntry({ ...newDraftEntry, isActive: false });
  }

  if (
    phase === 'verified' &&
    verifiedUserId !== null &&
    (lastVerifiedOwner?.userId !== verifiedUserId ||
      lastVerifiedOwner.ownerRevision !== ownerRevision)
  ) {
    setLastVerifiedOwner({ userId: verifiedUserId, ownerRevision });
  } else if (phase === 'unauthenticated' && lastVerifiedOwner !== null) {
    setLastVerifiedOwner(null);
  }

  const owner = resolveOwner(phase, verifiedUserId, ownerRevision, lastVerifiedOwner);

  const routeNoteId = getEditorRouteNoteId(pathname);
  const routeId = routeNoteId === null ? null : parseNoteId(routeNoteId);
  const editorIdentity = getEditorIdentity(
    routeNoteId,
    routeId,
    String(newDraftEntry.sequence),
    promotedCreatedNote
  );
  const trustedNewOrigin =
    routeNoteId === null && isTrustedNoteOrigin(router.state.location.state.horizonNoteNavigation);

  useLayoutEffect(() => {
    const isEditorRoute = isNoteEditorPath(pathname);
    const previous = priorEditorRoute.current;
    if (isEditorRoute && (!previous || previous.identity !== editorIdentity)) {
      const main = document.querySelector<HTMLElement>('main');
      if (main) main.scrollTop = 0;
    }
    priorEditorRoute.current = isEditorRoute ? { pathname, identity: editorIdentity } : null;
  }, [editorIdentity, pathname]);

  if (owner === null) {
    if (phase === 'unauthenticated') return null;
    return <output>Verifying your session…</output>;
  }

  return (
    <NotesBrowseProvider key={`${owner.ownerRevision}:${owner.userId}`} userId={owner.userId}>
      {isNoteEditorPath(pathname) ? (
        <NoteEditorPage
          routeNoteId={routeNoteId}
          ownerId={owner.userId}
          identityKey={editorIdentity}
          onBack={() => {
            const routeNoteId = getEditorRouteNoteId(pathname);
            const noteId = routeNoteId === null ? undefined : parseNoteId(routeNoteId);
            const trustedOrigin =
              routeNoteId === null
                ? isTrustedNoteOrigin(router.state.location.state.horizonNoteNavigation)
                : noteId !== null &&
                  isTrustedNoteOrigin(router.state.location.state.horizonNoteNavigation, noteId);
            if (trustedOrigin) {
              router.history.back();
            } else {
              void navigate({ to: '/notes', replace: true });
            }
          }}
          onCreated={(note: NoteDetail) => {
            setPromotedCreatedNote({ id: note.id, sourceIdentity: editorIdentity });
            void navigate({
              to: '/notes/$id',
              params: { id: String(note.id) },
              replace: true,
              state: {
                horizonNoteNavigation: trustedNewOrigin
                  ? { kind: 'from-workspace', noteId: note.id }
                  : undefined,
              },
            });
          }}
        />
      ) : (
        <Outlet />
      )}
    </NotesBrowseProvider>
  );
}
