import { Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { NotesBrowseProvider } from './NotesBrowseContext';

export function NotesRoute() {
  const { phase, verifiedUserId, ownerRevision } = useAuthSession();
  const [lastVerifiedOwner, setLastVerifiedOwner] = useState<{
    userId: number;
    ownerRevision: number;
  } | null>(null);

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
  if (owner === null) {
    if (phase === 'unauthenticated') return null;
    return <output>Verifying your session…</output>;
  }

  return (
    <NotesBrowseProvider key={`${owner.ownerRevision}:${owner.userId}`} userId={owner.userId}>
      <Outlet />
    </NotesBrowseProvider>
  );
}
