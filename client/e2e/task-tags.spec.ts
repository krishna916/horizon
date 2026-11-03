import { expect, test, type Page, type Route } from '@playwright/test';

type Tag = { id: number; name: string };
type TagReference = { id: number } | { name: string };
type TaskSummary = {
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
  tags: Tag[];
};
type TaskDetail = TaskSummary & {
  description: null;
  deletedAt: null;
  checklist: [];
};
type TaskPayload = {
  title?: string;
  tags?: TagReference[];
  [field: string]: unknown;
};

function task(id: number, title: string, tags: Tag[] = [], inbox = false): TaskDetail {
  return {
    id,
    key: `TASK-${id}`,
    title,
    priority: null,
    dueDate: null,
    inbox,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
    tags,
    description: null,
    deletedAt: null,
    checklist: [],
  };
}

async function installStatefulApi(page: Page, initialTasks: TaskDetail[] = []) {
  const tasks = initialTasks.map((item) => ({ ...item, tags: [...item.tags] }));
  const tags = new Map<number, Tag>(
    initialTasks.flatMap((item) => item.tags.map((tag) => [tag.id, tag]))
  );
  const requests: Array<{ method: string; path: string; payload?: TaskPayload }> = [];
  let nextTaskId = Math.max(40, ...tasks.map((item) => item.id)) + 1;
  let nextTagId = Math.max(0, ...tags.keys()) + 1;

  const resolveTags = (references: TagReference[] = []): Tag[] => {
    const resolved = references.flatMap((reference) => {
      if ('id' in reference) {
        const tag = tags.get(reference.id);
        return tag ? [tag] : [];
      }
      const existing = [...tags.values()].find(
        (tag) => tag.name.trim().toLowerCase() === reference.name.trim().toLowerCase()
      );
      const tag = existing ?? { id: nextTagId++, name: reference.name.trim() };
      tags.set(tag.id, tag);
      return [tag];
    });
    return resolved.sort((left, right) => left.name.localeCompare(right.name));
  };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-tags@example.com' }),
    })
  );
  await page.route('**/api/v1/tags/suggestions**', async (route: Route) => {
    const prefix = new URL(route.request().url()).searchParams.get('q')?.trim().toLowerCase() ?? '';
    const items = [...tags.values()]
      .filter((tag) => tag.name.toLowerCase().startsWith(prefix))
      .sort((left, right) => left.name.localeCompare(right.name));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    });
  });
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();
    if (path === '/tasks' && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: tasks.map(
            ({ description: _d, deletedAt: _x, checklist: _c, ...summary }) => summary
          ),
        }),
      });
      return;
    }
    if (path === '/tasks' && method === 'POST') {
      const payload = route.request().postDataJSON() as TaskPayload;
      requests.push({ method, path, payload });
      const created = task(nextTaskId++, payload.title ?? '', resolveTags(payload.tags), false);
      tasks.unshift(created);
      await route.fulfill({
        status: 201,
        headers: { Location: `/api/v1/tasks/${created.id}` },
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }

    const match = path.match(/^\/tasks\/(\d+)$/);
    const current = match ? tasks.find((item) => item.id === Number(match[1])) : undefined;
    if (!current) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(current),
      });
      return;
    }
    if (method === 'PATCH') {
      const payload = route.request().postDataJSON() as TaskPayload;
      requests.push({ method, path, payload });
      if (payload.title !== undefined) current.title = payload.title;
      if (payload.tags !== undefined) current.tags = resolveTags(payload.tags);
      current.updatedAt = '2026-10-21T10:00:00Z';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(current),
      });
      return;
    }
    await route.fallback();
  });

  return { tasks, tags, requests };
}

test('createDraftCancelThenSaveAndReuseTag', async ({ page }) => {
  const fixture = await installStatefulApi(page);
  await page.goto('/tasks');

  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  const firstTagInput = page.getByRole('combobox', { name: 'Add tags' });
  await firstTagInput.fill('Architecture');
  await page.getByRole('option', { name: 'Create tag “Architecture”' }).click();
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  expect(fixture.tags.size).toBe(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Create task' })).toHaveCount(0);
  expect(fixture.requests).toHaveLength(0);
  expect(fixture.tags.size).toBe(0);

  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Document the architecture');
  const saveTagInput = page.getByRole('combobox', { name: 'Add tags' });
  await saveTagInput.fill('Architecture');
  await page.getByRole('option', { name: 'Create tag “Architecture”' }).click();
  expect(fixture.requests.filter((request) => request.method === 'POST')).toHaveLength(0);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/tasks\?task=\d+$/);
  await expect(
    page.getByTestId('task-detail-pane').getByText('Architecture', { exact: true })
  ).toBeVisible();
  const firstCreate = fixture.requests.find((request) => request.method === 'POST');
  expect(firstCreate?.payload?.tags).toEqual([{ name: 'Architecture' }]);
  const architecture = [...fixture.tags.values()].find((tag) => tag.name === 'Architecture');
  expect(architecture).toBeDefined();
  expect(fixture.tasks[0]?.inbox).toBe(false);

  await expect(
    page.getByRole('button', { name: 'Open TASK-41: Document the architecture' })
  ).toBeVisible();
  await page.getByRole('button', { name: /Add a task to Active/ }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Reuse the architecture tag');
  const reuseInput = page.getByRole('combobox', { name: 'Add tags' });
  await reuseInput.fill('arch');
  await expect(page.getByRole('option', { name: 'Architecture', exact: true })).toBeVisible();
  await reuseInput.press('ArrowDown');
  await reuseInput.press('Enter');
  await reuseInput.fill('missing');
  await expect(page.getByText('No matching tags')).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reuse the architecture tag' })).toBeVisible();

  const createRequests = fixture.requests.filter((request) => request.method === 'POST');
  expect(createRequests).toHaveLength(2);
  expect(createRequests[1]?.payload?.tags).toEqual([{ id: architecture!.id }]);
  expect([...fixture.tags.values()]).toEqual([architecture]);
});

test('editFullTagSetAndReload', async ({ page }) => {
  const fixture = await installStatefulApi(page, [
    task(7, 'Update the service guide', [
      { id: 1, name: 'Backend' },
      { id: 2, name: 'Architecture' },
      { id: 3, name: 'Operations' },
    ]),
  ]);
  await page.goto('/tasks?task=7');
  const detailPane = page.getByTestId('task-detail-pane');
  await expect(detailPane.getByRole('heading', { name: 'Update the service guide' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByRole('button', { name: 'Remove tag Backend' }).click();
  const cancelInput = page.getByRole('combobox', { name: 'Add tags' });
  await cancelInput.fill('Design');
  await page.getByRole('option', { name: 'Create tag “Design”' }).click();
  await page.getByRole('button', { name: 'Cancel tags' }).click();
  expect(fixture.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  expect(fixture.tags.size).toBe(3);
  await expect(detailPane.getByText('Backend')).toBeVisible();

  await page.getByRole('button', { name: 'Edit tags' }).click();
  await page.getByRole('button', { name: 'Remove tag Backend' }).click();
  const editInput = page.getByRole('combobox', { name: 'Add tags' });
  await editInput.fill('Design');
  await page.getByRole('option', { name: 'Create tag “Design”' }).click();
  expect(fixture.requests.filter((request) => request.method === 'PATCH')).toHaveLength(0);
  await page.getByRole('button', { name: 'Save tags' }).click();

  await expect(detailPane.getByText('Design')).toBeVisible();
  const patch = fixture.requests.find((request) => request.method === 'PATCH');
  expect(patch?.payload?.tags).toEqual([{ id: 2 }, { id: 3 }, { name: 'Design' }]);
  expect(patch?.payload).not.toHaveProperty('inbox');
  expect(fixture.tasks[0]?.inbox).toBe(false);
  expect(fixture.tasks[0]?.tags.map((tag) => tag.name)).toEqual([
    'Architecture',
    'Design',
    'Operations',
  ]);

  const row = page.getByRole('button', { name: 'Open TASK-7: Update the service guide' });
  await expect(row.getByText('Architecture', { exact: true })).toBeVisible();
  await expect(row.getByText('Design', { exact: true })).toBeVisible();
  await expect(row.getByText('+1', { exact: true })).toBeVisible();
  await expect(detailPane.getByText('Operations', { exact: true })).toBeVisible();

  await page.reload();
  const reloadedDetail = page.getByTestId('task-detail-pane');
  await expect(reloadedDetail.getByText('Architecture', { exact: true })).toBeVisible();
  await expect(reloadedDetail.getByText('Design', { exact: true })).toBeVisible();
  await expect(reloadedDetail.getByText('Operations', { exact: true })).toBeVisible();
  await expect(
    page
      .getByRole('button', { name: 'Open TASK-7: Update the service guide' })
      .getByText('+1', { exact: true })
  ).toBeVisible();
  expect(fixture.tasks[0]?.inbox).toBe(false);
});
