import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem } from './types';
import { ChecklistSection } from './ChecklistSection';

const actions = vi.hoisted(() => ({
  addItem: vi.fn(),
  patchItem: vi.fn(),
  completeItem: vi.fn(),
  reopenItem: vi.fn(),
}));

vi.mock('./useTaskChecklist', () => ({
  useTaskChecklist: () => ({
    ...actions,
    isPending: false,
    isError: false,
  }),
}));

const item: ChecklistItem = {
  id: 4,
  title: 'Call florist',
  dueDate: null,
  completedAt: null,
  position: 0,
};

function renderChecklist(items: ChecklistItem[] = [item]) {
  const onEditSessionChange = vi.fn();
  const props = {
    taskId: 12,
    userId: 1,
    items,
    editBlocked: false,
    onEditSessionChange,
  };
  const view = render(<ChecklistSection {...props} />);
  return {
    ...view,
    onEditSessionChange,
    setItems: (nextItems: ChecklistItem[]) =>
      view.rerender(<ChecklistSection {...props} items={nextItems} />),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.addItem.mockResolvedValue({ ...item, id: 5 });
  actions.patchItem.mockImplementation(async (_id: number, patch: Partial<ChecklistItem>) => ({
    ...item,
    ...patch,
  }));
  actions.completeItem.mockResolvedValue({ ...item, completedAt: '2026-10-23T00:00:00Z' });
  actions.reopenItem.mockResolvedValue(item);
});

describe('ChecklistSection', () => {
  it('adds a trimmed title on Enter without a separate Save action', async () => {
    renderChecklist([]);
    const input = screen.getByRole('textbox', { name: 'Add checklist item' });
    fireEvent.change(input, { target: { value: '  Book a table  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(actions.addItem).toHaveBeenCalledWith('Book a table'));
    expect(screen.queryByRole('button', { name: 'Save checklist item' })).not.toBeInTheDocument();
  });

  it('does not submit a blank quick-add title', () => {
    renderChecklist([]);
    const input = screen.getByRole('textbox', { name: 'Add checklist item' });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(actions.addItem).not.toHaveBeenCalled();
  });

  it('requires explicit Save for a title rename and Cancel discards the draft', async () => {
    const { onEditSessionChange } = renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist item Call florist' }));
    const input = screen.getByRole('textbox', { name: 'Checklist item title' });
    fireEvent.change(input, { target: { value: 'Call the florist' } });
    expect(actions.patchItem).not.toHaveBeenCalled();
    expect(onEditSessionChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel checklist item title' }));
    expect(screen.getByText('Call florist')).toBeInTheDocument();
    expect(actions.patchItem).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist item Call florist' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Checklist item title' }), {
      target: { value: 'Call the florist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save checklist item title' }));
    await waitFor(() =>
      expect(actions.patchItem).toHaveBeenCalledWith(4, { title: 'Call the florist' })
    );
    await waitFor(() => expect(onEditSessionChange).toHaveBeenLastCalledWith(false));
  });

  it('persists a selected date and Clear immediately', async () => {
    const view = renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Set due date for Call florist' }));
    fireEvent.change(screen.getByLabelText('Due date for Call florist'), {
      target: { value: '2026-10-28' },
    });
    await waitFor(() =>
      expect(actions.patchItem).toHaveBeenCalledWith(4, { dueDate: '2026-10-28' })
    );

    view.setItems([{ ...item, dueDate: '2026-10-28' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Set due date for Call florist' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear due date for Call florist' }));
    await waitFor(() => expect(actions.patchItem).toHaveBeenLastCalledWith(4, { dueDate: null }));
  });

  it('toggles completion immediately from its accessible checkbox', async () => {
    renderChecklist();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete checklist item Call florist' }));
    await waitFor(() => expect(actions.completeItem).toHaveBeenCalledWith(4));
  });

  it('keeps a failed mutation recoverable with Retry', async () => {
    actions.addItem.mockRejectedValueOnce(new Error('write failed')).mockResolvedValueOnce(item);
    renderChecklist([]);
    const input = screen.getByRole('textbox', { name: 'Add checklist item' });
    fireEvent.change(input, { target: { value: 'Book a table' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not save checklist changes.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist change' }));
    await waitFor(() => expect(actions.addItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('exposes keyboard-operable item controls with accessible names', () => {
    renderChecklist();
    expect(
      screen.getByRole('checkbox', { name: 'Complete checklist item Call florist' })
    ).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Edit checklist item Call florist' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Set due date for Call florist' })).toBeEnabled();
  });
});
