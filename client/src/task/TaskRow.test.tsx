import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { TaskSummary } from './types';
import { TaskRow } from './TaskRow';
import { TaskSection } from './TaskSection';

const task = (changes: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 7,
  key: 'TASK-7',
  title: 'Review the release notes',
  priority: 'HIGH',
  dueDate: '2026-10-24',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
  ...changes,
});

describe('TaskRow', () => {
  it('renders title and available metadata in the approved two-line order', () => {
    const { container } = render(
      <ul>
        <TaskRow task={task()} now={new Date(2026, 9, 18, 12)} completed={false} />
      </ul>
    );

    const row = screen.getByRole('listitem');
    const title = within(row).getByText('Review the release notes');
    const key = within(row).getByText('TASK-7');
    const priority = within(row).getByText('High');
    const dueDate = within(row).getByText('Oct 24');

    expect(title).toBeInTheDocument();
    expect(key.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      priority.compareDocumentPosition(dueDate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(row.querySelector('svg')).toBeInTheDocument();
    expect(row.querySelector('button, a, input, [role="button"]')).toBeNull();
    expect(row.textContent).not.toContain('description');
    expect(row.textContent).not.toContain('Engineering');
    expect(row.textContent).not.toContain('file');
  });

  it.each([
    ['CRITICAL', 'Critical'],
    ['HIGH', 'High'],
    ['MEDIUM', 'Medium'],
    ['LOW', 'Low'],
  ] as const)('labels %s priority as %s', (priority, label) => {
    render(
      <ul>
        <TaskRow task={task({ priority })} now={new Date(2026, 9, 18, 12)} completed={false} />
      </ul>
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('omits absent due date and priority metadata', () => {
    const { container } = render(
      <ul>
        <TaskRow
          task={task({ priority: null, dueDate: null })}
          now={new Date(2026, 9, 18, 12)}
          completed={false}
        />
      </ul>
    );

    expect(screen.getByText('TASK-7')).toBeInTheDocument();
    expect(screen.queryByText(/Today|Oct|Critical|High|Medium|Low/)).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('visually mutes and strikes completed titles but leaves active titles plain', () => {
    const { rerender } = render(
      <ul>
        <TaskRow task={task()} now={new Date(2026, 9, 18)} completed={false} />
      </ul>
    );
    const activeTitle = screen.getByText('Review the release notes');
    expect(activeTitle).not.toHaveClass('line-through');

    rerender(
      <ul>
        <TaskRow task={task()} now={new Date(2026, 9, 18)} completed />
      </ul>
    );

    const completedTitle = screen.getByText('Review the release notes');
    expect(completedTitle).toHaveClass('line-through');
    expect(completedTitle).toHaveClass('text-muted-foreground');
  });
});

describe('TaskSection', () => {
  it('renders a text heading and count with inert task rows', () => {
    render(<TaskSection title="Completed" tasks={[task()]} now={new Date(2026, 9, 18, 12)} />);

    const heading = screen.getByRole('heading', { name: 'Completed' });
    expect(heading.parentElement).toHaveTextContent('1');
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the exact empty message for Active and no fake rows or controls', () => {
    render(<TaskSection title="Active" tasks={[]} now={new Date(2026, 9, 18)} />);

    expect(screen.getByText('No active tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
