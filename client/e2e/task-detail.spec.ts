import { expect, test } from '@playwright/test';

const taskSummary = (id: number, title: string) => ({
  id,
  key: `TASK-${id}`,
  title,
  priority: id === 7 ? 'HIGH' : 'MEDIUM',
  dueDate: '2026-10-25',
  inbox: false,
  completedAt: null,
  archivedAt: null,
  createdAt: '2026-10-18T10:00:00Z',
  updatedAt: '2026-10-18T10:00:00Z',
});

const taskDetail = (id: number) => ({
  ...taskSummary(id, `Task ${id} detail`),
  description: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: `Description for task ${id}` }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }],
      },
      ...Array.from({ length: 48 }, (_, index) => ({
        type: 'paragraph',
        content: [{ type: 'text', text: `Detail scroll line ${index + 1}` }],
      })),
    ],
  },
  deletedAt: null,
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-detail@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [taskSummary(7, 'First browser task'), taskSummary(8, 'Second browser task')],
      }),
    })
  );
  await page.route('**/api/v1/tasks/*', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (id === 404) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (id === 500) {
      await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(taskDetail(id)),
    });
  });
});

test('selects tasks, supports history, opens the canonical page, and preserves the resized split', async ({
  page,
}) => {
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'All Tasks' })).toBeVisible();

  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=7$/);
  await expect(page.getByRole('heading', { name: 'Task 7 detail' })).toBeVisible();
  await expect(page.getByTestId('task-detail-pane').getByText('TASK-7')).toBeVisible();
  await expect(page.getByText('Description for task 7')).toBeVisible();
  await page.screenshot({ path: '/tmp/horizon-issue19-task-detail-desktop.png', fullPage: false });
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('[role="img"], img')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /archive|delete/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open TASK-8: Second browser task' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=8$/);
  await expect(page.getByRole('heading', { name: 'Task 8 detail' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/tasks\?task=8$/);
  await expect(page.getByRole('heading', { name: 'Task 8 detail' })).toBeVisible();

  const separator = page.getByRole('separator', { name: 'Resize task list and details' });
  const initial = await separator.boundingBox();
  if (!initial) throw new Error('Task splitter is not visible at desktop width');
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  const afterKeyboard = await separator.boundingBox();
  if (!afterKeyboard) throw new Error('Task splitter disappeared after keyboard resize');
  expect(afterKeyboard.x).toBeGreaterThan(initial.x);
  await page.mouse.move(afterKeyboard.x + 2, 400);
  await page.mouse.down();
  await page.mouse.move(afterKeyboard.x + 42, 400);
  await page.mouse.up();
  const listWidth = await page
    .getByTestId('task-list-pane')
    .evaluate((element) => element.getBoundingClientRect().width);
  const detailWidth = await page
    .getByTestId('task-detail-pane')
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(listWidth).toBeGreaterThanOrEqual(480);
  expect(detailWidth).toBeGreaterThanOrEqual(360);
  const retainedRatio = await separator.getAttribute('aria-valuenow');

  await page.getByRole('button', { name: 'Open full page' }).click();
  await expect(page).toHaveURL(/\/tasks\/8$/);
  await expect(page.getByRole('heading', { name: 'Task 8 detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=8$/);
  const retainedSeparator = page.getByRole('separator', { name: 'Resize task list and details' });
  await expect(retainedSeparator).toHaveAttribute('aria-valuenow', retainedRatio ?? '60');
});

test('uses the modal drawer below 845px workspace width and closes by Escape, backdrop, and Close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=7$/);
  const dialog = page.getByRole('dialog', { name: 'Task details' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('separator')).toHaveCount(0);
  const scrollRegion = dialog.locator('div.overflow-y-auto').last();
  const initialScrollTop = await scrollRegion.evaluate((element) => element.scrollTop);
  await scrollRegion.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(initialScrollTop);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);
  await scrollRegion.evaluate((element) => element.scrollTo({ top: 0 }));
  await dialog.getByRole('button', { name: 'Close task details' }).first().focus();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);

  await page.goForward();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 400);
  await expect(page).toHaveURL(/\/tasks$/);

  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?task=7$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/tasks\?task=7$/);
  await dialog.getByRole('button', { name: 'Close task details' }).first().click();
  await expect(page).toHaveURL(/\/tasks$/);

  await page.setViewportSize({ width: 900, height: 720 });
  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);

  await page.setViewportSize({ width: 800, height: 720 });
  await page.getByRole('button', { name: 'Open TASK-7: First browser task' }).click();
  await expect(dialog).toBeVisible();
  const workspace = page.getByTestId('task-split-view');
  const workspaceBox = await workspace.boundingBox();
  const dialogBox = await dialog.boundingBox();
  const backdropBox = await page.getByTestId('task-overlay-backdrop').boundingBox();
  if (!workspaceBox || !dialogBox || !backdropBox) throw new Error('Overlay geometry unavailable');
  expect(dialogBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
  expect(dialogBox.y).toBeGreaterThanOrEqual(workspaceBox.y);
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(workspaceBox.x + workspaceBox.width);
  expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(workspaceBox.y + workspaceBox.height);
  expect(backdropBox.x).toBeGreaterThanOrEqual(workspaceBox.x);
  expect(backdropBox.y).toBeGreaterThanOrEqual(workspaceBox.y);
  expect(backdropBox.x + backdropBox.width).toBeLessThanOrEqual(
    workspaceBox.x + workspaceBox.width
  );
  expect(backdropBox.y + backdropBox.height).toBeLessThanOrEqual(
    workspaceBox.y + workspaceBox.height
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(800);
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/\/tasks$/);
});

test('deep loads the panel and canonical page, and distinguishes private missing details from retryable failures', async ({
  page,
}) => {
  let missingRequests = 0;
  let serverRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/tasks/404')) missingRequests += 1;
    if (request.url().endsWith('/api/v1/tasks/500')) serverRequests += 1;
  });
  await page.goto('/tasks?task=7');
  await expect(page.getByRole('heading', { name: 'Task 7 detail' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Task 7 detail' })).toBeVisible();

  await page.goto('/tasks/7');
  await expect(page.getByRole('heading', { name: 'Task 7 detail' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Task 7 detail' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks$/);

  for (const invalidId of ['TASK-7', '0', '-1', '9007199254740993']) {
    await page.goto(`/tasks/${invalidId}`);
    await expect(page.getByRole('alert')).toContainText('task is unavailable');
  }

  await page.goto('/tasks/404');
  await expect(page.getByRole('alert')).toContainText('task is unavailable');
  await expect.poll(() => missingRequests).toBe(1);

  await page.goto('/tasks/500');
  const retry = page.getByRole('button', { name: 'Retry task details' });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => serverRequests).toBe(2);
});
