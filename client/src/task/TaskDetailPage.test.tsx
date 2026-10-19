import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

vi.mock('./TaskDetailSurface', () => ({
  TaskDetailSurface: ({ taskId, surface }: { taskId: number | null; surface: string }) => (
    <p>{`Task ${taskId ?? 'unavailable'} on ${surface}`}</p>
  ),
}));

describe('TaskDetailPage', () => {
  it('renders the canonical single-column task page and calls its Back action', () => {
    const onBack = vi.fn();
    render(<TaskDetailPage rawId="7" onBack={onBack} />);
    expect(screen.getByText('Task 7 on page')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Tasks' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it.each(['TASK-7', '0', '-1', '9007199254740993'])(
    'does not resolve malformed route ID %s to a task request',
    (rawId) => {
      render(<TaskDetailPage rawId={rawId} onBack={vi.fn()} />);
      expect(screen.getByText('Task unavailable on page')).toBeInTheDocument();
    }
  );
});
