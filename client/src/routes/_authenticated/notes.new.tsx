import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';
import { NoteNewPlaceholder } from '@/note/NoteNewPlaceholder';
import { isTrustedNoteOrigin } from '@/note/noteNavigation';

export const Route = createFileRoute('/_authenticated/notes/new')({
  component: NoteNewRoute,
});

function NoteNewRoute() {
  useLayoutEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, []);
  const router = useRouter();
  const navigate = useNavigate({ from: '/notes/new' });
  const trustedOrigin = isTrustedNoteOrigin(router.state.location.state.horizonNoteNavigation);

  function backToNotes() {
    if (trustedOrigin) {
      router.history.back();
      return;
    }
    void navigate({ to: '/notes', replace: true });
  }

  return <NoteNewPlaceholder onBack={backToNotes} />;
}
