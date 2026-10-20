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
  const editor = page.locator('[aria-label="Title"]');
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

test('saves a dirty title before continuing to the original sidebar route after a deferred PATCH', async ({
  page,
}) => {
  const tasks = [task(1, 'First browser task'), task(2, 'Second browser task')];
  const details = new Map<number, TaskDetail>(
    tasks.map((item) => [item.id, { ...item, description: null, deletedAt: null }])
  );
  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => (releasePatch = resolve));
  let patchCount = 0;
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
      patchCount += 1;
      await patchGate;
      const body = route.request().postDataJSON() as Partial<TaskDetail>;
      const updated = { ...details.get(id)!, ...body };
      details.set(id, updated);
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
  await page.getByRole('button', { name: 'Task title: First browser task' }).dblclick();
  await page.getByRole('textbox', { name: 'Title' }).fill('Updated before leaving');
  await page.getByRole('link', { name: 'Notes' }).click();
  await page.getByRole('button', { name: 'Save and continue' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Saving field…');
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect.poll(() => patchCount).toBe(1);

  releasePatch();
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  expect(patchCount).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?task=1$/);
  await expect(
    page.getByRole('button', { name: 'Task title: Updated before leaving' })
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);
});

for (const direction of ['back', 'forward'] as const) {
  test(`saves a dirty title before ${direction} after a deferred PATCH`, async ({ page }) => {
    const details = new Map<number, TaskDetail>([
      [1, { ...task(1, 'History task'), description: null, deletedAt: null }],
    ]);
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => (releasePatch = resolve));
    let patchCount = 0;
    await page.route('**/api/v1/users/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 1, email: 'task-edit@example.com' }),
      })
    );
    await page.route('**/api/v1/tasks', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [...details.values()] }),
      })
    );
    await page.route('**/api/v1/tasks/1', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchCount += 1;
        await patchGate;
        const body = route.request().postDataJSON() as Partial<TaskDetail>;
        const updated = { ...details.get(1)!, ...body };
        details.set(1, updated);
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
        body: JSON.stringify(details.get(1)),
      });
    });

    if (direction === 'back') {
      await page.goto('/tasks');
      await page.getByRole('button', { name: 'Open TASK-1: History task' }).click();
    } else {
      await page.goto('/tasks?task=1');
      await page.getByRole('link', { name: 'Notes' }).click();
      await expect(page).toHaveURL(/\/notes$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/tasks\?task=1$/);
    }
    await page.getByRole('button', { name: 'Task title: History task' }).dblclick();
    await page.getByRole('textbox', { name: 'Title' }).fill(`Saved after ${direction}`);
    const traversal = direction === 'back' ? page.goBack() : page.goForward();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Saving field…');
    await expect(page).toHaveURL(direction === 'back' ? /\/tasks$/ : /\/notes$/);
    await expect.poll(() => patchCount).toBe(1);

    releasePatch();
    await traversal;
    await expect(page).toHaveURL(direction === 'back' ? /\/tasks$/ : /\/notes$/);
    await expect(page.getByRole('alertdialog')).toBeHidden();
    if (direction === 'back') {
      await expect(
        page.getByRole('button', { name: 'Open TASK-1: Saved after back' })
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close task details' })).toHaveCount(0);
    } else {
      await expect(page.getByRole('main').getByRole('heading', { name: 'Notes' })).toBeVisible();
    }
    expect(patchCount).toBe(1);
  });
}

test('title edit preserves the read-mode geometry and typography in Chromium', async ({ page }) => {
  const tasks = [task(1, 'A long task title that should wrap naturally within the detail pane')];
  const detail = { ...tasks[0]!, description: null, deletedAt: null };
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-edit@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: tasks }),
    })
  );
  await page.route('**/api/v1/tasks/1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    })
  );
  await page.setViewportSize({ width: 800, height: 720 });
  await page.goto('/tasks');
  await page.getByRole('button', { name: /Open TASK-1:/ }).click();
  const readTitle = page.getByRole('button', { name: `Task title: ${detail.title}` });
  const readBox = await readTitle.boundingBox();
  const readStyle = await readTitle.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontFamily: style.fontFamily,
    };
  });
  await readTitle.dblclick();
  const editor = page.getByRole('textbox', { name: 'Title' });
  const editorBox = await editor.boundingBox();
  const editStyle = await editor.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      fontFamily: style.fontFamily,
    };
  });
  expect(Math.abs(editorBox!.x - readBox!.x)).toBeLessThan(1);
  expect(Math.abs(editorBox!.y - readBox!.y)).toBeLessThan(1);
  expect(Math.abs(editorBox!.width - readBox!.width)).toBeLessThan(1);
  expect(Math.abs(editorBox!.height - readBox!.height)).toBeLessThanOrEqual(1);
  expect(editStyle).toEqual(readStyle);
  await expect(page.getByRole('heading', { name: detail.title })).toBeVisible();
  await expect(editor).toBeFocused();

  await editor.fill(
    'A long task title that should wrap naturally within the detail pane '.repeat(3)
  );
  const heightBeforeResize = await editor.evaluate((element) => element.clientHeight);
  await page.setViewportSize({ width: 480, height: 720 });
  await expect
    .poll(async () => editor.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(heightBeforeResize);
  await expect
    .poll(async () => {
      const metrics = await editor.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      return metrics.clientHeight >= metrics.scrollHeight - 1;
    })
    .toBe(true);
});

test('title edit preserves whitespace and wrapping for multiline titles', async ({ page }) => {
  const title = 'First part of the title\nSecond part of the title';
  const detail = { ...task(1, title), description: null, deletedAt: null };
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-edit@example.com' }),
    })
  );
  await page.route('**/api/v1/tasks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [detail] }),
    })
  );
  await page.route('**/api/v1/tasks/1', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail),
    })
  );

  await page.goto('/tasks?task=1');
  const readTitle = page.getByRole('button', { name: `Task title: ${title}` });
  const readBox = await readTitle.boundingBox();
  const readWhiteSpace = await readTitle.evaluate(
    (element) => getComputedStyle(element).whiteSpace
  );
  await readTitle.dblclick();
  const editor = page.getByRole('textbox', { name: 'Title' });
  const editBox = await editor.boundingBox();
  const editWhiteSpace = await editor.evaluate((element) => getComputedStyle(element).whiteSpace);

  expect(Math.abs(editBox!.x - readBox!.x)).toBeLessThan(1);
  expect(Math.abs(editBox!.y - readBox!.y)).toBeLessThan(1);
  expect(Math.abs(editBox!.width - readBox!.width)).toBeLessThan(1);
  expect(editWhiteSpace).toBe(readWhiteSpace);
  expect(Math.abs(editBox!.height - readBox!.height)).toBeLessThan(2);
});
