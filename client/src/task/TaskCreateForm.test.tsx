import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskDetail } from './types';
import { TaskCreateForm } from './TaskCreateForm';

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));
vi.mock('./useCreateTask', () => ({ useCreateTask: () => ({ createTask }) }));

const createdTask: TaskDetail = {
  id: 10,
  key: 'TASK-10',
  title: 'Write a release note',
  priority: null,
  dueDate: null,
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:00Z',
  description: null,
  deletedAt: null,
  checklist: [],
};

function renderForm(props: Partial<React.ComponentProps<typeof TaskCreateForm>> = {}) {
  const onCreated = vi.fn();
  const onDirtyChange = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <TaskCreateForm
      userId={1}
      onCreated={onCreated}
      onDirtyChange={onDirtyChange}
      onSubmittingChange={vi.fn()}
      onCancel={onCancel}
      {...props}
    />
  );
  return { ...view, onCreated, onDirtyChange, onCancel };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  createTask.mockReset();
  createTask.mockResolvedValue(createdTask);
  vi.spyOn(globalThis.crypto, 'randomUUID')
    .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
    .mockReturnValue('22222222-2222-4222-8222-222222222222');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('TaskCreateForm', () => {
  it('submits ordered checklist drafts atomically with the task and omits local IDs', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Plan the reception' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 1 title' }), {
      target: { value: '  Book a table  ' },
    });
    fireEvent.change(screen.getByLabelText('Checklist item 1 due date'), {
      target: { value: '2026-10-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 2 title' }), {
      target: { value: 'Call florist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(
      {
        title: 'Plan the reception',
        checklist: [{ title: 'Book a table', dueDate: '2026-10-28' }, { title: 'Call florist' }],
      },
      '11111111-1111-4111-8111-111111111111'
    );
    expect(JSON.stringify(createTask.mock.calls[0]?.[0])).not.toContain('localId');
  });

  it('never submits a blank checklist draft row', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Plan the reception' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask.mock.calls[0]?.[0]).toEqual({ title: 'Plan the reception' });
  });

  it('shows a form error for a nonblank checklist title longer than 255 characters', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Plan the reception' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 1 title' }), {
      target: { value: 'x'.repeat(256) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Checklist item titles must be 255 characters or fewer.'
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it('marks a checklist-only creation draft dirty for navigation protection', async () => {
    const { onDirtyChange } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));

    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
  });

  it('requires a trimmed title and never submits on blur', async () => {
    renderForm();
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();
    const title = screen.getByRole('textbox', { name: 'Title' });

    fireEvent.change(title, { target: { value: '   ' } });
    fireEvent.blur(title);
    expect(createTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Enter a task title.')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
    expect(globalThis.crypto.randomUUID).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: '  Write a release note  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(createTask).toHaveBeenCalledWith(
      { title: 'Write a release note' },
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('keeps optional description, priority, and local date without adding defaults', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Plan the launch' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description (optional)' }), {
      target: { value: 'First paragraph\nSecond paragraph' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Priority (optional)' }), {
      target: { value: 'HIGH' },
    });
    fireEvent.change(screen.getByLabelText('Due date (optional)'), {
      target: { value: '2026-10-21' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(createTask).toHaveBeenCalledWith(
      {
        title: 'Plan the launch',
        description: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
          ],
        },
        priority: 'HIGH',
        dueDate: '2026-10-21',
      },
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it.each(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)(
    'submits the %s priority using its API value',
    async (priority) => {
      renderForm();
      fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
        target: { value: 'Plan the launch' },
      });
      fireEvent.change(screen.getByRole('combobox', { name: 'Priority (optional)' }), {
        target: { value: priority },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
      expect(createTask.mock.calls[0]?.[0]).toEqual({ title: 'Plan the launch', priority });
    }
  );

  it('rejects titles longer than 255 characters without a request', async () => {
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'x'.repeat(256) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Title must be 255 characters or fewer.')).toBeInTheDocument();
    expect(createTask).not.toHaveBeenCalled();
  });

  it('freezes the submitted payload and key after an ambiguous failure and retries explicitly', async () => {
    createTask.mockRejectedValueOnce(new Error('socket closed')).mockResolvedValueOnce(createdTask);
    const { onCreated } = renderForm();
    const title = screen.getByRole('textbox', { name: 'Title' });
    const description = screen.getByRole('textbox', { name: 'Description (optional)' });
    fireEvent.change(title, { target: { value: 'Write a release note' } });
    fireEvent.change(description, { target: { value: 'Do not lose this draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item 1 title' }), {
      target: { value: 'Keep this row unchanged.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const retry = await screen.findByRole('button', { name: 'Retry creation' });
    expect(title).toBeDisabled();
    expect(description).toBeDisabled();
    fireEvent.click(retry);
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));

    expect(createTask.mock.calls[1]).toEqual(createTask.mock.calls[0]);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('allows correcting a known field error and submits the corrected attempt with a new key', async () => {
    const validationError = Object.assign(new Error('invalid field'), {
      isAxiosError: true,
      response: { status: 400, data: { errors: { title: 'A task with this title is invalid.' } } },
    });
    createTask.mockRejectedValueOnce(validationError).mockResolvedValueOnce(createdTask);
    renderForm();
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Bad title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('A task with this title is invalid.')).toBeInTheDocument();
    expect(title).toHaveValue('Bad title');
    fireEvent.change(title, { target: { value: 'Corrected title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTask.mock.calls[0]?.[1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(createTask.mock.calls[1]?.[1]).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('keeps the session error visible without automatic retry after a 401 response', async () => {
    createTask.mockRejectedValueOnce(
      Object.assign(new Error('unauthorized'), {
        isAxiosError: true,
        response: { status: 401, data: { title: 'Unauthorized' } },
      })
    );
    renderForm();
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'A protected task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized');
    expect(title).toHaveValue('A protected task');
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Retry creation' })).not.toBeInTheDocument();
  });

  it('prevents concurrent submissions while a request is pending', async () => {
    let resolveCreate!: (task: TaskDetail) => void;
    createTask.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)));
    const { onDirtyChange, onCreated } = renderForm();
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Write a release note' } });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    const create = screen.getByRole('button', { name: 'Create' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(create).toBeDisabled();
    await act(async () => {
      resolveCreate(createdTask);
      await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    });
  });

  it('disables Cancel for the pending POST and reports the pending interval', async () => {
    let resolveCreate!: (task: TaskDetail) => void;
    createTask.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)));
    const onSubmittingChange = vi.fn();
    const { onCancel } = renderForm({ onSubmittingChange });
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'A submitted task' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    expect(onSubmittingChange).toHaveBeenLastCalledWith(true);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeDisabled();
    fireEvent.click(cancel);
    expect(onCancel).not.toHaveBeenCalled();

    await act(async () => {
      resolveCreate(createdTask);
      await waitFor(() => expect(onSubmittingChange).toHaveBeenLastCalledWith(false));
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not release the current owner navigation lock when an old owner request settles', async () => {
    let resolveFirst!: (task: TaskDetail) => void;
    let resolveSecond!: (task: TaskDetail) => void;
    createTask
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));
    const onSubmittingChange = vi.fn();
    const renderForUser = (userId: number) => (
      <TaskCreateForm
        key={userId}
        userId={userId}
        onCreated={vi.fn()}
        onDirtyChange={vi.fn()}
        onSubmittingChange={onSubmittingChange}
        onCancel={vi.fn()}
      />
    );
    const view = render(renderForUser(1));

    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'User one task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    view.rerender(renderForUser(2));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'User two task' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(onSubmittingChange.mock.calls).toEqual([[true], [true]]);

    await act(async () => resolveFirst(createdTask));

    expect(onSubmittingChange.mock.calls).toEqual([[true], [true]]);

    await act(async () => resolveSecond(createdTask));
    expect(onSubmittingChange.mock.calls).toEqual([[true], [true], [false]]);
  });

  it('calls Cancel immediately for a dirty form', async () => {
    const { onCancel, onDirtyChange } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'A draft task' },
    });
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('cancels a local checklist draft without calling a child API', () => {
    const { onCancel } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('does not complete a create after the form unmounts during submission', async () => {
    let resolveCreate!: (task: TaskDetail) => void;
    createTask.mockImplementationOnce(() => new Promise((resolve) => (resolveCreate = resolve)));
    const { onCreated, unmount } = renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Write a release note' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      resolveCreate(createdTask);
    });

    expect(onCreated).not.toHaveBeenCalled();
  });
});
