import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskOverlay } from './TaskOverlay';

describe('TaskOverlay', () => {
  it('keeps modal focus inside, closes from Escape and restores focus to the opener', async () => {
    const onClose = vi.fn();
    const opener = document.createElement('button');
    opener.textContent = 'Open selected task';
    document.body.append(opener);
    opener.focus();
    const { rerender } = render(
      <>
        <TaskOverlay open onClose={onClose}>
          <p>Details content</p>
        </TaskOverlay>
      </>
    );
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    rerender(
      <TaskOverlay open={false} onClose={onClose}>
        <p>Details content</p>
      </TaskOverlay>
    );
    await waitFor(() => expect(opener).toHaveFocus());
    opener.remove();
  });

  it('closes from the explicit button and backdrop and uses the list heading if the opener disappeared', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <h1 data-task-list-heading tabIndex={-1}>
          All Tasks
        </h1>
        <TaskOverlay open onClose={onClose}>
          <p>Details content</p>
        </TaskOverlay>
      </>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Close task details' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <>
        <h1 data-task-list-heading tabIndex={-1}>
          All Tasks
        </h1>
        <TaskOverlay open={false} onClose={onClose}>
          <p>Details content</p>
        </TaskOverlay>
      </>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'All Tasks' })).toHaveFocus());
  });

  it('closes from the backdrop once', async () => {
    const onClose = vi.fn();
    render(
      <TaskOverlay open onClose={onClose}>
        <p>Details content</p>
      </TaskOverlay>
    );
    fireEvent.pointerDown(await screen.findByTestId('task-overlay-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
