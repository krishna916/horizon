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

async function installApi(
  page: Page,
  initial: TaskDetail[] = []
): Promise<{
  items: TaskSummary[];
  details: Map<number, TaskDetail>;
  creates: CreatePayload[];
  patches: Array<{ taskId: number; patch: Partial<TaskDetail> }>;
  failNextPatch: () => void;
}> {
  const items = initial.map(
    ({ description: _description, deletedAt: _deletedAt, checklist: _checklist, ...item }) => item
  );
  const details = new Map(initial.map((task) => [task.id, task]));
  const creates: CreatePayload[] = [];
  const patches: Array<{ taskId: number; patch: Partial<TaskDetail> }> = [];
  let nextPatchFails = false;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'rich-description@example.com' }),
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

    const payload = route.request().postDataJSON() as CreatePayload;
    creates.push(payload);
    const taskSummary = summary(41, payload.title, {
      priority: payload.priority ?? null,
      dueDate: payload.dueDate ?? null,
    });
    const created = detail(taskSummary, payload.description ?? null);
    items.unshift(taskSummary);
    details.set(created.id, created);
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });
  await page.route('**/api/v1/tasks/*', async (route) => {
    const taskId = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    const current = details.get(taskId);
    if (!current) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON() as Partial<TaskDetail>;
      patches.push({ taskId, patch });
      if (nextPatchFails) {
        nextPatchFails = false;
        await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const updated = { ...current, ...patch, updatedAt: '2026-10-24T12:00:00Z' };
      details.set(taskId, updated);
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
      body: JSON.stringify(current),
    });
  });

  return { items, details, creates, patches, failNextPatch: () => (nextPatchFails = true) };
}

async function pastePlainText(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, value);
}

const richMarkdown = `### Launch notes

Intro paragraph with **bold text** and [documentation](https://example.com/docs).

- First bullet
- Nested bullet
  - Child bullet
- Second bullet

1. First ordered item
2. Second ordered item

\`\`\`ts
const ready = true;
\`\`\`

| Area | Status |
| --- | --- |
| Build | Ready |

---`;

test('creates structured Markdown, reloads it, and renders the same content in panel and page', async ({
  page,
}) => {
  const fixture = await installApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Active…' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Task browser document');
  const editor = '[aria-label="Description (optional) editor"]';
  await page.locator(editor).waitFor();
  await pastePlainText(page, editor, richMarkdown);

  await expect(page.locator(`${editor} h3`)).toHaveText('Launch notes');
  await expect
    .poll(() =>
      page
        .locator(`${editor} ul, ${editor} ol`)
        .evaluateAll((lists) => lists.map((list) => getComputedStyle(list).listStyleType))
    )
    .toEqual(['disc', 'disc', 'decimal']);
  await page.locator(editor).press('Control+z');
  await expect(page.locator(`${editor} h3`)).toHaveCount(0);
  await page.locator(editor).press('Control+Shift+z');
  await expect(page.locator(`${editor} h3`)).toHaveText('Launch notes');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  const pane = page.getByTestId('task-detail-pane');
  await expect(pane.getByRole('heading', { name: 'Task browser document' })).toBeVisible();
  await expect(pane.getByRole('heading', { name: 'Launch notes', level: 3 })).toBeVisible();
  await expect(pane.getByText('First bullet')).toBeVisible();
  await expect
    .poll(() =>
      pane
        .locator('.rich-text-content ul, .rich-text-content ol')
        .evaluateAll((lists) => lists.map((list) => getComputedStyle(list).listStyleType))
    )
    .toEqual(['disc', 'disc', 'decimal']);
  await expect(pane.locator('pre')).toContainText('const ready = true;');
  await expect(pane.getByRole('table')).toBeVisible();
  await expect(pane.locator('hr')).toHaveCount(1);
  const link = pane.getByRole('link', { name: 'documentation' });
  await expect(link).toHaveAttribute('href', 'https://example.com/docs');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener noreferrer/);
  await expect(page.getByTestId('task-list-pane').getByText('First bullet')).toHaveCount(0);
  expect(fixture.creates).toHaveLength(1);
  expect(fixture.creates[0]?.description).toMatchObject({ type: 'doc' });

  await page.reload();
  await expect(
    page.getByTestId('task-detail-pane').getByRole('heading', { name: 'Launch notes' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open full page' }).click();
  await expect(page).toHaveURL(/\/tasks\/41$/);
  await expect(page.getByRole('heading', { name: 'Launch notes', level: 3 })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.locator('pre')).toContainText('const ready = true;');
});

test('description editing is explicit, guarded, cancellable, and retryable after a failed save', async ({
  page,
}) => {
  const task = detail(summary(77, 'Existing rich task'), {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Saved notes' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Visit ' },
          {
            type: 'text',
            text: 'documentation',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }],
          },
        ],
      },
    ],
  });
  const fixture = await installApi(page, [task]);
  await page.goto('/tasks?task=77');
  const readView = page.getByRole('button', { name: 'Edit task description' });
  const safeLink = page.getByRole('link', { name: 'documentation' });
  await expect(safeLink).toHaveAttribute('target', '_blank');
  await safeLink.click({ modifiers: ['Alt'] });
  await expect(page.getByLabel('Task description editor')).toHaveCount(0);
  await readView.dblclick();

  const editor = '[aria-label="Task description editor"]';
  await page.locator(editor).waitFor();
  await page.locator(editor).press('Control+a');
  await pastePlainText(page, editor, 'Cancelled draft');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Saved notes')).toBeVisible();
  expect(fixture.patches).toHaveLength(0);

  await page.getByRole('button', { name: 'Edit task description' }).dblclick();
  await page.locator(editor).waitFor();
  await page.locator(editor).press('Control+a');
  await pastePlainText(page, editor, 'Keep this draft after a failed save');
  await page.getByRole('button', { name: 'Priority: No priority' }).click();
  await expect(page.locator(editor)).toBeVisible();
  expect(fixture.patches).toHaveLength(0);

  fixture.failNextPatch();
  const failedPatch = page.waitForResponse((response) => response.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await failedPatch).status()).toBe(500);
  await expect.poll(() => fixture.patches.length).toBe(1);
  await expect(page.locator(editor)).toBeVisible();
  await expect(page.locator(editor)).toContainText('Keep this draft after a failed save');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit task description' })).toBeVisible();
  expect(fixture.patches).toHaveLength(2);
  expect(fixture.patches[1]?.patch.description).toEqual(fixture.patches[0]?.patch.description);
  await expect(page.getByText('Keep this draft after a failed save')).toBeVisible();

  await page.getByRole('button', { name: 'Open full page' }).click();
  await page.getByRole('button', { name: 'Edit task description' }).dblclick();
  await page.locator(editor).waitFor();
  await page.locator(editor).press('Control+a');
  await pastePlainText(page, editor, 'Guarded draft');
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  const guard = page.getByRole('alertdialog');
  await expect(guard).toContainText('unsaved changes');
  await guard.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/tasks\/77$/);
  await expect(page.locator(editor)).toBeVisible();
  await page.getByRole('button', { name: 'Back to Tasks' }).click();
  await page.getByRole('button', { name: 'Discard and continue' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=77$/);
  await expect(page.getByLabel('Task description editor')).toHaveCount(0);
  expect(fixture.patches).toHaveLength(2);
});

test('keyboard activates an empty description and completed archived tasks remain editable', async ({
  page,
}) => {
  const completedArchived = detail(
    summary(88, 'Completed archived task', {
      completedAt: '2026-10-22T10:00:00Z',
      archivedAt: '2026-10-23T10:00:00Z',
    })
  );
  await installApi(page, [completedArchived]);
  await page.goto('/tasks?task=88');

  const placeholder = page.getByRole('button', { name: 'Add description…' });
  await placeholder.focus();
  await page.keyboard.press('Enter');
  const editor = page.getByLabel('Task description editor');
  await expect(editor).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('button', { name: 'Add description…' }).focus();
  await page.keyboard.press('Space');
  await expect(editor).toBeVisible();
  await editor.fill('Completed task notes');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: 'Edit task description' })).toBeVisible();
  await expect(page.getByText('Completed task notes')).toBeVisible();
});
