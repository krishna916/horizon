/* eslint-disable react-refresh/only-export-components */
import { Outlet } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { useCurrentUser } from '@/user/hooks/useCurrentUser';
import { TaskDraftNavigationGuard } from './TaskDraftNavigationGuard';
import { TaskLifecycleProvider } from './TaskLifecycleProvider';
import { TaskLifecycleNoticeList } from './TaskLifecycleNoticeList';
import type { TaskSortMode } from './task-sort';

export interface TaskViewState {
  showCompletedHistory: boolean;
  showArchivedTasks: boolean;
  expanded: Record<'Active' | 'Completed' | 'Archived', boolean>;
  sortMode: TaskSortMode;
}

export const DEFAULT_TASK_VIEW_STATE: TaskViewState = {
  showCompletedHistory: false,
  showArchivedTasks: false,
  expanded: { Active: true, Completed: true, Archived: true },
  sortMode: 'newest',
};

interface TasksLayoutState {
  listRatio: number;
  setListRatio: (nextRatio: number) => void;
  viewState: TaskViewState;
  setViewState: Dispatch<SetStateAction<TaskViewState>>;
}

const TasksLayoutContext = createContext<TasksLayoutState | null>(null);

interface TasksLayoutSessionProps {
  readonly children: ReactNode;
  readonly listRatio: number;
  readonly setListRatio: (nextRatio: number) => void;
}

function TasksLayoutSession({ children, listRatio, setListRatio }: TasksLayoutSessionProps) {
  const [viewState, setViewState] = useState(DEFAULT_TASK_VIEW_STATE);

  return (
    <TasksLayoutContext.Provider value={{ listRatio, setListRatio, viewState, setViewState }}>
      {children}
    </TasksLayoutContext.Provider>
  );
}

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
        <TasksLayoutSession
          key={lifecycleOwnerKey}
          listRatio={listRatio}
          setListRatio={setListRatio}
        >
          <div className="h-full min-h-0 w-full">
            {sessionVerified && <TaskLifecycleNoticeList />}
            <Outlet />
          </div>
        </TasksLayoutSession>
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
