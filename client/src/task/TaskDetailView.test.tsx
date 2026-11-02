import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { tagApi } from '@/tag/api';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import type { TaskDetail } from './types';
import { TaskDetailView } from './TaskDetailView';

vi.mock('@/tag/api', () => ({ tagApi: { suggest: vi.fn() } }));

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
  tags: [],
  description: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Check the release notes.' }] }],
  },
  deletedAt: null,
  checklist: [],
};

const taggedTask: TaskDetail = {
  ...task,
  tags: [
    { id: 1, name: 'Planning' },
    { id: 2, name: 'Writing' },
  ],
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
  it('shows all assigned tags in server order and a clear empty state', () => {
    const { unmount } = render(<TaskDetailView task={taggedTask} userId={1} />, {
      wrapper: createWrapper(),
    });
    expect(screen.getByText('Writing')).toBeInTheDocument();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    unmount();

    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });
    expect(screen.getByText('No tags yet')).toBeInTheDocument();
  });

  it('saves one complete tag selection only after explicit Save', async () => {
    const update = vi.spyOn(taskApi, 'update').mockResolvedValue({
      data: { ...taggedTask, tags: [{ id: 4, name: 'Work' }] },
    } as never);
    vi.mocked(tagApi.suggest).mockResolvedValue({
      data: { items: [{ id: 4, name: 'Work' }] },
    } as never);
    render(<TaskDetailView task={taggedTask} userId={1} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));
    const tagInput = screen.getByRole('combobox', { name: 'Add tags' });
    fireEvent.change(tagInput, { target: { value: 'work' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Work' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(7, { tags: [{ id: 2 }, { id: 4 }] });
  });

  it('discards tag edits without a request and keeps the original tags visible', () => {
    const update = vi.spyOn(taskApi, 'update');
    render(<TaskDetailView task={taggedTask} userId={1} />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tags' }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('Planning')).toBeInTheDocument();
    expect(screen.getByText('Writing')).toBeInTheDocument();
  });

  it('drops an unfinished tag draft when the task or owner changes', async () => {
    const view = render(<TaskDetailView task={taggedTask} userId={1} />, {
      wrapper: createWrapper(),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));

    view.rerender(<TaskDetailView task={{ ...taggedTask, id: 8 }} userId={1} />);
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Add tags' })).not.toBeInTheDocument()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));

    view.rerender(<TaskDetailView task={{ ...taggedTask, id: 8 }} userId={2} />);
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Add tags' })).not.toBeInTheDocument()
    );
    expect(screen.getByText('Planning')).toBeInTheDocument();
  });

  it('retains an invalid tag draft after Save fails and blocks overlapping field editing', async () => {
    const update = vi.spyOn(taskApi, 'update').mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { errors: { tags: 'That tag is unavailable.' } } },
    });
    render(<TaskDetailView task={taggedTask} userId={1} />, { wrapper: createWrapper() });
    fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Planning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save tags' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That tag is unavailable.');
    expect(screen.getByRole('button', { name: 'Save tags' })).toBeEnabled();
    expect(update).toHaveBeenCalledWith(7, { tags: [{ id: 2 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel tags' }));

    fireEvent.doubleClick(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    );
    expect(screen.getByRole('button', { name: 'Edit tags' })).toBeDisabled();
    fireEvent.doubleClick(screen.getByText('Writing'));
    expect(screen.queryByRole('combobox', { name: 'Add tags' })).not.toBeInTheDocument();
  });

  it('keeps unsupported stored descriptions visible and prevents accidental editing', () => {
    const updateSpy = vi.spyOn(taskApi, 'update').mockResolvedValue({ data: task } as never);
    const view = render(
      <TaskDetailView
        task={{
          ...task,
          description: {
            type: 'doc',
            content: [{ type: 'futureWidget', attrs: { label: 'Legacy content' } }],
          },
        }}
        userId={1}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.queryByRole('button', { name: 'Add description…' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/can’t be displayed/i);
    expect(screen.getByText(/preserved/i)).toBeInTheDocument();
    fireEvent.doubleClick(screen.getByRole('status'));
    fireEvent.keyDown(screen.getByRole('status'), { key: 'Enter' });
    expect(screen.queryByLabelText('Task description editor')).not.toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();

    view.unmount();
    updateSpy.mockRestore();
  });

  it('treats a valid whitespace-only description as absent', () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          description: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '  ' }] }],
          },
        }}
        userId={1}
      />,
      { wrapper: createWrapper() }
    );

    expect(screen.getByRole('button', { name: 'Add description…' })).toBeInTheDocument();
  });

  it('does not mark an undone rich-text edit dirty when JSON key order changes', async () => {
    const linkedTask = {
      ...task,
      description: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'Docs',
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      title: null,
                      class: null,
                      rel: null,
                      target: null,
                      href: 'https://example.com',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    const updateSpy = vi.spyOn(taskApi, 'update').mockResolvedValue({ data: linkedTask } as never);
    render(<TaskDetailView task={linkedTask} userId={1} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const editor = await screen.findByLabelText('Task description editor');
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'Changed' : ''),
      },
    });
    fireEvent.keyDown(editor, { key: 'z', ctrlKey: true });

    expect(editor).toHaveTextContent('Docs');
    expect(screen.getByText('No changes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const formattingEditor = await screen.findByLabelText('Task description editor');
    fireEvent.keyDown(formattingEditor, { key: 'a', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.queryByText('No changes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledOnce());
    expect(updateSpy).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        description: expect.objectContaining({
          content: [
            expect.objectContaining({
              content: [
                expect.objectContaining({
                  marks: expect.arrayContaining([expect.objectContaining({ type: 'bold' })]),
                }),
              ],
            }),
          ],
        }),
      })
    );
  });

  it('renders task content, checklist, and optional metadata', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00Z'));
    try {
      render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

      expect(screen.getByRole('heading', { name: 'Review the release notes' })).toBeInTheDocument();
      expect(screen.getByText('Check the release notes.')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText(/Oct 25/)).toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(5);
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(screen.getByRole('heading', { name: 'Checklist' })).toBeInTheDocument();
      expect(screen.queryByText(/attachments|activity/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves descriptions explicitly, blocks concurrent scalar edits, and cancels without PATCH', async () => {
    const updatedDescription = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated release notes.' }] }],
    };
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockResolvedValue({ data: { ...task, description: updatedDescription } } as never);
    const wrapper = createWrapper();
    const view = render(<TaskDetailView task={task} userId={1} />, { wrapper });

    const readView = screen.getByRole('button', { name: 'Edit task description' });
    fireEvent.click(readView);
    const editor = await screen.findByLabelText('Task description editor');
    expect(screen.getByRole('textbox', { name: 'Add checklist item' })).toBeDisabled();
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'Updated release notes.' : ''),
      },
    });
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Priority: High' }));
    expect(screen.queryByLabelText('Priority')).not.toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(7, { description: updatedDescription });
    await waitFor(() => expect(screen.queryByLabelText('Task description editor')).toBeNull());
    view.rerender(
      <TaskDetailView task={{ ...task, description: updatedDescription }} userId={1} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const cancelEditor = await screen.findByLabelText('Task description editor');
    fireEvent.paste(cancelEditor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'Discard this draft.' : ''),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Updated release notes.')).toBeInTheDocument();
    expect(screen.queryByText('Discard this draft.')).not.toBeInTheDocument();
    expect(updateSpy).toHaveBeenCalledTimes(1);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Priority: High' }));
    expect(screen.getByLabelText('Priority')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit task description' })).toBeDisabled();
  });

  it('retains the description draft and offers Save retry after a failed PATCH', async () => {
    const updateSpy = vi
      .spyOn(taskApi, 'update')
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce({ data: task } as never);
    render(<TaskDetailView task={task} userId={1} />, { wrapper: createWrapper() });

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const editor = await screen.findByLabelText('Task description editor');
    fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });
    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'Keep this draft after failure.' : ''),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Your draft is still here');
    expect(screen.getByLabelText('Task description editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledTimes(2));
    expect(updateSpy.mock.calls[0]?.[1]).toEqual({
      description: expect.objectContaining({
        content: [
          expect.objectContaining({
            content: [expect.objectContaining({ text: 'Keep this draft after failure.' })],
          }),
        ],
      }),
    });
  });

  it('keeps descriptions editable for completed and archived tasks', async () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          completedAt: '2026-10-22T10:00:00Z',
          archivedAt: '2026-10-23T10:00:00Z',
        }}
        userId={1}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));

    expect(await screen.findByLabelText('Task description editor')).toBeInTheDocument();
  });

  it('discards an old description draft when task or user identity changes', async () => {
    const wrapper = createWrapper();
    const view = render(<TaskDetailView task={task} userId={1} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Edit task description' }));
    const editor = await screen.findByLabelText('Task description editor');
    fireEvent.paste(editor, {
      clipboardData: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? 'User one private draft.' : ''),
      },
    });

    view.rerender(
      <TaskDetailView task={{ ...task, id: 8, key: 'TASK-8', description: null }} userId={2} />
    );

    expect(await screen.findByRole('button', { name: 'Add description…' })).toBeInTheDocument();
    expect(screen.queryByText('User one private draft.')).not.toBeInTheDocument();
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

  it('blocks parent field editors during a reorder draft but keeps completion available', async () => {
    vi.spyOn(taskApi, 'get').mockResolvedValue({
      data: {
        ...task,
        checklist: [
          { id: 3, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
          { id: 4, title: 'Book a table', dueDate: null, completedAt: null, position: 1 },
        ],
      },
    } as never);
    const completeSpy = vi.spyOn(taskApi, 'complete').mockResolvedValue({
      data: { ...task, completedAt: '2026-10-23T00:00:00Z' },
    } as never);
    render(
      <TaskDetailView
        task={{
          ...task,
          checklist: [
            { id: 3, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
            { id: 4, title: 'Book a table', dueDate: null, completedAt: null, position: 1 },
          ],
        }}
        userId={1}
      />,
      { wrapper: createWrapper() }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reorder checklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Book a table up' }));
    expect(screen.getByRole('button', { name: 'Edit tags' })).toBeDisabled();
    fireEvent.doubleClick(screen.getByText('No tags yet'));
    expect(screen.queryByRole('combobox', { name: 'Add tags' })).not.toBeInTheDocument();
    fireEvent.doubleClick(
      screen.getByRole('button', { name: 'Task title: Review the release notes' })
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-7' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Complete Anyway' }));
    await waitFor(() => expect(completeSpy).toHaveBeenCalledWith(7));
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
    vi.spyOn(taskApi, 'get').mockResolvedValue({ data: task } as never);
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
    await waitFor(() => expect(onCompletionIntent).toHaveBeenCalledWith(7, true));

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
