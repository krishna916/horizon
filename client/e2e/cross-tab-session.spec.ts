import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

type User = { id: number; email: string };
type Task = {
  id: number;
  key: string;
  title: string;
  priority: null;
  dueDate: null;
  inbox: false;
  completedAt: null;
  archivedAt: null;
  createdAt: string;
  updatedAt: string;
  tags: [];
  description: { type: 'doc'; content: Array<Record<string, unknown>> } | null;
  deletedAt: null;
  checklist: [];
};
type MeResponse = 'normal' | 'unauthorized' | 'unavailable' | 'deferred';

const markerKey = 'horizon:auth-session-change:v1';

function task(id: number, title: string, note: string): Task {
  return {
    id,
    key: `TASK-${id}`,
    title,
    priority: null,
    dueDate: null,
    inbox: false,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    tags: [],
    description: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: note }] }],
    },
    deletedAt: null,
    checklist: [],
  };
}

class MockSession {
  userId: number | null = 1;
  readonly tasksByUser = new Map<number, Task[]>([
    [1, [task(41, 'Account A private task', 'Account A saved note')]],
    [2, [task(92, 'Account B task', 'Account B note')]],
  ]);
  private readonly meResponses = new WeakMap<Page, MeResponse[]>();
  private deferredMe: { started: () => void; release: () => void } | null = null;

  queueMeResponse(page: Page, response: MeResponse) {
    const responses = this.meResponses.get(page) ?? [];
    responses.push(response);
    this.meResponses.set(page, responses);
  }

  pauseNextMe() {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const releasePromise = new Promise<void>((resolve) => (release = resolve));
    this.deferredMe = { started, release };
    return { started: startedPromise, releasePromise };
  }

  async install(page: Page) {
    await page.route('**/api/v1/**', async (route) => this.handle(route, page));
  }

  private async handle(route: Route, page: Page) {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    const method = route.request().method();

    if (path === '/users/me' && method === 'GET') {
      const response = this.meResponses.get(page)?.shift() ?? 'normal';
      if (response === 'deferred') {
        const deferred = this.deferredMe;
        if (!deferred) throw new Error('No deferred /users/me response was prepared');
        this.deferredMe = null;
        deferred.started();
        await new Promise<void>((resolve) => {
          const release = deferred.release;
          this.releaseMe = () => {
            release();
            resolve();
          };
        });
      } else if (response === 'unauthorized') {
        await route.fulfill({ status: 401, contentType: 'application/problem+json', body: '{}' });
        return;
      } else if (response === 'unavailable') {
        await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      await this.fulfillCurrentUser(route);
      return;
    }

    if (path === '/auth/login' && method === 'POST') {
      const body = route.request().postDataJSON() as { email: string };
      this.userId = body.email === 'account-b@example.com' ? 2 : 1;
      await this.fulfillCurrentUser(route);
      return;
    }

    if (path === '/auth/logout' && method === 'POST') {
      this.userId = null;
      await route.fulfill({ status: 204 });
      return;
    }

    if (path === '/tasks' && method === 'GET') {
      const items = (this.userId === null ? [] : (this.tasksByUser.get(this.userId) ?? [])).map(
        ({ description: _description, deletedAt: _deletedAt, checklist: _checklist, ...item }) =>
          item
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items }),
      });
      return;
    }

    const taskMatch = /^\/tasks\/(\d+)$/.exec(path);
    if (taskMatch && method === 'GET') {
      const id = Number(taskMatch[1]);
      const found =
        this.userId === null
          ? undefined
          : this.tasksByUser.get(this.userId)?.find((item) => item.id === id);
      await route.fulfill({
        status: found ? 200 : 404,
        contentType: found ? 'application/json' : 'application/problem+json',
        body: JSON.stringify(found ?? {}),
      });
      return;
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  }

  private releaseMe: (() => void) | null = null;

  releaseDeferredMe() {
    const release = this.releaseMe;
    if (!release) throw new Error('No deferred /users/me response is pending');
    this.releaseMe = null;
    release();
  }

  private async fulfillCurrentUser(route: Route) {
    if (this.userId === null) {
      await route.fulfill({ status: 401, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    const user: User = {
      id: this.userId,
      email: this.userId === 1 ? 'account-a@example.com' : 'account-b@example.com',
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  }
}

async function openPair(context: BrowserContext, session: MockSession) {
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([session.install(first), session.install(second)]);
  return { first, second };
}

async function loginAsB(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('account-b@example.com');
  await page.getByRole('textbox', { name: 'Password' }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test('switches the receiving tab from A to B without showing A task data or its draft', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const session = new MockSession();
  const { first, second } = await openPair(context, session);
  await first.goto('/tasks?task=41');
  await expect(first.getByText('Account A private task').first()).toBeVisible();
  await expect(first.getByText('Account A saved note')).toBeVisible();
  await expect(first.getByText('account-a@example.com')).toBeVisible();
  await first.getByRole('button', { name: 'Edit task description' }).click();
  const editor = first.getByLabel('Task description editor');
  await editor.fill('A unsaved private draft');
  await expect(editor).toContainText('A unsaved private draft');

  const paused = session.pauseNextMe();
  session.queueMeResponse(first, 'deferred');
  await loginAsB(second);
  await paused.started;

  const privateShell = first.getByTestId('private-content');
  await expect(privateShell).toHaveAttribute('aria-hidden', 'true');
  await expect(first.getByRole('status').filter({ visible: true }).last()).toContainText(
    'Verifying session'
  );
  await expect(first.getByText('Account A private task').first()).toBeHidden();
  await expect(first.getByText('Account A saved note')).toBeHidden();
  await expect(first.getByText('account-a@example.com')).toBeHidden();
  await expect(first.getByLabel('Task description editor')).toBeHidden();

  session.releaseDeferredMe();
  await expect(first).toHaveURL(/\/tasks$/);
  await expect(first.getByText('Account B task')).toBeVisible();
  await expect(first.getByText('account-b@example.com')).toBeVisible();
  await expect(first.getByText('A unsaved private draft')).toHaveCount(0);
  await expect(second.getByText('account-b@example.com')).toBeVisible();
  await context.close();
});

test('receiving tab hides A and routes to Login after logout in the other tab', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const session = new MockSession();
  const { first, second } = await openPair(context, session);
  await first.goto('/tasks');
  await second.goto('/tasks');
  await expect(first.getByText('account-a@example.com')).toBeVisible();
  await expect(second.getByText('account-a@example.com')).toBeVisible();

  await second.getByRole('button', { name: 'Sign out' }).click();

  await expect(first).toHaveURL(/\/login$/);
  await expect(second).toHaveURL(/\/login$/);
  await expect(first.getByText('account-a@example.com')).toHaveCount(0);
  await context.close();
});

test('recovers a marker missed while the tab was suspended when focus returns', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const session = new MockSession();
  const { first, second } = await openPair(context, session);
  await first.goto('/tasks');
  await second.goto('/tasks');
  await expect(first.getByText('account-a@example.com')).toBeVisible();

  session.userId = 2;
  await first.evaluate((key) => localStorage.setItem(key, 'missed-while-suspended'), markerKey);
  await second.bringToFront();
  await first.bringToFront();
  await first.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(first.getByText('account-b@example.com')).toBeVisible();
  await expect(first.getByText('Account B task')).toBeVisible();
  await context.close();
});

test('keeps a selected route through /me 503 and retry when the new owner can access it', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const session = new MockSession();
  session.tasksByUser.set(2, [task(41, 'Shared task for B', 'Shared note')]);
  const { first, second } = await openPair(context, session);
  await first.goto('/tasks?task=41');
  await second.goto('/tasks');
  await expect(first.getByText('Account A saved note')).toBeVisible();

  session.userId = 2;
  session.queueMeResponse(first, 'unavailable');
  await second.evaluate((key) => localStorage.setItem(key, 'retry-session'), markerKey);
  await expect(first.getByRole('alert')).toContainText("couldn't verify your session");
  await expect(first).toHaveURL(/\/tasks\?task=41$/);
  await expect(first.getByText('Account A private task').first()).toBeHidden();

  await first.getByRole('button', { name: 'Retry session verification' }).click();
  await expect(first.getByText('Shared note')).toBeVisible();
  await expect(first).toHaveURL(/\/tasks\?task=41$/);
  await expect(first.getByText('account-b@example.com')).toBeVisible();
  await context.close();
});
