import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

interface TaskSummary {
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
}

interface TaskDetail extends TaskSummary {
  description: Record<string, unknown> | null;
  deletedAt: string | null;
  checklist: [];
}

interface CreatePayload {
  title: string;
  description?: Record<string, unknown> | null;
  priority?: TaskSummary['priority'];
  dueDate?: string | null;
}

function summary(id: number, title: string, changes: Partial<TaskSummary> = {}): TaskSummary {
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
    ...changes,
  };
}

function detail(task: TaskSummary, description: TaskDetail['description'] = null): TaskDetail {
  return { ...task, description, deletedAt: null, checklist: [] };
}

async function installStatefulTaskApi(
  page: Page,
  {
    initialTasks = [],
    failFirstPost = false,
    holdFirstPost = false,
  }: { initialTasks?: TaskSummary[]; failFirstPost?: boolean; holdFirstPost?: boolean } = {}
) {
  const items = [...initialTasks];
  const details = new Map(initialTasks.map((task) => [task.id, detail(task)]));
  const requests: Array<{ payload: CreatePayload; requestKey: string; body: string }> = [];
  const creationsByRequestKey = new Map<string, TaskDetail>();
  let releasePost!: () => void;
  const firstPostGate = new Promise<void>((resolve) => (releasePost = resolve));
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-create@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }

    const request = route.request();
    const requestKey = request.headers()['idempotency-key'] ?? '';
    const payload = request.postDataJSON() as CreatePayload;
    requests.push({ payload, requestKey, body: request.postData() ?? '' });
    const replay = creationsByRequestKey.get(requestKey);
    if (replay) {
      await route.fulfill({
        status: 201,
        headers: { Location: `/api/v1/tasks/${replay.id}` },
        contentType: 'application/json',
        body: JSON.stringify(replay),
      });
      return;
    }

    if (holdFirstPost && requests.length === 1) await firstPostGate;

    const id = 41;
    const createdSummary = summary(id, payload.title, {
      priority: payload.priority ?? null,
      dueDate: payload.dueDate ?? null,
    });
    const createdDetail = detail(createdSummary, payload.description ?? null);
    details.set(id, createdDetail);
    items.unshift(createdSummary);
    if (requestKey) creationsByRequestKey.set(requestKey, createdDetail);
    if (failFirstPost && requests.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 201,
      headers: { Location: `/api/v1/tasks/${id}` },
      contentType: 'application/json',
      body: JSON.stringify(createdDetail),
    });
  });
  await page.route('**/api/v1/tasks/*', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/api\/v1\/tasks\/(\d+)$/);
    if (route.request().method() !== 'GET' || !match) {
      await route.fallback();
      return;
    }
    const task = details.get(Number(match[1]));
    if (!task) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(task),
    });
  });
  return { items, requests, releasePost: () => releasePost() };
}

test('creates one Active task and replaces the create entry with its detail panel', async ({
  page,
}) => {
  const fixture = await installStatefulTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();
  await title.fill('Prepare the launch notes');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Prepare the launch notes' })).toBeVisible();
  await expect(page.getByTestId('task-detail-pane').getByText('TASK-41')).toBeVisible();
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.requestKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(fixture.requests[0]?.payload).toEqual({ title: 'Prepare the launch notes' });
  expect(fixture.items[0]).toMatchObject({
    id: 41,
    title: 'Prepare the launch notes',
    key: 'TASK-41',
    inbox: false,
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole('button', { name: 'Open TASK-41: Prepare the launch notes' })
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
});

test('retries an ambiguous create with the frozen payload and request key', async ({ page }) => {
  const fixture = await installStatefulTaskApi(page, { failFirstPost: true });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  const description = page.getByLabel('Description (optional) editor');
  await title.fill('Recover the submitted draft');
  await description.fill('Keep these details unchanged.');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText(
    'could not confirm whether this task was created'
  );
  expect(fixture.items).toHaveLength(1);
  expect(fixture.items[0]).toMatchObject({ id: 41, key: 'TASK-41' });
  await expect(title).toBeDisabled();
  await expect(description).toHaveAttribute('contenteditable', 'false');
  await page.getByRole('button', { name: 'Retry creation' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Recover the submitted draft' })).toBeVisible();
  await expect(page.getByTestId('task-detail-pane').getByText('TASK-41')).toBeVisible();

  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1]).toEqual(fixture.requests[0]);
  expect(fixture.requests[1]?.body).toBe(fixture.requests[0]?.body);
  expect(fixture.items).toHaveLength(1);
  expect(fixture.items[0]).toMatchObject({ id: 41, key: 'TASK-41' });
});

test('blocks browser Back while the create POST is pending and opens detail after success', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = await installStatefulTaskApi(page, {
    initialTasks: [summary(7, 'Review the plan')],
    holdFirstPost: true,
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.fill('Wait for the create response');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => fixture.requests).toHaveLength(1);
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeDisabled();

  const pendingDialog = page.getByRole('alertdialog');
  const expectPendingBlock = async () => {
    await expect(pendingDialog).toBeVisible();
    await expect(pendingDialog).toContainText('Creating task…');
    await expect(pendingDialog.getByRole('button', { name: 'Stay here' })).toBeVisible();
    await expect(pendingDialog.getByRole('button', { name: 'Discard draft' })).toHaveCount(0);
  };

  await page.goBack();
  await expectPendingBlock();
  await pendingDialog.getByRole('button', { name: 'Stay here' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(title).toHaveValue('Wait for the create response');

  fixture.releasePost();
  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Wait for the create response' })).toBeVisible();
});

test('blocks X, Escape, and backdrop dismissal while the create POST is pending', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const fixture = await installStatefulTaskApi(page, { holdFirstPost: true });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Keep the pending panel open');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => fixture.requests).toHaveLength(1);

  const pendingDialog = page.getByRole('alertdialog');
  const assertPendingBlock = async () => {
    await expect(pendingDialog).toBeVisible();
    await expect(pendingDialog).toContainText('Creating task…');
    await expect(pendingDialog.getByRole('button', { name: 'Discard draft' })).toHaveCount(0);
  };
  const stay = async () => {
    await pendingDialog.getByRole('button', { name: 'Stay here' }).click();
    await expect(pendingDialog).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Create task' })).toBeVisible();
  };

  await page.getByRole('button', { name: 'Close create task' }).click();
  await assertPendingBlock();
  await stay();
  await page.keyboard.press('Escape');
  await assertPendingBlock();
  await stay();
  await page.getByTestId('task-overlay-backdrop').click({ position: { x: 8, y: 8 } });
  await assertPendingBlock();
  await stay();

  fixture.releasePost();
  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Keep the pending panel open' })).toBeVisible();
});

test('blocks sidebar navigation and sign out while the create POST is pending', async ({
  page,
}) => {
  let logoutRequests = 0;
  const fixture = await installStatefulTaskApi(page, { holdFirstPost: true });
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Keep this pending task safe');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect.poll(() => fixture.requests).toHaveLength(1);

  const pendingDialog = page.getByRole('alertdialog');
  await page.getByRole('link', { name: 'Today' }).click();
  await expect(pendingDialog).toContainText('Creating task…');
  await pendingDialog.getByRole('button', { name: 'Stay here' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Keep this pending task safe'
  );

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(pendingDialog).toContainText('Creating task…');
  await pendingDialog.getByRole('button', { name: 'Stay here' }).click();
  expect(logoutRequests).toBe(0);

  fixture.releasePost();
  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Keep this pending task safe' })).toBeVisible();
  expect(logoutRequests).toBe(0);
});

test('keeps a dirty draft on Back, then follows the chosen discard destination', async ({
  page,
}) => {
  await installStatefulTaskApi(page, { initialTasks: [summary(7, 'Review the plan')] });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Unsaved task draft');

  await page.goBack();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved task draft');

  await page.goBack();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
});

test('keeps a dirty direct-create draft on Forward and discards to that destination once', async ({
  page,
}) => {
  await installStatefulTaskApi(page);
  await page.goto('/tasks?create=true');
  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.fill('Forward navigation draft');

  await page.goForward();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(title).toHaveValue('Forward navigation draft');

  await page.goForward();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole('main').getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
});

test('guards Escape and backdrop dismissal in the narrow overlay, while explicit Cancel discards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await installStatefulTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create task' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Keep or discard this draft');

  await page.keyboard.press('Escape');
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeVisible();
  await page.getByTestId('task-overlay-backdrop').click({ position: { x: 8, y: 8 } });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(confirmation).toHaveCount(0);
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('dialog', { name: 'Create task' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Title' }).fill('Cancel immediately');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('keeps a dirty draft when sign out is canceled and logs out after discard', async ({
  page,
}) => {
  let logoutRequests = 0;
  await installStatefulTaskApi(page);
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  await title.fill('Keep this draft if I stay signed in');

  await page.getByRole('button', { name: 'Sign out' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(title).toHaveValue('Keep this draft if I stay signed in');
  expect(logoutRequests).toBe(0);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutRequests).toBe(1);
});

test('returns to the previous route and shows an error when sign out fails', async ({ page }) => {
  let logoutRequests = 0;
  await installStatefulTaskApi(page);
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
  });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Discard before logout');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click();

  await expect.poll(() => logoutRequests).toBe(1);
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('region', { name: 'Create task' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Sign out failed. Please try again.');
});
