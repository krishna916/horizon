import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { taskApi } from './api';
import { TaskCompletionProvider } from './TaskCompletionProvider';
import { TaskLifecycleProvider } from './TaskLifecycleProvider';
import type { TaskSummary } from './types';
import { TaskRow } from './TaskRow';
import { TaskSection } from './TaskSection';

vi.mock('./api', () => ({
  taskApi: {
    list: vi.fn(),
    get: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    archive: vi.fn(),
    restoreArchive: vi.fn(),
    softDelete: vi.fn(),
    restoreDeleted: vi.fn(),
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
        <TaskLifecycleProvider userId={1}>
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
        </TaskLifecycleProvider>
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
  vi.mocked(taskApi.archive).mockResolvedValue({
    data: { ...task(), archivedAt: '2026-10-24T12:00:00Z', description: null, deletedAt: null },
  } as never);
  vi.mocked(taskApi.restoreArchive).mockResolvedValue({
    data: { ...task(), description: null, deletedAt: null },
  } as never);
  vi.mocked(taskApi.softDelete).mockResolvedValue({ data: undefined } as never);
  vi.mocked(taskApi.restoreDeleted).mockResolvedValue({
    data: { ...task(), description: null, deletedAt: null },
  } as never);
});

describe('TaskRow', () => {
  it('opens row actions independently from the row opener and completion control', () => {
    const onOpen = vi.fn();
    const onCompletionIntent = vi.fn();
    renderTaskRow({}, { onOpen, onCompletionIntent });

    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-7' }), {
      key: 'Enter',
    });

    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Move to Trash' })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    expect(onCompletionIntent).not.toHaveBeenCalled();
  });

  it('closes the row menu on Escape and restores focus to its trigger', async () => {
    renderTaskRow();
    const trigger = screen.getByRole('button', { name: 'More actions for TASK-7' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('starts Archive from the row menu without a confirmation dialog', async () => {
    renderTaskRow();
    fireEvent.keyDown(screen.getByRole('button', { name: 'More actions for TASK-7' }), {
      key: 'Enter',
    });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => expect(taskApi.archive).toHaveBeenCalledWith(7));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

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
    expect(row.querySelectorAll('button')).toHaveLength(3);
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
    expect(container.querySelector('.lucide-calendar-days')).toBeNull();
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
          <TaskLifecycleProvider userId={1}>
            <TaskSection
              title="Completed"
              tasks={[task({ completedAt: '2026-10-22T01:00:00Z' })]}
              expanded
              onExpandedChange={vi.fn()}
              now={new Date(2026, 9, 18, 12)}
              userId={1}
              onOpen={vi.fn()}
              selectedTaskId={null}
            />
          </TaskLifecycleProvider>
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
    const onExpandedChange = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TaskCompletionProvider>
          <TaskLifecycleProvider userId={1}>
            <TaskSection
              title="Active"
              tasks={[]}
              expanded
              onExpandedChange={onExpandedChange}
              now={new Date(2026, 9, 18)}
              userId={1}
              onOpen={vi.fn()}
              selectedTaskId={null}
            />
          </TaskLifecycleProvider>
        </TaskCompletionProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText('No active tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    const collapseButton = screen.getByRole('button', { name: 'Collapse Active section' });
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapseButton);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('heading', { name: 'Active' })).toBeInTheDocument();
    expect(screen.getByText('No active tasks.')).toBeInTheDocument();
  });
});
