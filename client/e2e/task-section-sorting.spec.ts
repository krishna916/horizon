import { expect, test } from '@playwright/test';
import type { Page, Route } from '@playwright/test';

type Task = {
  id: number;
  key: string;
  title: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | null;
  dueDate: string | null;
  inbox: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  description: null;
  deletedAt: null;
  checklist: [];
};

function task(id: number, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    key: `TASK-${id}`,
    title,
    priority: null,
    dueDate: null,
    inbox: false,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
    description: null,
    deletedAt: null,
    checklist: [],
    ...overrides,
  };
}

async function installTaskApi(page: Page, tasks: Task[]) {
  let listRequests = 0;
  let mutationRequests = 0;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-sorting@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();

    if (path === '/tasks' && method === 'GET') {
      listRequests += 1;
      const items = tasks.map(
        ({ description: _description, deletedAt: _deletedAt, checklist: _checklist, ...summary }) =>
          summary
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    const match = path.match(/^\/tasks\/(\d+)$/);
    if (match && method === 'GET') {
      const item = tasks.find(({ id }) => id === Number(match[1]));
      await route.fulfill({
        status: item ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(item ?? {}),
      });
      return;
    }

    if (method !== 'GET') mutationRequests += 1;
    await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
  });

  return { getListRequests: () => listRequests, getMutationRequests: () => mutationRequests };
}

async function expectTaskOrder(page: Page, section: string, ids: number[]) {
  const rows = page.getByRole('region', { name: section }).getByRole('button', {
    name: /^Open TASK-/,
  });
  const rowLabels = await rows.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('aria-label'))
  );
  expect(rowLabels).toEqual(ids.map((id) => `Open TASK-${id}: Task ${id}`));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('sortOptionsReorderRowsWithoutNewApiRequests', async ({ page }) => {
  await page.clock.install({ time: '2026-10-26T06:30:00.000Z' });
  const api = await installTaskApi(page, [
    task(1, 'Task 1', { createdAt: '2026-10-24T10:00:00Z' }),
    task(2, 'Task 2', {
      createdAt: '2026-10-22T10:00:00Z',
      dueDate: '2026-10-24',
      priority: 'LOW',
    }),
    task(3, 'Task 3', {
      createdAt: '2026-10-23T11:00:00Z',
      dueDate: '2026-10-25',
      priority: 'CRITICAL',
    }),
    task(4, 'Task 4', {
      createdAt: '2026-10-21T10:00:00Z',
      dueDate: '2026-10-24',
      priority: 'HIGH',
    }),
    task(5, 'Task 5', {
      createdAt: '2026-10-23T12:00:00Z',
      priority: 'MEDIUM',
    }),
    task(6, 'Task 6', {
      createdAt: '2026-10-23T10:00:00Z',
      dueDate: '2026-10-25',
      priority: 'LOW',
      completedAt: '2026-10-26T05:00:00Z',
    }),
    task(7, 'Task 7', {
      createdAt: '2026-10-22T09:00:00Z',
      dueDate: '2026-10-24',
      priority: 'HIGH',
      completedAt: '2026-10-26T05:00:00Z',
    }),
    task(8, 'Task 8', {
      createdAt: '2026-10-23T09:00:00Z',
      dueDate: '2026-10-25',
      priority: 'MEDIUM',
      archivedAt: '2026-10-25T17:30:00Z',
    }),
    task(9, 'Task 9', {
      createdAt: '2026-10-21T09:00:00Z',
      dueDate: '2026-10-24',
      priority: 'CRITICAL',
      archivedAt: '2026-10-25T17:30:00Z',
    }),
  ]);
  await page.goto('/tasks');

  const sort = page.getByRole('combobox', { name: 'Sort' });
  await expect(sort).toHaveValue('newest');
  await expectTaskOrder(page, 'Active', [1, 5, 3, 2, 4]);
  await page.getByRole('switch', { name: 'Completed history' }).check();
  await page.getByRole('switch', { name: 'Archived tasks' }).check();

  const cases = [
    ['oldest', [4, 2, 3, 5, 1], [7, 6], [9, 8]],
    ['due-earliest', [2, 4, 3, 1, 5], [7, 6], [9, 8]],
    ['due-latest', [3, 2, 4, 1, 5], [6, 7], [8, 9]],
    ['priority-highest', [3, 4, 5, 2, 1], [7, 6], [9, 8]],
    ['priority-lowest', [2, 5, 4, 3, 1], [6, 7], [8, 9]],
  ] as const;

  for (const [mode, active, completed, archived] of cases) {
    await sort.selectOption(mode);
    await expectTaskOrder(page, 'Active', [...active]);
    await expectTaskOrder(page, 'Completed', [...completed]);
    await expectTaskOrder(page, 'Archived', [...archived]);
    await expect(page.getByRole('heading', { name: 'Active' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible();
  }

  expect(api.getListRequests()).toBe(1);
  expect(api.getMutationRequests()).toBe(0);
});

test('sortPersistsWithinTasksAndResetsOutside', async ({ page }) => {
  await page.clock.install({ time: '2026-10-26T06:30:00.000Z' });
  await installTaskApi(page, [
    task(1, 'Task 1'),
    task(2, 'Task 2', { completedAt: '2026-10-25T17:00:00Z' }),
    task(3, 'Task 3', { archivedAt: '2026-10-25T17:30:00Z' }),
  ]);
  await page.goto('/tasks');

  const sort = page.getByRole('combobox', { name: 'Sort' });
  await sort.selectOption('priority-highest');
  await expect(page.getByRole('heading', { name: 'Completed' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Archived' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Collapse Active section' }).click();
  await expect(page.getByRole('button', { name: 'Expand Active section' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await page.getByRole('switch', { name: 'Completed history' }).check();
  await page.getByRole('switch', { name: 'Archived tasks' }).check();
  await page.getByRole('button', { name: 'Expand Active section' }).click();

  await page.getByRole('button', { name: 'Open TASK-1: Task 1' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await page
    .getByTestId('task-detail-pane')
    .getByRole('button', { name: 'Open full page' })
    .click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(sort).toHaveValue('priority-highest');
  await expect(page.getByRole('button', { name: 'Collapse Active section' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('newest');

  await page.getByRole('combobox', { name: 'Sort' }).selectOption('priority-highest');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveValue('newest');
});
