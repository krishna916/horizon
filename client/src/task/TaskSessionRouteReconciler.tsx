import { useLocation, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useOptionalAuthSession } from '@/user/session/AuthSessionProvider';
import { taskApi } from './api';
import { parseTaskSelection } from './taskNavigation';

// SessionOwnedTree remounts route components on owner changes, while the router retains its URL.
const lastOwnerRevisionByRouter = new WeakMap<object, number>();

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
  const response = error.response;
  return response && typeof response === 'object' && 'status' in response
    ? Number(response.status)
    : undefined;
}

function selectedTaskId(pathname: string, searchStr: string): number | null {
  const pageMatch = /^\/tasks\/([^/]+)\/?$/.exec(pathname);
  if (pageMatch) {
    const selection = parseTaskSelection(pageMatch[1]);
    return selection.kind === 'valid' ? selection.id : null;
  }
  if (pathname !== '/tasks' && pathname !== '/tasks/') return null;
  const search = new URLSearchParams(searchStr.replace(/^\?/, ''));
  const selection = parseTaskSelection(search.get('task') ?? undefined);
  return selection.kind === 'valid' ? selection.id : null;
}

export function TasksRouteReconciler(): null {
  const authSession = useOptionalAuthSession();
  const location = useLocation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const ownerRevision = authSession?.ownerRevision ?? 0;
  const phase = authSession?.phase ?? 'verifying';
  const verifiedUserId = authSession?.verifiedUserId ?? null;
  useEffect(() => {
    const previousOwnerRevision = lastOwnerRevisionByRouter.get(router);
    if (previousOwnerRevision === undefined) {
      lastOwnerRevisionByRouter.set(router, ownerRevision);
      return;
    }
    if (ownerRevision === previousOwnerRevision) return;
    lastOwnerRevisionByRouter.set(router, ownerRevision);
    if (phase !== 'verified' || verifiedUserId === null) return;

    const taskId = selectedTaskId(location.pathname, location.searchStr);
    if (taskId === null) return;

    const requestedHref = location.href;
    let active = true;
    void queryClient
      .fetchQuery({
        queryKey: ['tasks', verifiedUserId, 'detail', taskId],
        queryFn: async () => (await taskApi.get(taskId)).data,
        retry: false,
      })
      .catch((error: unknown) => {
        if (
          !active ||
          responseStatus(error) !== 404 ||
          router.state.location.href !== requestedHref
        ) {
          return;
        }
        void router.navigate({
          to: '/tasks',
          search: { task: undefined, create: undefined },
          replace: true,
          state: { horizonTaskNavigation: undefined },
        });
      });

    return () => {
      active = false;
    };
  }, [
    location.href,
    location.pathname,
    location.searchStr,
    ownerRevision,
    phase,
    queryClient,
    router,
    verifiedUserId,
  ]);

  return null;
}
