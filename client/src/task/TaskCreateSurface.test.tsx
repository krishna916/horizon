import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskCreateSurface } from './TaskCreateSurface';

const { createTask } = vi.hoisted(() => ({ createTask: vi.fn() }));
vi.mock('./useCreateTask', () => ({ useCreateTask: () => ({ createTask }) }));

describe('TaskCreateSurface', () => {
  it('uses the task panel shell, names the create panel, and exposes X dismissal', () => {
    const onCancel = vi.fn();
    const onDismiss = vi.fn();
    render(
      <TaskCreateSurface
        userId={1}
        onCreated={vi.fn()}
        onDirtyChange={vi.fn()}
        onSubmittingChange={vi.fn()}
        onCancel={onCancel}
        onDismiss={onDismiss}
      />
    );

    expect(screen.getByRole('region', { name: 'Create task' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Create task' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close create task' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('treats checklist-only input as a dirty create-form draft', () => {
    const onDirtyChange = vi.fn();
    render(
      <TaskCreateSurface
        userId={1}
        onCreated={vi.fn()}
        onDirtyChange={onDirtyChange}
        onSubmittingChange={vi.fn()}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add checklist draft item' }));
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    expect(createTask).not.toHaveBeenCalled();
  });
});
