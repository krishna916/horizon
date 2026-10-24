import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import type { TaskSummary } from './types';
import { TaskRow } from './TaskRow';
import { TaskSection } from './TaskSection';

vi.mock('./api', () => ({
  taskApi: {
    list: vi.fn(),
    get: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
}));

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
  props: {
    onOpen?: (taskId: number) => void;
    selected?: boolean;
    onCompletionIntent?: (taskId: number, completed: boolean) => void;
  } = {}
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskCompletionProvider>
        <ul>
          <TaskRow
            task={task(changes)}
            now={new Date(2026, 9, 18, 12)}
            userId={1}
            onCompletionIntent={props.onCompletionIntent}
            onOpen={props.onOpen ?? vi.fn()}
            selected={props.selected ?? false}
          />
        </ul>
      </TaskCompletionProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(taskApi.complete).mockResolvedValue({
    data: { ...task(), completedAt: '2026-10-22T01:00:00Z', description: null, deletedAt: null },
  } as never);
  vi.mocked(taskApi.reopen).mockResolvedValue({
    data: { ...task(), completedAt: null, description: null, deletedAt: null },
  } as never);
});

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
    expect(row.querySelectorAll('button')).toHaveLength(2);
    expect(within(row).getByRole('checkbox', { name: 'Complete TASK-7' })).toBeInTheDocument();
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

  it('visually strikes through a persisted completion in the Active section', () => {
    renderTaskRow({ completedAt: '2026-10-22T01:00:00Z' });
    expect(screen.getByText('Review the release notes')).toHaveClass(
      'line-through',
      'text-muted-foreground'
    );
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-7' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('keeps completion independent from the row opener and reports the latest intent', async () => {
    vi.mocked(taskApi.get).mockResolvedValueOnce({
      data: { ...task(), description: null, deletedAt: null, checklist: [] },
    } as never);
    const onOpen = vi.fn();
    const onCompletionIntent = vi.fn();
    renderTaskRow({}, { onOpen, onCompletionIntent });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-7' }));

    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(onCompletionIntent).toHaveBeenCalledWith(7, true));
    await waitFor(() => expect(taskApi.complete).toHaveBeenCalledWith(7));
    await waitFor(() => expect(screen.queryByText('Saving…')).not.toBeInTheDocument());
  });

  it('keeps the native completion button keyboard-focusable without opening the row', () => {
    const onOpen = vi.fn();
    renderTaskRow({}, { onOpen });
    const checkbox = screen.getByRole('checkbox', { name: 'Complete TASK-7' });
    checkbox.focus();

    expect(checkbox.tagName).toBe('BUTTON');
    expect(checkbox.tabIndex).toBe(0);
    expect(checkbox).toHaveFocus();
    fireEvent.keyDown(checkbox, { key: ' ' });
    fireEvent.keyDown(checkbox, { key: 'Enter' });

    expect(onOpen).not.toHaveBeenCalled();
    expect(checkbox).toHaveFocus();
  });

  it('shows persistent inline retry feedback after a failed save', async () => {
    vi.mocked(taskApi.complete).mockRejectedValueOnce(new Error('offline'));
    vi.mocked(taskApi.get)
      .mockResolvedValueOnce({
        data: { ...task(), description: null, deletedAt: null, checklist: [] },
      } as never)
      .mockRejectedValueOnce(new Error('offline'));
    renderTaskRow();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete TASK-7' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/TASK-7/)).toBeInTheDocument();
    expect(
      within(alert).getByRole('button', { name: 'Retry TASK-7 completion save' })
    ).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'Complete TASK-7' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(screen.getByText(/Could not save TASK-7/)).toBeInTheDocument();
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
  it('renders a text heading, count, and independent completion/open controls', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TaskCompletionProvider>
          <TaskSection
            title="Completed"
            tasks={[task({ completedAt: '2026-10-22T01:00:00Z' })]}
            now={new Date(2026, 9, 18, 12)}
            userId={1}
            onOpen={vi.fn()}
            selectedTaskId={null}
          />
        </TaskCompletionProvider>
      </QueryClientProvider>
    );

    const heading = screen.getByRole('heading', { name: 'Completed' });
    expect(heading.parentElement).toHaveTextContent('1');
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open TASK-7: Review the release notes' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Reopen TASK-7' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('shows the exact empty message for Active without fake rows or controls', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskCompletionProvider>
          <TaskSection
            title="Active"
            tasks={[]}
            now={new Date(2026, 9, 18)}
            userId={1}
            onOpen={vi.fn()}
            selectedTaskId={null}
          />
        </TaskCompletionProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('No active tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
