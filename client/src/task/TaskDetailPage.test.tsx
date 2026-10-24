import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

vi.mock('./TaskDetailSurface', () => ({
  TaskDetailSurface: ({
    taskId,
    surface,
    onDeleted,
  }: {
    taskId: number | null;
    surface: string;
    onDeleted?: () => void;
  }) => (
    <>
      <p>{`Task ${taskId ?? 'unavailable'} on ${surface}`}</p>
      {onDeleted && (
        <button type="button" onClick={onDeleted}>
          Simulate deleted task
        </button>
      )}
    </>
  ),
}));

describe('TaskDetailPage', () => {
  it('renders the canonical single-column task page and calls its Back action', () => {
    const onBack = vi.fn();
    render(<TaskDetailPage rawId="7" onBack={onBack} onDeleted={vi.fn()} />);
    expect(screen.getByText('Task 7 on page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Tasks' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('uses a separate callback after a task is deleted', () => {
    const onBack = vi.fn();
    const onDeleted = vi.fn();
    render(<TaskDetailPage rawId="7" onBack={onBack} onDeleted={onDeleted} />);

    fireEvent.click(screen.getByRole('button', { name: 'Simulate deleted task' }));

    expect(onDeleted).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });

  it.each(['TASK-7', '0', '-1', '9007199254740993'])(
    'does not resolve malformed route ID %s to a task request',
    (rawId) => {
      render(<TaskDetailPage rawId={rawId} onBack={vi.fn()} onDeleted={vi.fn()} />);
      expect(screen.getByText('Task unavailable on page')).toBeInTheDocument();
    }
  );
});
