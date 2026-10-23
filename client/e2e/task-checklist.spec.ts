import { expect, test, type Page, type Route } from '@playwright/test';

type ChecklistItem = {
  id: number;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  position: number;
};

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

type TaskDetail = TaskSummary & {
  description: null;
  deletedAt: null;
  checklist: ChecklistItem[];
};

type ChecklistCreate = { title: string; dueDate?: string };

function summary(id: number, title: string, completedAt: string | null = null): TaskSummary {
  return {
    id,
    key: `TASK-${id}`,
    title,
    priority: 'HIGH',
    dueDate: null,
    inbox: false,
    completedAt,
    archivedAt: null,
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-20T10:00:00Z',
  };
}

async function installChecklistApi(
  page: Page,
  initial: Array<{ task: TaskSummary; checklist?: ChecklistItem[] }> = []
) {
  let nextTaskId = Math.max(0, ...initial.map(({ task }) => task.id)) + 1;
  let nextItemId =
    Math.max(0, ...initial.flatMap(({ checklist = [] }) => checklist.map((item) => item.id))) + 1;
  const tasks = initial.map(({ task }) => task);
  const details = new Map<number, TaskDetail>(
    initial.map(({ task, checklist = [] }) => [
      task.id,
      { ...task, description: null, deletedAt: null, checklist: structuredClone(checklist) },
    ])
  );
  const removedItems = new Map<number, Map<number, ChecklistItem>>();
  const writes: Array<{ method: string; path: string; body?: unknown }> = [];

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-checklist@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks**', async (route: Route) => {
    const { pathname } = new URL(route.request().url());
    const path = pathname.replace('/api/v1', '');
    const method = route.request().method();
    const body = route.request().postDataJSON() as Record<string, unknown> | undefined;
    const respond = (data: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    if (path === '/tasks' && method === 'GET') {
      await respond({ items: tasks });
      return;
    }
    if (path === '/tasks' && method === 'POST') {
      const id = nextTaskId++;
      const created = summary(id, String(body?.title ?? ''));
      const checklist = ((body?.checklist ?? []) as ChecklistCreate[]).map((item, position) => ({
        id: nextItemId++,
        title: item.title,
        dueDate: item.dueDate ?? null,
        completedAt: null,
        position,
      }));
      const createdDetail: TaskDetail = {
        ...created,
        description: null,
        deletedAt: null,
        checklist,
      };
      tasks.unshift(created);
      details.set(id, createdDetail);
      writes.push({ method, path, body });
      await respond(createdDetail, 201);
      return;
    }

    const detailMatch = path.match(/^\/tasks\/(\d+)$/);
    if (detailMatch && method === 'GET') {
      const detail = details.get(Number(detailMatch[1]));
      await respond(detail ?? {}, detail ? 200 : 404);
      return;
    }

    const completionMatch = path.match(/^\/tasks\/(\d+)\/(complete|reopen)$/);
    if (completionMatch && method === 'POST') {
      const id = Number(completionMatch[1]);
      const detail = details.get(id);
      if (!detail) return void (await respond({}, 404));
      const completedAt = completionMatch[2] === 'complete' ? '2026-10-23T10:00:00Z' : null;
      const updated = { ...detail, completedAt };
      details.set(id, updated);
      tasks.forEach((item, index) => {
        if (item.id === id) tasks[index] = { ...item, completedAt };
      });
      writes.push({ method, path });
      await respond(updated);
      return;
    }

    const checklistMatch = path.match(
      /^\/tasks\/(\d+)\/checklist-items(?:\/(\d+)(?:\/(complete|reopen|restore))?)?(\/order)?$/
    );
    if (checklistMatch) {
      const taskId = Number(checklistMatch[1]);
      const detail = details.get(taskId);
      if (!detail) return void (await respond({}, 404));
      const itemId = checklistMatch[2] ? Number(checklistMatch[2]) : null;
      const action = checklistMatch[3] ?? null;
      const order = Boolean(checklistMatch[4]);
      let items = [...detail.checklist];
      const removedForTask = removedItems.get(taskId) ?? new Map<number, ChecklistItem>();
      removedItems.set(taskId, removedForTask);
      if (method === 'POST' && itemId === null) {
        const item = {
          id: nextItemId++,
          title: String(body?.title ?? ''),
          dueDate: null,
          completedAt: null,
          position: items.length,
        };
        items.push(item);
        writes.push({ method, path, body });
        details.set(taskId, { ...detail, checklist: items });
        await respond(item);
        return;
      }
      if (method === 'PUT' && order) {
        const ids = body?.itemIds as number[];
        items = ids.map((id, position) => {
          const item = items.find((candidate) => candidate.id === id)!;
          return { ...item, position };
        });
        writes.push({ method, path, body });
        details.set(taskId, { ...detail, checklist: items });
        await respond(items);
        return;
      }
      if (itemId === null) return void (await route.fallback());
      if (
        method === 'POST' &&
        action === 'restore' &&
        !items.some((candidate) => candidate.id === itemId)
      ) {
        const removed = removedForTask.get(itemId);
        if (!removed) return void (await respond({}, 404));
        items.splice(Math.min(removed.position, items.length), 0, removed);
        items = items.map((candidate, position) => ({ ...candidate, position }));
        removedForTask.delete(itemId);
        writes.push({ method, path });
        details.set(taskId, { ...detail, checklist: items });
        await respond(items.find((candidate) => candidate.id === itemId));
        return;
      }
      const item = items.find((candidate) => candidate.id === itemId);
      if (!item) return void (await respond({}, 404));
      if (method === 'PATCH') {
        const updated = { ...item, ...(body as Partial<ChecklistItem>) };
        items = items.map((candidate) => (candidate.id === itemId ? updated : candidate));
        writes.push({ method, path, body });
        details.set(taskId, { ...detail, checklist: items });
        await respond(updated);
        return;
      }
      if (method === 'POST' && action) {
        const updated = {
          ...item,
          completedAt:
            action === 'complete'
              ? '2026-10-23T10:00:00Z'
              : action === 'reopen'
                ? null
                : item.completedAt,
        };
        items = items.map((candidate) => (candidate.id === itemId ? updated : candidate));
        writes.push({ method, path });
        details.set(taskId, { ...detail, checklist: items });
        await respond(updated);
        return;
      }
      if (method === 'DELETE') {
        removedForTask.set(itemId, item);
        items = items.filter((candidate) => candidate.id !== itemId);
        items = items.map((candidate, position) => ({ ...candidate, position }));
        writes.push({ method, path });
        details.set(taskId, { ...detail, checklist: items });
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fallback();
      return;
    }

    await route.fallback();
  });
  return { tasks, details, writes };
}

const items = [
  { id: 71, title: 'Call florist', dueDate: null, completedAt: null, position: 0 },
  { id: 72, title: 'Book a table', dueDate: null, completedAt: null, position: 1 },
];

test('createWithInitialChecklistReloadsInOrder', async ({ page }) => {
  const api = await installChecklistApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Prepare the launch');
  await page.getByRole('button', { name: 'Add checklist draft item' }).click();
  await page.getByRole('textbox', { name: 'Checklist item 1 title' }).fill('Draft the email');
  await page.getByLabel('Checklist item 1 due date').fill('2026-10-28');
  await page.getByRole('button', { name: 'Add checklist draft item' }).click();
  await page.getByRole('textbox', { name: 'Checklist item 2 title' }).fill('Book the venue');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(page.getByText('Draft the email')).toBeVisible();
  await expect(page.getByText('Book the venue')).toBeVisible();
  expect(api.writes[0]).toMatchObject({
    method: 'POST',
    path: '/tasks',
    body: {
      title: 'Prepare the launch',
      checklist: [{ title: 'Draft the email', dueDate: '2026-10-28' }, { title: 'Book the venue' }],
    },
  });
  expect(api.details.get(1)?.checklist.map(({ title }) => title)).toEqual([
    'Draft the email',
    'Book the venue',
  ]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Checklist' })).toBeVisible();
  await expect(page.getByText('Draft the email')).toBeVisible();
  await expect(page.getByText('Book the venue')).toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Complete checklist item Draft the email' })
  ).toHaveCount(1);
});

test('addRenameDateCompleteReopenPersistAcrossReload', async ({ page }) => {
  const api = await installChecklistApi(page, [{ task: summary(1, 'Quarterly review') }]);
  await page.goto('/tasks?task=1');
  await page.getByRole('textbox', { name: 'Add checklist item' }).fill('Prepare agenda');
  await page.getByRole('textbox', { name: 'Add checklist item' }).press('Enter');
  await expect(page.getByText('Prepare agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Edit checklist item Prepare agenda' }).click();
  await page.getByRole('textbox', { name: 'Checklist item title' }).fill('Send agenda');
  await page.getByRole('button', { name: 'Save checklist item title' }).click();
  await expect(page.getByText('Send agenda')).toBeVisible();
  await page.getByRole('button', { name: 'Set due date for Send agenda' }).click();
  await page.getByRole('textbox', { name: 'Due date for Send agenda' }).fill('2026-10-29');
  await expect(
    page.getByRole('checkbox', { name: 'Complete checklist item Send agenda' })
  ).toBeEnabled();
  await page.getByRole('checkbox', { name: 'Complete checklist item Send agenda' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Reopen checklist item Send agenda' })
  ).toBeChecked();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Set due date for Send agenda' })).toContainText(
    '2026-10-29'
  );
  await expect(
    page.getByRole('checkbox', { name: 'Reopen checklist item Send agenda' })
  ).toBeChecked();
  await page.getByRole('checkbox', { name: 'Reopen checklist item Send agenda' }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Complete checklist item Send agenda' })
  ).not.toBeChecked();
  expect(api.writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'POST /tasks/1/checklist-items',
    'PATCH /tasks/1/checklist-items/1',
    'PATCH /tasks/1/checklist-items/1',
    'POST /tasks/1/checklist-items/1/complete',
    'POST /tasks/1/checklist-items/1/reopen',
  ]);
  expect(api.details.get(1)?.checklist[0]).toMatchObject({
    title: 'Send agenda',
    dueDate: '2026-10-29',
    completedAt: null,
  });
});

test('dragAndKeyboardReorderRequireSaveAndAllowCancel', async ({ page }) => {
  const api = await installChecklistApi(page, [
    { task: summary(1, 'Quarterly review'), checklist: items },
  ]);
  await page.goto('/tasks?task=1');
  await page.getByRole('button', { name: 'Reorder checklist' }).click();
  await page.getByRole('button', { name: 'Move Book a table up' }).click();
  await expect(page.getByRole('status')).toContainText('Moved Book a table to position 1 of 2');
  expect(api.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancel checklist order' }).click();
  await expect(
    page.getByRole('list', { name: 'Checklist items' }).locator('li').first()
  ).toContainText('Call florist');

  await page.getByRole('button', { name: 'Reorder checklist' }).click();
  await page.getByRole('button', { name: 'Move Book a table up' }).click();
  await page.getByRole('button', { name: 'Save checklist order' }).click();
  await expect(
    page.getByRole('list', { name: 'Checklist items' }).locator('li').first()
  ).toContainText('Book a table');
  await page.reload();
  await expect(
    page.getByRole('list', { name: 'Checklist items' }).locator('li').first()
  ).toContainText('Book a table');
  expect(api.writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'PUT /tasks/1/checklist-items/order',
  ]);
});

test('removeUndoRestoresOriginalItem', async ({ page }) => {
  const api = await installChecklistApi(page, [
    { task: summary(1, 'Quarterly review'), checklist: items },
  ]);
  await page.goto('/tasks?task=1');
  await page.getByRole('button', { name: 'Remove checklist item Call florist' }).click();
  await expect(
    page.getByRole('list', { name: 'Checklist items' }).getByText('Call florist')
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo removing Call florist' }).click();
  await expect(page.getByText('Call florist')).toBeVisible();
  expect(api.writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
    'DELETE /tasks/1/checklist-items/71',
    'POST /tasks/1/checklist-items/71/restore',
  ]);
  expect(api.details.get(1)?.checklist[0]).toMatchObject({
    id: 71,
    position: 0,
    title: 'Call florist',
  });
});

test('parentCompletionFromListShowsWarningAndCancelDoesNotWrite', async ({ page }) => {
  const api = await installChecklistApi(page, [
    { task: summary(1, 'Quarterly review'), checklist: items },
  ]);
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Complete TASK-1 with unfinished items?' });
  await expect(dialog).toContainText('2 checklist items are unfinished');
  await dialog.getByRole('button', { name: 'Cancel completion' }).click();
  expect(api.writes).toHaveLength(0);
  await expect(page.getByRole('checkbox', { name: 'Complete TASK-1' })).toHaveAttribute(
    'aria-checked',
    'false'
  );
});

test('completedParentStillContainsIndependentlyIncompleteItem', async ({ page }) => {
  const api = await installChecklistApi(page, [
    { task: summary(1, 'Quarterly review'), checklist: items },
  ]);
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete TASK-1' }).click();
  await page.getByRole('button', { name: 'Complete Anyway' }).click();
  await expect(page.getByRole('checkbox', { name: 'Reopen TASK-1' })).toBeVisible();
  await page.getByRole('button', { name: 'Open TASK-1: Quarterly review' }).click();
  const detail = page.getByTestId('task-detail-pane');
  await expect(
    detail.getByRole('checkbox', { name: 'Complete checklist item Call florist' })
  ).toBeChecked({ checked: false });
  await expect(
    detail.getByRole('checkbox', { name: 'Complete checklist item Book a table' })
  ).toBeChecked({ checked: false });
  expect(api.details.get(1)?.completedAt).not.toBeNull();
  expect(api.details.get(1)?.checklist.every(({ completedAt }) => completedAt === null)).toBe(true);
});

test('navigationDuringReorderPromptsSaveOrDiscard', async ({ page }) => {
  const api = await installChecklistApi(page, [
    { task: summary(1, 'Quarterly review'), checklist: items },
    { task: summary(2, 'Prepare budget') },
  ]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tasks?task=1');
  await page
    .getByTestId('task-detail-pane')
    .getByRole('button', { name: 'Open full page' })
    .click();
  await expect(page).toHaveURL(/\/tasks\/1$/);
  await page.getByRole('button', { name: 'Reorder checklist' }).click();
  await page.getByRole('button', { name: 'Move Book a table up' }).click();
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(
    page.getByRole('list', { name: 'Checklist items' }).locator('li').first()
  ).toContainText('Book a table');
  expect(api.writes).toEqual([
    {
      method: 'PUT',
      path: '/tasks/1/checklist-items/order',
      body: { itemIds: [72, 71] },
    },
  ]);
});
