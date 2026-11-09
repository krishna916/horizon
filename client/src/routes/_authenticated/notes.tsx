import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useAuthSession } from '@/user/session/AuthSessionProvider';
import { NotesBrowseProvider } from '@/note/NotesBrowseContext';

export const Route = createFileRoute('/_authenticated/notes')({
  component: NotesRoute,
});

function NotesRoute() {
  const { phase, verifiedUserId } = useAuthSession();
  if (phase !== 'verified' || verifiedUserId == null) return <Outlet />;
  return (
    <NotesBrowseProvider key={verifiedUserId} userId={verifiedUserId}>
      <Outlet />
    </NotesBrowseProvider>
  );
}
