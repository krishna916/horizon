import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import type { TaskDetail } from './types';
import { TaskDetailView } from './TaskDetailView';

const task: TaskDetail = {
  id: 7,
  key: 'TASK-7',
  title: 'Review the release notes',
  priority: 'HIGH',
  dueDate: '2026-10-25',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check the release notes.' }] }],
  },
  deletedAt: null,
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('TaskDetailView', () => {
  it('renders supported task content and optional metadata without invented controls or sections', () => {
    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.getByText('Check the release notes.')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/Oct 25/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByText(/checklist|tags|attachments|activity/i)).not.toBeInTheDocument();
  });

  it('omits empty description and absent optional metadata', () => {
    render(
      <TaskDetailView
        userId={1}
        task={{ ...task, description: { type: 'doc', content: [] }, priority: null, dueDate: null }}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priority: No priority' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Due date: Not set' })).toBeInTheDocument();
    expect(screen.queryByText('Check the release notes.')).not.toBeInTheDocument();
  });

  it('renders markup-like description as text, never as HTML', () => {
    render(
      <TaskDetailView
        userId={1}
        task={{
          ...task,
          description: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
            ],
          },
        }}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });

  it('restores the original title when Cancel is selected', () => {
    vi.spyOn(taskApi, 'update');
    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

    fireEvent.doubleClick(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(taskApi.update).not.toHaveBeenCalled();
  });
});
