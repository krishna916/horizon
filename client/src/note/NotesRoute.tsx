import { Outlet, useNavigate, useRouter, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { NotesBrowseProvider } from './NotesBrowseContext';
import { NoteEditorPage } from './NoteEditorPage';
import { isTrustedNoteOrigin, parseNoteId } from './noteNavigation';
import type { NoteDetail } from './types';

export function NotesRoute() {
  const { phase, verifiedUserId, ownerRevision } = useAuthSession();
  const [lastVerifiedOwner, setLastVerifiedOwner] = useState<{
    userId: number;
    ownerRevision: number;
  } | null>(null);
  const [promotedCreatedNoteId, setPromotedCreatedNoteId] = useState<number | null>(null);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const router = useRouter();
  const navigate = useNavigate({ from: '/notes' });

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

  let owner = lastVerifiedOwner;
  if (phase === 'verified' && verifiedUserId !== null) {
    owner = { userId: verifiedUserId, ownerRevision };
  } else if (phase === 'unauthenticated') {
    owner = null;
  }

  const routeNoteId = pathname === '/notes/new' ? null : pathname.slice('/notes/'.length);
  const routeId = routeNoteId === null ? null : parseNoteId(routeNoteId);
  const editorIdentity =
    routeNoteId === null || (routeId !== null && routeId === promotedCreatedNoteId)
      ? 'new'
      : `note:${routeNoteId}`;

  useEffect(() => {
    if (pathname === '/notes/new') return;
    const currentId = pathname.startsWith('/notes/')
      ? parseNoteId(pathname.slice('/notes/'.length))
      : null;
    if (currentId !== promotedCreatedNoteId) setPromotedCreatedNoteId(null);
  }, [pathname, promotedCreatedNoteId]);

  if (owner === null) {
    if (phase === 'unauthenticated') return null;
    return <output>Verifying your session…</output>;
  }

  return (
    <NotesBrowseProvider key={`${owner.ownerRevision}:${owner.userId}`} userId={owner.userId}>
      {pathname === '/notes/new' || pathname.startsWith('/notes/') ? (
        <NoteEditorPage
          routeNoteId={routeNoteId}
          ownerId={owner.userId}
          identityKey={editorIdentity}
          onBack={() => {
            const routeNoteId = pathname === '/notes/new' ? null : pathname.slice('/notes/'.length);
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
            setPromotedCreatedNoteId(note.id);
            void navigate({
              to: '/notes/$id',
              params: { id: String(note.id) },
              replace: true,
              state: { horizonNoteNavigation: { kind: 'from-workspace', noteId: note.id } },
            });
          }}
        />
      ) : (
        <Outlet />
      )}
    </NotesBrowseProvider>
  );
}
