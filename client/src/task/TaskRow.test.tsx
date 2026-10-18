import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

function renderTaskRow(
  changes: Partial<TaskSummary> = {},
  props: { onOpen?: (taskId: number) => void; selected?: boolean } = {}
) {
  return render(
    <ul>
      <TaskRow
        task={task(changes)}
        now={new Date(2026, 9, 18, 12)}
        completed={false}
        onOpen={props.onOpen ?? vi.fn()}
        selected={props.selected ?? false}
      />
    </ul>
  );
}

describe('TaskRow', () => {
  it('renders title and available metadata in the approved two-line order', () => {
    const { container } = renderTaskRow();
    const row = screen.getByRole('listitem');
    const opener = within(row).getByRole('button', {
      name: 'Open TASK-7: Review the release notes',
    });
    const title = within(opener).getByText('Review the release notes');
    const key = within(opener).getByText('TASK-7');
    const priority = within(opener).getByText('High');
    const dueDate = within(opener).getByText('Oct 24');

    expect(title).toBeInTheDocument();
    expect(key.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      priority.compareDocumentPosition(dueDate) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(row.querySelector('svg')).toBeInTheDocument();
    expect(row.querySelectorAll('button')).toHaveLength(1);
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
    renderTaskRow({ priority });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('omits absent due date and priority metadata', () => {
    const { container } = renderTaskRow({ priority: null, dueDate: null });

    expect(screen.getByText('TASK-7')).toBeInTheDocument();
    expect(screen.queryByText(/Today|Oct|Critical|High|Medium|Low/)).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeNull();
  });

  it.each([
    ['multi-sentence', 'Review the release notes. Confirm API compatibility. Share the summary.'],
    ['unbroken', `task-${'x'.repeat(200)}`],
  ])('wraps the full %s title without truncation', (_case, title) => {
    renderTaskRow({ title });

    const titleElement = screen.getByText(title);
    expect(titleElement).toHaveClass('break-words');
    expect(titleElement).not.toHaveClass(
      'truncate',
      'text-ellipsis',
      'overflow-hidden',
      'whitespace-nowrap'
    );
  });

  it('visually mutes and strikes completed titles but leaves active titles plain', () => {
    const { rerender } = render(
      <ul>
        <TaskRow
          task={task()}
          now={new Date(2026, 9, 18)}
          completed={false}
          onOpen={vi.fn()}
          selected={false}
        />
      </ul>
    );
    expect(screen.getByText('Review the release notes')).not.toHaveClass('line-through');

    rerender(
      <ul>
        <TaskRow
          task={task()}
          now={new Date(2026, 9, 18)}
          completed
          onOpen={vi.fn()}
          selected={false}
        />
      </ul>
    );
    expect(screen.getByText('Review the release notes')).toHaveClass(
      'line-through',
      'text-muted-foreground'
    );
  });

  it('opens from title and key clicks and keeps native keyboard focusability', () => {
    const onOpen = vi.fn();
    renderTaskRow({}, { onOpen });
    const opener = screen.getByRole('button', { name: 'Open TASK-7: Review the release notes' });

    opener.focus();
    expect(opener).toHaveFocus();
    expect(opener.tabIndex).toBe(0);
    within(opener).getByText('Review the release notes').click();
    within(opener).getByText('TASK-7').click();
    expect(onOpen).toHaveBeenNthCalledWith(1, 7);
    expect(onOpen).toHaveBeenNthCalledWith(2, 7);
  });

  it('marks the selected task and provides a visible focus indicator', () => {
    renderTaskRow({}, { selected: true });
    const opener = screen.getByRole('button', { name: 'Open TASK-7: Review the release notes' });

    expect(opener).toHaveAttribute('aria-pressed', 'true');
    expect(opener).toHaveClass('focus-visible:ring-2');
  });
});

describe('TaskSection', () => {
  it('renders a text heading and count with a task-opening control', () => {
    render(
      <TaskSection
        title="Completed"
        tasks={[task()]}
        now={new Date(2026, 9, 18, 12)}
        onOpen={vi.fn()}
        selectedTaskId={null}
      />
    );

    const heading = screen.getByRole('heading', { name: 'Completed' });
    expect(heading.parentElement).toHaveTextContent('1');
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open TASK-7: Review the release notes' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('shows the exact empty message for Active without fake rows or controls', () => {
    render(
      <TaskSection
        title="Active"
        tasks={[]}
        now={new Date(2026, 9, 18)}
        onOpen={vi.fn()}
        selectedTaskId={null}
      />
    );

    expect(screen.getByText('No active tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
