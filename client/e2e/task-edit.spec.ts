import { expect, test } from '@playwright/test';

type TaskSummary = {
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
};

type TaskDetail = TaskSummary & { description: null; deletedAt: null };

function task(id: number, title: string): TaskSummary {
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
  };
}

test('guards, retries, saves, and discards inline field drafts across task navigation', async ({
  page,
}) => {
  const tasks = [task(1, 'First browser task'), task(2, 'Second browser task')];
  const details = new Map<number, TaskDetail>(
    tasks.map((item) => [item.id, { ...item, description: null, deletedAt: null }])
  );
  const patches: Array<{ id: number; body: Record<string, unknown> }> = [];
  let failNextPatch = true;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-edit@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: tasks }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/v1/tasks/*', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      patches.push({ id, body });
      if (failNextPatch) {
        failNextPatch = false;
        await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const updated = { ...details.get(id)!, ...body } as TaskDetail;
      details.set(id, updated);
      const index = tasks.findIndex((item) => item.id === id);
      if (index >= 0) tasks[index] = { ...tasks[index], ...body } as TaskSummary;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(details.get(id)),
    });
  });

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-1: First browser task' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  const title = page.getByRole('button', { name: 'Task title: First browser task' });
  await title.dblclick();
  const editor = page.locator('input[aria-label="Title"]');
  await editor.fill('Saved after retry');
  const beforeUnloadPrevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(beforeUnloadPrevented).toBe(true);
  await page.getByRole('button', { name: 'Open TASK-2: Second browser task' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(editor).toHaveValue('Saved after retry');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(editor).toHaveValue('Saved after retry');

  await page.getByRole('button', { name: 'Open TASK-2: Second browser task' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alertdialog')).toContainText(
    'Could not save this field. Your draft is still here. Try saving again.'
  );
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(editor).toHaveValue('Saved after retry');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=2$/);
  await expect(page.getByRole('heading', { name: 'Second browser task' })).toBeVisible();
  expect(patches).toEqual([
    { id: 1, body: { title: 'Saved after retry' } },
    { id: 1, body: { title: 'Saved after retry' } },
  ]);

  await page.getByRole('button', { name: 'Open TASK-1: Saved after retry' }).click();
  const savedTitle = page.getByRole('button', { name: 'Task title: Saved after retry' });
  await savedTitle.press('Space');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await savedTitle.press('Enter');
  await page.getByRole('textbox', { name: 'Title' }).fill('Discarded title');
  await page.getByRole('button', { name: 'Open TASK-2: Second browser task' }).click();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=2$/);
  expect(patches).toHaveLength(2);
  await page.getByRole('button', { name: 'Open TASK-1: Saved after retry' }).click();
  await expect(page.getByRole('button', { name: 'Task title: Saved after retry' })).toBeVisible();

  const priority = page.getByRole('button', { name: 'Priority: No priority' });
  await priority.dblclick();
  await page.getByLabel('Priority').selectOption('HIGH');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Priority: High' })).toBeVisible();
  await page.getByRole('button', { name: 'Priority: High' }).dblclick();
  await page.getByLabel('Priority').selectOption('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Priority: No priority' })).toBeVisible();

  await page.getByRole('button', { name: 'Due date: Not set' }).dblclick();
  await page.getByLabel('Due date').fill('2026-10-28');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Due date: Oct 28' })).toBeVisible();
  await page.getByRole('button', { name: 'Due date: Oct 28' }).dblclick();
  await page.getByLabel('Due date').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Due date: Not set' })).toBeVisible();

  expect(patches.slice(2)).toEqual([
    { id: 1, body: { priority: 'HIGH' } },
    { id: 1, body: { priority: null } },
    { id: 1, body: { dueDate: '2026-10-28' } },
    { id: 1, body: { dueDate: null } },
  ]);

  await page.setViewportSize({ width: 800, height: 720 });
  const drawer = page.getByRole('dialog', { name: 'Task details' });
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: 'Task title: Saved after retry' }).dblclick();
  await page.getByLabel('Title').fill('Discard from narrow drawer');
  const backNavigation = page.goBack();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await backNavigation;
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(page.getByLabel('Title')).toHaveValue('Discard from narrow drawer');
  await drawer.getByRole('button', { name: 'Open full page' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await expect(page.getByRole('heading', { name: 'Saved after retry' })).toBeVisible();
  await page.getByRole('button', { name: 'Task title: Saved after retry' }).dblclick();
  await page.getByLabel('Title').fill('Discard from canonical page');
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Discard from canonical page');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await expect(page.getByLabel('Title')).toHaveValue('Discard from canonical page');
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await page.getByRole('button', { name: 'Task title: Saved after retry' }).dblclick();
  await page.getByLabel('Title').fill('Discard from narrow drawer');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('Discard from narrow drawer');
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('alertdialog')).toBeHidden();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await drawer.getByRole('button', { name: 'Close task details' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  expect(patches).toHaveLength(6);
});
