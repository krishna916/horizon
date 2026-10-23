import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
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
  checklist: [],
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>{children}</TaskCompletionProvider>
      </QueryClientProvider>
    );
  };
}

describe('TaskDetailView', () => {
  it('renders task content, checklist, and optional metadata', () => {
    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(screen.getByText('Check the release notes.')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(/Oct 25/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
    expect(screen.queryByText(/tags|attachments|activity/i)).not.toBeInTheDocument();
  });

  it('renders checklist item controls inside task detail', () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          checklist: [
            { id: 3, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
          ],
        }}
        userId={1}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByText('Call florist')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Complete checklist item Call florist' })
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Add checklist item' })).toBeInTheDocument();
  });

  it('uses subdued strike-through styling for a completed title', () => {
    render(<TaskDetailView task={{ ...task, completedAt: '2026-10-22T10:00:00Z' }} userId={1} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    ).toHaveClass('text-muted-foreground', 'line-through');
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

  it('keeps title edit typography and heading semantics while editing', () => {
    const { container } = render(<TaskDetailView task={task} userId={1} />, {
      wrapper: createWrapper(),
    });
    const readTitle = screen.getByRole('button', {
      name: 'Task title: Review the release notes',
    });
    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toContainElement(
      readTitle
    );

    fireEvent.doubleClick(readTitle);

    const titleEditor = screen.getByLabelText('Title');
    expect(titleEditor.tagName).toBe('TEXTAREA');
    expect(titleEditor).toHaveClass(
      'w-full',
      'break-words',
      'text-left',
      'text-2xl',
      'font-semibold',
      'leading-tight',
      'text-foreground'
    );
    expect(titleEditor).toHaveClass('border-0', 'bg-transparent', 'p-0', 'resize-none');
    expect(titleEditor).not.toHaveClass('rounded-md', 'px-3', 'py-2', 'bg-background');
    expect(container.querySelector('h1 div')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
    expect(titleEditor).toHaveFocus();
  });

  it('shows completion beside the title and keeps its dirty draft independent', async () => {
    vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: { ...task, completedAt: '2026-10-22T10:00:00Z' },
    } as never);
    const onCompletionIntent = vi.fn();
    render(<TaskDetailView task={task} userId={1} onCompletionIntent={onCompletionIntent} />, {
      wrapper: createWrapper(),
    });

    fireEvent.doubleClick(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Unsaved title draft' } });
    const checkbox = screen.getByRole('checkbox', { name: 'Complete TASK-7' });
    expect(screen.getByRole('heading', { name: 'Review the release notes' })).toContainElement(
      checkbox
    );
    await act(async () => fireEvent.click(checkbox));

    expect(screen.getByLabelText('Title')).toHaveValue('Unsaved title draft');
    expect(onCompletionIntent).toHaveBeenCalledWith(7, true);
  });

  it('keeps another field draft through completion failure and exposes persistent retry', async () => {
    const getSpy = vi.spyOn(taskApi, 'get').mockResolvedValue({ data: task } as never);
    const completeSpy = vi
      .spyOn(taskApi, 'complete')
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        data: { ...task, completedAt: '2026-10-22T10:00:00Z' },
      } as never);
    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Priority: High' }));
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'LOW' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-7' }));

    await waitFor(() => expect(completeSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(7));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save TASK-7.');
    expect(screen.getByLabelText('Priority')).toHaveValue('LOW');
    fireEvent.click(screen.getByRole('button', { name: 'Retry TASK-7 completion save' }));
    await waitFor(() => expect(completeSpy).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Priority')).toHaveValue('LOW');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
