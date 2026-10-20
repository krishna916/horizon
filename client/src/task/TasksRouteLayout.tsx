/* eslint-disable react-refresh/only-export-components */
import { Outlet } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { TaskDraftNavigationGuard } from './TaskDraftNavigationGuard';

interface TasksLayoutState {
  listRatio: number;
  setListRatio: (nextRatio: number) => void;
}

const TasksLayoutContext = createContext<TasksLayoutState | null>(null);

export function TasksRouteLayout() {
  const [listRatio, setListRatio] = useState(60);

  return (
    <TaskDraftNavigationGuard>
      <TasksLayoutContext.Provider value={{ listRatio, setListRatio }}>
        <div className="h-full min-h-0 w-full">
          <Outlet />
        </div>
      </TasksLayoutContext.Provider>
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
