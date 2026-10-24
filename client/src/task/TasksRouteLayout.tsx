/* eslint-disable react-refresh/only-export-components */
import { Outlet } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { TaskDraftNavigationGuard } from './TaskDraftNavigationGuard';
import { TaskLifecycleProvider } from './TaskLifecycleProvider';
import { TaskLifecycleNoticeList } from './TaskLifecycleNoticeList';

interface TasksLayoutState {
  listRatio: number;
  setListRatio: (nextRatio: number) => void;
}

const TasksLayoutContext = createContext<TasksLayoutState | null>(null);

export function TasksRouteLayout() {
  const [listRatio, setListRatio] = useState(60);
  const currentUser = useCurrentUser();
  const sessionVerified =
    currentUser.data !== undefined &&
    !currentUser.isPending &&
    !currentUser.isFetching &&
    !currentUser.isError;
  const lifecycleOwnerKey = currentUser.isError ? 'no-user' : (currentUser.data?.id ?? 'no-user');

  return (
    <TaskDraftNavigationGuard>
      <TaskLifecycleProvider key={lifecycleOwnerKey} userId={currentUser.data?.id}>
        <TasksLayoutContext.Provider value={{ listRatio, setListRatio }}>
          <div className="h-full min-h-0 w-full">
            {sessionVerified && <TaskLifecycleNoticeList />}
            <Outlet />
          </div>
        </TasksLayoutContext.Provider>
      </TaskLifecycleProvider>
    </TaskDraftNavigationGuard>
  );
}

export function useTasksLayout(): TasksLayoutState {
  const layout = useContext(TasksLayoutContext);
  if (!layout) {
    throw new Error('useTasksLayout must be used inside TasksRouteLayout.');
  }
  return layout;
}
