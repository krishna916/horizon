import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useLayoutEffect } from 'react';
import { NoteDetailPage } from '@/note/NoteDetailPage';
import { isTrustedNoteOrigin, parseNoteId } from '@/note/noteNavigation';

export const Route = createFileRoute('/_authenticated/notes/$id')({
  component: NoteDetailRoute,
});

function NoteDetailRoute() {
  useLayoutEffect(() => {
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
  }, []);
  const { id: rawId } = Route.useParams();
  const router = useRouter();
  const navigate = useNavigate({ from: '/notes/$id' });
  const id = parseNoteId(rawId);
  const trustedOrigin = isTrustedNoteOrigin(
    router.state.location.state.horizonNoteNavigation,
    id ?? undefined
  );

  function backToNotes() {
    if (trustedOrigin) {
      router.history.back();
      return;
    }
    void navigate({ to: '/notes', replace: true });
  }

  return <NoteDetailPage rawId={rawId} onBack={backToNotes} />;
}
