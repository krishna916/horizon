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
  deletedAt: string | null;
  checklist: [];
};

function task(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    key: `TASK-${id}`,
    title: `Lifecycle task ${id}`,
    priority: 'HIGH',
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

type ApiControls = { tasks: Task[]; commands: string[]; abortDeleteOnce: Set<number> };

async function installTaskApi(page: Page, initial: Task[] = [task(1), task(2)]) {
  const controls: ApiControls = {
    tasks: initial.map((item) => ({ ...item })),
    commands: [],
    abortDeleteOnce: new Set(),
  };
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-lifecycle@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    if (path === '/tasks' && method === 'GET') {
      const items = controls.tasks
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
    const detailMatch = path.match(/^\/tasks\/(\d+)$/);
    if (detailMatch && method === 'GET') {
      const item = controls.tasks.find((candidate) => candidate.id === Number(detailMatch[1]));
      await route.fulfill({
        status: item && item.deletedAt === null ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(item ?? {}),
      });
      return;
    }
    const command = path.match(/^\/tasks\/(\d+)(?:\/(archive|restore|restore-deleted))?$/);
    if (!command) {
      await route.fallback();
      return;
    }
    const id = Number(command[1]);
    const operation = command[2];
    const index = controls.tasks.findIndex((item) => item.id === id);
    const current = controls.tasks[index];
    if (index < 0 || !current) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (method === 'PATCH') {
      const updated = {
        ...current,
        ...(route.request().postDataJSON() as Partial<Task>),
        updatedAt: new Date().toISOString(),
      };
      controls.tasks[index] = updated;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    if (operation === 'archive' && method === 'POST') {
      controls.commands.push(`archive:${id}`);
      const updated = { ...current, archivedAt: current.archivedAt ?? new Date().toISOString() };
      controls.tasks[index] = updated;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    if (operation === 'restore' && method === 'POST') {
      controls.commands.push(`restore:${id}`);
      const updated = { ...current, archivedAt: null };
      controls.tasks[index] = updated;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    if (operation === 'restore-deleted' && method === 'POST') {
      controls.commands.push(`restore-deleted:${id}`);
      const updated = { ...current, deletedAt: null };
      controls.tasks[index] = updated;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    if (!operation && method === 'DELETE') {
      controls.commands.push(`delete:${id}`);
      controls.tasks[index] = { ...current, deletedAt: new Date().toISOString() };
      if (controls.abortDeleteOnce.delete(id)) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  });
  return controls;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('row archive can be undone and its menu restores keyboard focus', async ({ page }) => {
  const api = await installTaskApi(page, [task(1)]);
  await page.goto('/tasks');
  const trigger = page.getByRole('button', { name: 'More actions for TASK-1' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Archive' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('TASK-1 archived')).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 archive' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
  await expect.poll(() => api.commands).toEqual(['archive:1', 'restore:1']);
});

test('panel archive keeps details open and restores through the header', async ({ page }) => {
  await installTaskApi(page, [task(1)]);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' }).click();
  const panel = page.getByTestId('task-detail-pane');
  await panel.getByRole('button', { name: 'Archive task' }).click();
  await expect(panel.getByRole('button', { name: 'Restore task' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Lifecycle task 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 archive' }).click();
  await expect(panel.getByRole('button', { name: 'Archive task' })).toBeVisible();
});

test('an archive Undo notice survives canonical page to Tasks navigation', async ({ page }) => {
  await installTaskApi(page, [task(1)]);
  await page.goto('/tasks/1');
  await page.getByRole('button', { name: 'Archive task' }).click();
  await expect(page.getByText('TASK-1 archived')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('TASK-1 archived')).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 archive' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
});

test('lifecycle notices clear when leaving the Tasks route', async ({ page }) => {
  await installTaskApi(page, [task(1)]);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'More actions for TASK-1' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByText('TASK-1 archived')).toBeVisible();
  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByText('TASK-1 archived')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('TASK-1 archived')).toHaveCount(0);
});

test('archiving and restoring a completed task keeps it in Completed', async ({ page }) => {
  const today = new Date().toISOString();
  await installTaskApi(page, [task(1, { completedAt: today })]);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  const row = page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' });
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'More actions for TASK-1' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo TASK-1 archive' }).click();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
});

test('confirmed panel delete returns to the list and Undo restores the task', async ({ page }) => {
  const api = await installTaskApi(page, [task(1)]);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' }).click();
  await page.getByTestId('task-detail-pane').getByRole('button', { name: 'Move to Trash' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Move TASK-1 to Trash?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  expect(api.commands).toEqual([]);
  await page.getByTestId('task-detail-pane').getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByText('TASK-1 moved to Trash')).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 delete' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
  await expect.poll(() => api.commands).toEqual(['delete:1', 'restore-deleted:1']);
});

test('deleting the selected task from its row menu returns to Tasks and Undo restores it', async ({
  page,
}) => {
  const api = await installTaskApi(page, [task(1)]);
  await page.goto('/tasks?task=1');
  await expect(page.getByTestId('task-detail-pane')).toBeVisible();
  await page.getByRole('button', { name: 'More actions for TASK-1' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId('task-detail-pane')).toHaveCount(0);
  await expect(page.getByText('TASK-1 moved to Trash')).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 delete' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
  expect(api.commands).toEqual(['delete:1', 'restore-deleted:1']);
});

test('deleting a different row preserves the selected task details', async ({ page }) => {
  const api = await installTaskApi(page, [task(1), task(2)]);
  await page.goto('/tasks?task=1');
  await expect(page.getByTestId('task-detail-pane')).toBeVisible();
  await page.getByRole('button', { name: 'More actions for TASK-2' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();

  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(page.getByTestId('task-detail-pane')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lifecycle task 1' })).toBeVisible();
  await expect(page.getByText('TASK-2 moved to Trash')).toBeVisible();
  expect(api.commands).toEqual(['delete:2']);
});

test('a committed delete with a lost response stays retryable after a later list refetch', async ({
  page,
}) => {
  const api = await installTaskApi(page, [task(1), task(2)]);
  api.abortDeleteOnce.add(1);
  await page.goto('/tasks');

  await page.getByRole('button', { name: 'More actions for TASK-1' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page.getByText("Couldn't confirm moving TASK-1 to Trash")).toBeVisible();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Retry delete for TASK-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo TASK-1 delete' })).toHaveCount(0);

  await page.getByRole('button', { name: 'More actions for TASK-2' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry delete for TASK-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo TASK-1 delete' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Retry delete for TASK-1' }).click();
  await expect(page.getByText('TASK-1 moved to Trash')).toBeVisible();
  await page.getByRole('button', { name: 'Undo TASK-1 delete' }).click();
  await expect(page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' })).toBeVisible();
  await expect
    .poll(() => api.commands)
    .toEqual(['delete:1', 'delete:2', 'delete:1', 'restore-deleted:1']);
});

test('confirmed delete from the canonical page replaces that URL with the list', async ({
  page,
}) => {
  const api = await installTaskApi(page, [task(1)]);
  await page.goto('/tasks/1');
  await expect(page.getByRole('heading', { name: 'Lifecycle task 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();
  expect(api.commands).toEqual(['delete:1']);
});

test('dirty title actions support Keep editing, Save and Discard before confirmation', async ({
  page,
}) => {
  const api = await installTaskApi(page, [task(1)]);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: Lifecycle task 1' }).click();
  const title = page.getByRole('button', { name: 'Task title: Lifecycle task 1' });
  await title.dblclick();
  await page.getByRole('textbox', { name: 'Title' }).fill('Saved lifecycle title');
  await page.getByRole('button', { name: 'Archive task' }).click();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  expect(api.commands).toEqual([]);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Saved lifecycle title');
  await page.getByRole('button', { name: 'Archive task' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('button', { name: 'Restore task' })).toBeVisible();
  expect(api.commands).toEqual(['archive:1']);

  await page.getByRole('button', { name: 'Task title: Saved lifecycle title' }).dblclick();
  await page.getByRole('textbox', { name: 'Title' }).fill('Discard this title');
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Move TASK-1 to Trash?');
  expect(api.commands).toEqual(['archive:1']);
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  expect(api.commands).toEqual(['archive:1', 'delete:1']);
});
