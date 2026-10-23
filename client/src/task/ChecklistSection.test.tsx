import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChecklistItem } from './types';
import { ChecklistSection } from './ChecklistSection';

const actions = vi.hoisted(() => ({
  addItem: vi.fn(),
  patchItem: vi.fn(),
  completeItem: vi.fn(),
  reopenItem: vi.fn(),
  removeItem: vi.fn(),
  restoreItem: vi.fn(),
  reorderItems: vi.fn(),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  actions.removeItem.mockResolvedValue(undefined);
  actions.restoreItem.mockResolvedValue(item);
  actions.reorderItems.mockResolvedValue([item]);
});

afterEach(() => vi.useRealTimers());

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

  it('hides a deleted item immediately and shows Undo', async () => {
    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));

    expect(screen.queryByText('Call florist')).not.toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Undo removing Call florist' })
    ).toBeInTheDocument();
    await waitFor(() => expect(actions.removeItem).toHaveBeenCalledWith(4));
  });

  it('restores the same item identity and position when Undo is selected before eight seconds', async () => {
    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
    await waitFor(() => expect(actions.removeItem).toHaveBeenCalledWith(4));
    fireEvent.click(await screen.findByRole('button', { name: 'Undo removing Call florist' }));

    await waitFor(() => expect(actions.restoreItem).toHaveBeenCalledWith(4));
    expect(screen.getByText('Call florist')).toBeInTheDocument();
    expect(actions.addItem).not.toHaveBeenCalled();
  });

  it('expires Undo after exactly eight seconds', async () => {
    vi.useFakeTimers();
    renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
    await act(async () => Promise.resolve());
    expect(screen.getByRole('button', { name: 'Undo removing Call florist' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(7_999));
    expect(screen.getByRole('button', { name: 'Undo removing Call florist' })).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(
      screen.queryByRole('button', { name: 'Undo removing Call florist' })
    ).not.toBeInTheDocument();
  });

  it('cleans the Undo timer and recovery state when the detail unmounts', async () => {
    vi.useFakeTimers();
    const view = renderChecklist();
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
    await act(async () => Promise.resolve());
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(actions.restoreItem).not.toHaveBeenCalled();
  });

  it('keeps removal retryable and keeps failed Undo recoverable', async () => {
    actions.removeItem
      .mockRejectedValueOnce(new Error('delete failed'))
      .mockResolvedValueOnce(undefined);
    actions.restoreItem
      .mockRejectedValueOnce(new Error('restore failed'))
      .mockResolvedValueOnce(item);
    renderChecklist();

    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save checklist changes.');
    expect(screen.getByText('Call florist')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist change' }));
    await waitFor(() => expect(actions.removeItem).toHaveBeenCalledTimes(2));

    fireEvent.click(await screen.findByRole('button', { name: 'Undo removing Call florist' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not undo checklist removal.');
    expect(screen.getByRole('button', { name: 'Undo removing Call florist' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry undo checklist removal' }));
    await waitFor(() => expect(actions.restoreItem).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Call florist')).toBeInTheDocument();
  });

  it('binds Undo to the most recent item when a second item is deleted', async () => {
    const second: ChecklistItem = { ...item, id: 5, title: 'Book a table', position: 1 };
    renderChecklist([item, second]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
    await waitFor(() => expect(actions.removeItem).toHaveBeenCalledWith(4));
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Book a table' }));
    await waitFor(() => expect(actions.removeItem).toHaveBeenCalledWith(5));

    expect(
      await screen.findByRole('button', { name: 'Undo removing Book a table' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo removing Book a table' }));
    await waitFor(() => expect(actions.restoreItem).toHaveBeenCalledWith(5));
    expect(actions.restoreItem).not.toHaveBeenCalledWith(4);
  });

  it('keeps failed Undo retry available after the original eight-second window', async () => {
    vi.useFakeTimers();
    const pendingRestore = deferred<ChecklistItem>();
    const retryRestore = deferred<ChecklistItem>();
    actions.restoreItem
      .mockReturnValueOnce(pendingRestore.promise)
      .mockReturnValueOnce(retryRestore.promise);
    const { unmount } = renderChecklist();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
      await Promise.resolve();
    });
    expect(screen.getByRole('button', { name: 'Undo removing Call florist' })).toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(7_900));
    fireEvent.click(screen.getByRole('button', { name: 'Undo removing Call florist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo removing Call florist' }));
    expect(actions.restoreItem).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    await act(async () => pendingRestore.reject(new Error('restore failed')));

    const retryButton = screen.getByRole('button', { name: 'Retry undo checklist removal' });
    await act(async () => {
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
    });
    expect(actions.restoreItem).toHaveBeenCalledTimes(2);
    expect(actions.restoreItem).toHaveBeenNthCalledWith(1, item.id);
    expect(actions.restoreItem).toHaveBeenNthCalledWith(2, item.id);

    await act(async () => retryRestore.resolve(item));
    expect(screen.queryByText('Removed Call florist')).not.toBeInTheDocument();
    unmount();
  });

  it('expires an unattempted Undo after eight seconds and clears its timer on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = renderChecklist();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => vi.advanceTimersByTimeAsync(8_000));
    expect(screen.queryByText('Removed Call florist')).not.toBeInTheDocument();
    unmount();

    const secondRender = renderChecklist();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Call florist' }));
      await Promise.resolve();
    });
    expect(vi.getTimerCount()).toBe(1);
    secondRender.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('locks all checklist item mutations while a reorder draft is dirty', async () => {
    const second: ChecklistItem = { ...item, id: 5, title: 'Book a table', position: 1 };
    renderChecklist([item, second]);
    fireEvent.click(screen.getByRole('button', { name: 'Reorder checklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Book a table up' }));

    expect(screen.getByRole('button', { name: 'Save checklist order' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Remove checklist item Call florist' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Complete checklist item Call florist' })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Add checklist item' })).not.toBeInTheDocument();
    expect(actions.patchItem).not.toHaveBeenCalled();
    expect(actions.completeItem).not.toHaveBeenCalled();
    expect(actions.removeItem).not.toHaveBeenCalled();
    expect(actions.addItem).not.toHaveBeenCalled();
  });
});
