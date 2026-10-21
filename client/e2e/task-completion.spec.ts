import { expect, test, type Page, type Route } from '@playwright/test';

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
  deletedAt: null;
};

function task(id: number, completedAt: string | null = null): Task {
  return {
    id,
    key: `TASK-${id}`,
    title: `Completion task ${id}`,
    priority: 'HIGH',
    dueDate: null,
    inbox: false,
    completedAt,
    archivedAt: null,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
    description: null,
    deletedAt: null,
  };
}

type ApiControls = {
  tasks: Task[];
  commands: string[];
  failNextCompletion: boolean;
  holdNextCompletion: ((resume: () => void) => void) | null;
};

async function installTaskApi(page: Page, initial: Task[] = [task(1), task(2)]) {
  const controls: ApiControls = {
    tasks: initial.map((item) => ({ ...item })),
    commands: [],
    failNextCompletion: false,
    holdNextCompletion: null,
  };
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-completion@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    if (path === '/tasks' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: controls.tasks.map(({ description: _, deletedAt: __, ...summary }) => summary),
        }),
      });
      return;
    }
    const command = path.match(/^\/tasks\/(\d+)\/(complete|reopen)$/);
    if (command && method === 'POST') {
      const [, rawId, action] = command;
      const id = Number(rawId);
      controls.commands.push(`${action}:${id}`);
      if (action === 'complete' && controls.holdNextCompletion) {
        const hold = controls.holdNextCompletion;
        controls.holdNextCompletion = null;
        await new Promise<void>((resolve) => {
          hold(resolve);
        });
      }
      if (action === 'complete' && controls.failNextCompletion) {
        controls.failNextCompletion = false;
        await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const current = controls.tasks.find((item) => item.id === id);
      if (!current) {
        await route.fulfill({ status: 404, body: '{}' });
        return;
      }
      const completedAt = action === 'complete' ? new Date().toISOString() : null;
      const updated = { ...current, completedAt, updatedAt: new Date().toISOString() };
      controls.tasks = controls.tasks.map((item) => (item.id === id ? updated : item));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    const detail = path.match(/^\/tasks\/(\d+)$/);
    if (detail && method === 'GET') {
      const current = controls.tasks.find((item) => item.id === Number(detail[1]));
      await route.fulfill({
        status: current ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(current ?? {}),
      });
      return;
    }
    await route.fallback();
  });
  return controls;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('completeThenReopenInActiveWhilePending', async ({ page }) => {
  const api = await installTaskApi(page);
  let release!: () => void;
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => (requestStarted = resolve));
  api.holdNextCompletion = (resume) => {
    release = resume;
    requestStarted();
  };
  await page.goto('/tasks');
  const checkbox = page.getByRole('checkbox', { name: 'Complete TASK-1' });
  await checkbox.focus();
  await page.keyboard.press('Space');
  const reopen = page.getByRole('checkbox', { name: 'Reopen TASK-1' });
  await expect(reopen).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Saving…')).toBeVisible();
  await started;
  await reopen.click();
  release();
  await expect(page.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect(page.getByRole('button', { name: 'Open TASK-1: Completion task 1' })).toBeVisible();
  await expect.poll(() => api.commands).toEqual(['complete:1', 'reopen:1']);
  await expect(page).toHaveURL(/\/tasks$/);
});

test('panelAndDedicatedPageCompletionUsesSameControl', async ({ page }) => {
  const api = await installTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: Completion task 1' }).click();
  const panel = page.getByTestId('task-detail-pane');
  await panel.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await panel.getByRole('button', { name: 'Open full page' }).click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await page.getByRole('checkbox', { name: 'Reopen TASK-1' }).click();
  await expect(page.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await expect.poll(() => api.commands).toEqual(['complete:1', 'reopen:1']);
});

test('navigateToPageAndBackEndsListRetention', async ({ page }) => {
  await installTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await page.getByRole('button', { name: 'Open TASK-1: Completion task 1' }).click();
  await page
    .getByTestId('task-detail-pane')
    .getByRole('button', { name: 'Open full page' })
    .click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(
    page.getByTestId('task-list-pane').getByRole('checkbox', { name: 'Reopen TASK-1' })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active' }).locator('..')).toContainText('1');
});

test('reloadDisplaysTodayCompletionInCompleted', async ({ page }) => {
  await installTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Active' }).locator('..')).toContainText('1');
});

test('serverFailureRestoresStateAndShowsPersistentRetry', async ({ page }) => {
  const api = await installTaskApi(page);
  api.failNextCompletion = true;
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not save TASK-1.');
  await expect(page.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
  await page.getByRole('button', { name: 'Retry TASK-1 completion save' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await expect.poll(() => api.commands).toEqual(['complete:1', 'complete:1']);
});

test('dirtyFieldDraftRemainsEditableOnCompletion', async ({ page }) => {
  const api = await installTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: Completion task 1' }).click();
  const panel = page.getByTestId('task-detail-pane');
  await panel.getByRole('button', { name: 'Task title: Completion task 1' }).dblclick();
  const title = panel.getByRole('textbox', { name: 'Title' });
  await title.fill('Unsaved title draft');
  await panel.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await expect(panel.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeVisible();
  await expect(title).toHaveValue('Unsaved title draft');
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  expect(api.commands).toEqual(['complete:1']);
  await panel.getByRole('checkbox', { name: 'Reopen TASK-1' }).focus();
  await page.keyboard.press('Space');
  await expect(panel.getByRole('checkbox', { name: 'Complete TASK-1' })).toBeVisible();
  await expect(title).toHaveValue('Unsaved title draft');
});
