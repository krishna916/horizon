import { expect, test, type Page, type Route } from '@playwright/test';

test.use({ timezoneId: 'Asia/Kolkata' });

type Task = {
  id: number;
  key: string;
  title: string;
  priority: 'HIGH' | null;
  dueDate: string | null;
  inbox: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  description: null;
  deletedAt: string | null;
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
    createdAt: '2026-10-25T10:00:00Z',
    updatedAt: '2026-10-25T10:00:00Z',
    description: null,
    deletedAt: null,
    checklist: [],
    ...overrides,
  };
}

async function installTaskApi(page: Page, initialTasks: Task[], completionTimestamp?: string) {
  const tasks = initialTasks.map((item) => ({ ...item }));
  let listRequests = 0;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-history@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();

    if (path === '/tasks' && method === 'GET') {
      listRequests += 1;
      const items = tasks
        .filter((item) => item.deletedAt === null)
        .map(
          ({ description: _description, deletedAt: _deletedAt, checklist: _checklist, ...rest }) =>
            rest
        );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    const taskRoute = path.match(/^\/tasks\/(\d+)(?:\/(complete|reopen))?$/);
    if (taskRoute && method === 'GET') {
      const item = tasks.find((candidate) => candidate.id === Number(taskRoute[1]));
      await route.fulfill({
        status: item ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(item ?? {}),
      });
      return;
    }

    if (taskRoute && method === 'POST' && taskRoute[2]) {
      const index = tasks.findIndex((item) => item.id === Number(taskRoute[1]));
      const current = tasks[index];
      if (!current) {
        await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const updated = {
        ...current,
        completedAt:
          taskRoute[2] === 'complete' ? (completionTimestamp ?? new Date().toISOString()) : null,
        updatedAt: completionTimestamp ?? new Date().toISOString(),
      };
      tasks[index] = updated;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }

    await route.fallback();
  });

  return {
    getListRequests: () => listRequests,
    getArchivedAt: (id: number) => tasks.find((item) => item.id === id)?.archivedAt,
  };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('keeps visibility and collapse choices through panel and canonical page navigation', async ({
  page,
}) => {
  await page.clock.install({ time: '2026-10-26T06:30:00.000Z' });
  const api = await installTaskApi(page, [
    task(1, 'Active commitment'),
    task(2, 'Completed today', { completedAt: '2026-10-26T05:00:00Z' }),
    task(3, 'Completed yesterday', { completedAt: '2026-10-25T17:00:00Z' }),
    task(4, 'Archived active', { archivedAt: '2026-10-25T17:30:00Z' }),
    task(5, 'Archived completed', {
      completedAt: '2026-10-25T16:00:00Z',
      archivedAt: '2026-10-25T17:30:00Z',
    }),
  ]);
  await page.goto('/tasks');

  const history = page.getByRole('switch', { name: 'Completed history' });
  const archived = page.getByRole('switch', { name: 'Archived tasks' });
  await expect(history).not.toBeChecked();
  await expect(archived).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Active commitment' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TASK-2: Completed today' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TASK-3: Completed yesterday' })).toHaveCount(
    0
  );
  await expect(page.getByRole('heading', { name: 'Archived' })).toHaveCount(0);

  await history.check();
  await expect(
    page.getByRole('button', { name: 'Open TASK-3: Completed yesterday' })
  ).toBeVisible();
  await archived.check();
  await expect(page.getByRole('button', { name: 'Open TASK-4: Archived active' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TASK-5: Archived completed' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Completed' }).locator('..')).toContainText('2');
  await expect(page.getByRole('heading', { name: 'Archived' }).locator('..')).toContainText('2');

  await page.getByRole('button', { name: 'Collapse Completed section' }).click();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Completed section' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(page.getByRole('button', { name: 'Open TASK-3: Completed yesterday' })).toHaveCount(
    0
  );
  await expect(page.getByRole('button', { name: 'Collapse Archived section' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  await page.getByRole('button', { name: 'Open TASK-1: Active commitment' }).click();
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
  await expect(history).toBeChecked();
  await expect(archived).toBeChecked();
  await expect(page.getByRole('button', { name: 'Expand Completed section' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(api.getListRequests()).toBe(1);
});

test('resets visibility and collapse choices after leaving Tasks or reloading', async ({
  page,
}) => {
  await page.clock.install({ time: '2026-10-26T06:30:00.000Z' });
  await installTaskApi(page, [
    task(1, 'Active commitment'),
    task(2, 'Completed yesterday', { completedAt: '2026-10-25T17:00:00Z' }),
    task(3, 'Archived task', { archivedAt: '2026-10-25T17:30:00Z' }),
  ]);
  await page.goto('/tasks');
  await page.getByRole('switch', { name: 'Completed history' }).check();
  await page.getByRole('switch', { name: 'Archived tasks' }).check();
  await page.getByRole('button', { name: 'Collapse Active section' }).click();

  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.getByRole('link', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('switch', { name: 'Completed history' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Archived tasks' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Collapse Active section' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  await page.getByRole('switch', { name: 'Completed history' }).check();
  await page.getByRole('switch', { name: 'Archived tasks' }).check();
  await page.getByRole('button', { name: 'Collapse Active section' }).click();
  await page.reload();
  await expect(page.getByRole('switch', { name: 'Completed history' })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: 'Archived tasks' })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Collapse Active section' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
});

test('releases temporary Active completion retention on a full-page trip', async ({ page }) => {
  await page.clock.install({ time: '2026-10-26T06:30:00.000Z' });
  const api = await installTaskApi(
    page,
    [task(1, 'Retained completion')],
    '2026-10-26T06:30:00.000Z'
  );
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeVisible();
  expect(api.getArchivedAt(1)).toBeNull();
  const completedHistory = page.getByRole('switch', { name: 'Completed history' });
  const archivedTasks = page.getByRole('switch', { name: 'Archived tasks' });
  await expect(completedHistory).not.toBeChecked();
  await expect(archivedTasks).not.toBeChecked();
  await expect(
    page
      .getByRole('region', { name: 'Active' })
      .getByRole('button', { name: 'Open TASK-1: Retained completion' })
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Completed' })
      .getByRole('button', { name: 'Open TASK-1: Retained completion' })
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Open TASK-1: Retained completion' }).click();
  await page
    .getByTestId('task-detail-pane')
    .getByRole('button', { name: 'Open full page' })
    .click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await page.getByRole('button', { name: 'Close task details' }).click();
  await expect(
    page
      .getByRole('region', { name: 'Active' })
      .getByRole('button', { name: 'Open TASK-1: Retained completion' })
  ).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(
    page
      .getByRole('region', { name: 'Completed' })
      .getByRole('button', { name: 'Open TASK-1: Retained completion' })
  ).toBeVisible();
  expect(api.getArchivedAt(1)).toBeNull();
  await expect(completedHistory).not.toBeChecked();
  await expect(archivedTasks).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Archived' })).toHaveCount(0);
});

test('regroups cached completion timestamps at Kolkata midnight without another list request', async ({
  page,
}) => {
  await page.clock.install({ time: '2026-10-25T18:29:50.000Z' });
  const api = await installTaskApi(page, [
    task(1, 'Completed at 23:59:40', { completedAt: '2026-10-25T18:29:40Z' }),
    task(2, 'Completed at 23:59:59', { completedAt: '2026-10-25T18:29:59Z' }),
  ]);
  await page.goto('/tasks');

  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open TASK-1: Completed at 23:59:40' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open TASK-2: Completed at 23:59:59' })
  ).toBeVisible();
  expect(api.getListRequests()).toBe(1);

  await page.clock.runFor(11_000);
  await expect(page.getByRole('heading', { name: 'Completed' })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open TASK-1: Completed at 23:59:40' })
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open TASK-2: Completed at 23:59:59' })
  ).toHaveCount(0);
  expect(api.getListRequests()).toBe(1);

  await page.getByRole('switch', { name: 'Completed history' }).check();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open TASK-1: Completed at 23:59:40' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open TASK-2: Completed at 23:59:59' })
  ).toBeVisible();
  expect(api.getListRequests()).toBe(1);
});
