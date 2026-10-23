import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChecklistItem } from './types';
import { ChecklistReorder } from './ChecklistReorder';

const items: ChecklistItem[] = [
  { id: 4, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
  { id: 5, title: 'Book a table', dueDate: null, completedAt: null, position: 1 },
];

function renderReorder(onSave = vi.fn().mockResolvedValue(true)) {
  const onCancel = vi.fn();
  const onSessionChange = vi.fn();
  const view = render(
    <ChecklistReorder
      items={items}
      onSave={onSave}
      onCancel={onCancel}
      onSessionChange={onSessionChange}
      onDraftStateChange={vi.fn()}
    />
  );
  return { ...view, onSave, onCancel, onSessionChange };
}

describe('ChecklistReorder', () => {
  it('changes only the local draft during desktop drag and saves one exact order', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    renderReorder(onSave);
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => '4'), effectAllowed: '' };
    fireEvent.dragStart(
      screen.getByRole('button', { name: 'Reorder checklist item Call florist' }),
      {
        dataTransfer,
      }
    );
    fireEvent.dragOver(screen.getByRole('listitem', { name: /Book a table/ }));
    fireEvent.drop(screen.getByRole('listitem', { name: /Book a table/ }), { dataTransfer });

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('list').textContent).toContain('Book a table');
    fireEvent.click(screen.getByRole('button', { name: 'Save checklist order' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([5, 4]));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('moves an item with keyboard controls, announces the new position, and keeps focus', () => {
    renderReorder();
    const moveUp = screen.getByRole('button', { name: 'Move Book a table up' });
    moveUp.focus();
    fireEvent.click(moveUp);

    expect(screen.getByRole('status')).toHaveTextContent('Moved Book a table to position 1 of 2');
    expect(screen.getByRole('button', { name: 'Move Book a table up' })).toHaveFocus();
    expect(screen.getByRole('list').textContent?.indexOf('Book a table')).toBeLessThan(
      screen.getByRole('list').textContent?.indexOf('Call florist') ?? 0
    );
  });

  it('cancels the temporary order without saving it', () => {
    const { onSave, onCancel } = renderReorder();
    fireEvent.click(screen.getByRole('button', { name: 'Move Book a table up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel checklist order' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps a failed draft order visible for Retry', async () => {
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderReorder(onSave);
    fireEvent.click(screen.getByRole('button', { name: 'Move Book a table up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save checklist order' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save checklist order.');
    expect(screen.getByRole('button', { name: 'Move Book a table up' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry checklist order' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  });
});
