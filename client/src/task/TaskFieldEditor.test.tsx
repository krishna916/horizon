import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskFieldEditor } from './TaskFieldEditor';

function renderField(field: 'title' | 'priority' | 'dueDate' = 'title') {
  const onActivate = vi.fn();
  const onDraftChange = vi.fn();
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(
    <TaskFieldEditor
      field={field}
      value={field === 'title' ? 'First task' : field === 'priority' ? 'HIGH' : '2026-10-21'}
      activeField={null}
      draft=""
      dirty={false}
      pending={false}
      error={null}
      onActivate={onActivate}
      onDraftChange={onDraftChange}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
  return { onActivate, onDraftChange, onSave, onCancel };
}

describe('TaskFieldEditor read controls', () => {
  it('opens on pointer double-click but not a single click', () => {
    const { onActivate } = renderField();
    const readControl = screen.getByRole('button', { name: 'Task title: First task' });

    fireEvent.click(readControl);
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.doubleClick(readControl);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('title');
  });

  it.each(['Enter', ' '])('opens from the focused read control with %s', (key) => {
    const { onActivate } = renderField('priority');
    const readControl = screen.getByRole('button', { name: 'Priority: High' });
    readControl.focus();

    fireEvent.keyDown(readControl, { key });

    expect(onActivate).toHaveBeenCalledWith('priority');
  });

  it('renders an accessible input and explicit Save and Cancel controls for the active field', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <TaskFieldEditor
        field="dueDate"
        value={null}
        activeField="dueDate"
        draft=""
        dirty={false}
        pending={false}
        error={null}
        onActivate={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onCancel={onCancel}
      />
    );

    expect(screen.getByLabelText('Due date')).toHaveAttribute('type', 'date');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not save the active field when its input blurs', () => {
    const onSave = vi.fn();
    render(
      <TaskFieldEditor
        field="title"
        value="First task"
        activeField="title"
        draft="A new title"
        dirty
        pending={false}
        error={null}
        onActivate={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    fireEvent.blur(screen.getByLabelText('Title'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveValue('A new title');
  });

  it('shows a discoverable edit target for an unset optional field', () => {
    render(
      <TaskFieldEditor
        field="priority"
        value={null}
        activeField={null}
        draft=""
        dirty={false}
        pending={false}
        error={null}
        onActivate={vi.fn()}
        onDraftChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Priority: No priority' })).toBeVisible();
  });
});
