import { expect, test, type Page, type Route } from '@playwright/test';

type Note = {
  id: number;
  title: string;
  content: Record<string, unknown>;
  tags: Array<{ id: number; name: string }>;
  version: number;
  inbox: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const time = '2026-11-21T10:00:00Z';

function doc(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

async function installApi(page: Page) {
  const notes = new Map<number, Note>([
    [
      1,
      {
        id: 1,
        title: 'Lifecycle active note',
        content: doc('Initial content'),
        tags: [],
        version: 4,
        inbox: false,
        archivedAt: null,
        createdAt: time,
        updatedAt: time,
        deletedAt: null,
      },
    ],
    [
      2,
      {
        id: 2,
        title: 'Lifecycle archived note',
        content: doc('Archived content'),
        tags: [],
        version: 6,
        inbox: false,
        archivedAt: time,
        createdAt: time,
        updatedAt: time,
        deletedAt: null,
      },
    ],
  ]);
  const mutations: Array<{ method: string; path: string; expectedVersion: string | null }> = [];
  let failNextDelete = false;
  let failNextNoteGet = false;
  let conflictNextDelete = false;
  let conflictNextArchive = false;
  let conflictNextUpdate = false;
  let failNextUpdate = false;
  let pendingUpdate: { promise: Promise<void>; release: () => void } | null = null;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'notes@example.test' }),
    })
  );
  await page.route(/\/api\/v1\/notes(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    const url = new URL(route.request().url());
    const collection = url.searchParams.get('collection') ?? 'active';
    const visible = [...notes.values()].filter(
      (note) =>
        note.deletedAt === null &&
        (collection === 'archived' ? note.archivedAt !== null : note.archivedAt === null)
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: visible.map(({ content, deletedAt: _deletedAt, ...item }) => ({
          ...item,
          preview: content,
        })),
        page: 0,
        size: 20,
        hasNext: false,
        counts: {
          active: [...notes.values()].filter((note) => !note.deletedAt && !note.archivedAt).length,
          archived: [...notes.values()].filter((note) => !note.deletedAt && !!note.archivedAt)
            .length,
        },
      }),
    });
  });
  await page.route('**/api/v1/notes/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const id = Number(path.split('/')[4]);
    const method = route.request().method();
    const current = notes.get(id);
    if (!current || (current.deletedAt && !path.endsWith('/restore-deleted'))) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (method === 'GET') {
      if (failNextNoteGet) {
        failNextNoteGet = false;
        await route.fulfill({ status: 503, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const { deletedAt: _deletedAt, ...response } = current;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
      return;
    }
    const expectedVersion =
      route.request().headers()['x-expected-version'] ??
      (method === 'PATCH'
        ? String((route.request().postDataJSON() as { expectedVersion?: number }).expectedVersion)
        : null);
    mutations.push({ method, path, expectedVersion });
    if (path.endsWith('/archive') && conflictNextArchive) {
      conflictNextArchive = false;
      await route.fulfill({ status: 409, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    if (method === 'DELETE' && failNextDelete) {
      failNextDelete = false;
      await route.abort('timedout');
      return;
    }
    if (method === 'DELETE' && conflictNextDelete) {
      conflictNextDelete = false;
      await route.fulfill({ status: 409, contentType: 'application/problem+json', body: '{}' });
      return;
    }

    if (method === 'PATCH') {
      if (conflictNextUpdate) {
        conflictNextUpdate = false;
        current.archivedAt = '2026-11-21T10:02:00Z';
        current.version += 1;
        await route.fulfill({ status: 409, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      if (failNextUpdate) {
        failNextUpdate = false;
        await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
        return;
      }
      const gate = pendingUpdate;
      pendingUpdate = null;
      if (gate) await gate.promise;
      const body = route.request().postDataJSON() as Partial<Note>;
      current.title = body.title ?? current.title;
      current.content = body.content ?? current.content;
    }

    current.version += 1;
    current.updatedAt = '2026-11-21T10:01:00Z';
    if (path.endsWith('/archive')) current.archivedAt = current.updatedAt;
    if (path.endsWith('/restore')) current.archivedAt = null;
    if (path.endsWith('/restore-deleted')) current.deletedAt = null;
    if (method === 'DELETE') current.deletedAt = current.updatedAt;
    if (method === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id, version: current.version }),
      });
    } else {
      const { deletedAt: _deletedAt, ...response } = current;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }
  });

  return {
    mutations,
    failNextDelete: () => (failNextDelete = true),
    failNextNoteGet: () => (failNextNoteGet = true),
    conflictNextDelete: () => (conflictNextDelete = true),
    conflictNextArchive: () => (conflictNextArchive = true),
    conflictNextUpdate: () => (conflictNextUpdate = true),
    failNextUpdate: () => (failNextUpdate = true),
    holdNextUpdate: () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => (release = resolve));
      pendingUpdate = { promise, release };
      return release;
    },
  };
}

test('archives from a Card and restores the same Note with persistent Undo', async ({ page }) => {
  const api = await installApi(page);
  await page.goto('/notes');
  await expect(page.getByRole('button', { name: 'Active 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archived 1' })).toBeVisible();

  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByRole('status')).toContainText('Note 1 archived');
  await expect(page.getByRole('button', { name: 'Active 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Archived 2' })).toBeVisible();
  expect(api.mutations).toEqual([
    { method: 'POST', path: '/api/v1/notes/1/archive', expectedVersion: '4' },
  ]);

  await page.getByRole('button', { name: 'Undo Note 1 archive' }).click();
  await expect(page.getByRole('button', { name: 'Active 1' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lifecycle active note' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Note updates' })).toHaveCount(0);
});

test('updates the editor lifecycle controls when archive Undo restores the Note', async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto('/notes/1');
  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore from Archive' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo Note 1 archive' }).click();

  await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore from Archive' })).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Note title' }).fill('Lifecycle note edited after Undo');
  await expect
    .poll(() => api.mutations.at(-1))
    .toEqual({
      method: 'PATCH',
      path: '/api/v1/notes/1',
      expectedVersion: '6',
    });

  await page
    .getByRole('button', { name: 'More actions for Lifecycle note edited after Undo' })
    .click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  expect(api.mutations).toEqual([
    { method: 'POST', path: '/api/v1/notes/1/archive', expectedVersion: '4' },
    { method: 'POST', path: '/api/v1/notes/1/restore', expectedVersion: '5' },
    { method: 'PATCH', path: '/api/v1/notes/1', expectedVersion: '6' },
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '7' },
  ]);
});

test('keeps editor autosave held after an uncertain Delete until the receipt retry completes', async ({
  page,
}) => {
  const api = await installApi(page);
  api.failNextDelete();
  await page.goto('/notes/1');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();

  await expect(page.getByRole('button', { name: 'Retry delete for Note 1' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry delete for Note 1' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ''))
    .toContain('Active');
  expect(api.mutations.filter((mutation) => mutation.method === 'DELETE')).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);
});

test('recovers an uncertain editor Delete after a 409 using a readable Note and preserves its draft', async ({
  page,
}) => {
  const api = await installApi(page);
  api.failNextDelete();
  api.conflictNextDelete();
  await page.goto('/notes/1');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Draft saved before Delete');
  await expect
    .poll(() => api.mutations.at(-1))
    .toEqual({ method: 'PATCH', path: '/api/v1/notes/1', expectedVersion: '4' });

  await page.getByRole('button', { name: 'More actions for Draft saved before Delete' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await page.getByRole('button', { name: 'Retry delete for Note 1' }).click();

  await expect(title).toBeEnabled();
  await expect(title).toHaveValue('Draft saved before Delete');
  await expect(page.getByRole('region', { name: 'Note updates' })).toHaveCount(0);
  await title.fill('Edited after safe recovery');
  await expect
    .poll(() => api.mutations.at(-1))
    .toEqual({ method: 'PATCH', path: '/api/v1/notes/1', expectedVersion: '5' });
  expect(api.mutations.filter((mutation) => mutation.method === 'DELETE')).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '5' },
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '5' },
  ]);
});

test('keeps autosave paused when reconciliation GET fails and offers a status-only recheck', async ({
  page,
}) => {
  const api = await installApi(page);
  api.failNextDelete();
  api.conflictNextDelete();
  await page.goto('/notes/1');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  api.failNextNoteGet();
  await page.getByRole('button', { name: 'Retry delete for Note 1' }).click();

  const pausedMessage = page.getByRole('alert').filter({ hasText: 'Editing remains paused' });
  await expect(pausedMessage).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Note title' });
  await expect(title).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check note status' })).toBeVisible();
  expect(api.mutations.filter((mutation) => mutation.method === 'PATCH')).toHaveLength(0);
  expect(api.mutations.filter((mutation) => mutation.method === 'DELETE')).toHaveLength(2);

  await page.getByRole('button', { name: 'Back to Notes' }).click();
  const cardActions = page.getByRole('button', { name: 'More actions for Lifecycle active note' });
  await expect(cardActions).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check note status' })).toBeVisible();
  await page.getByRole('button', { name: 'Check note status' }).click();
  await expect(cardActions).toBeEnabled();
  const noteLink = page.getByRole('link', { name: 'Lifecycle active note' });
  await expect(noteLink).toBeVisible();
  await noteLink.click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Check note status' })).toHaveCount(0);
  expect(api.mutations.filter((mutation) => mutation.method === 'DELETE')).toHaveLength(2);
});

test('keeps an exact-version editor receipt retry available after dismissing uncertain Delete notice', async ({
  page,
}) => {
  const api = await installApi(page);
  api.failNextDelete();
  await page.goto('/notes/1');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();

  const notice = page.getByRole('region', { name: 'Note updates' });
  await expect(notice).toContainText("Couldn't confirm moving Note 1 to Trash");
  await page.getByRole('button', { name: 'Dismiss Note 1 notice' }).click();
  await expect(notice).toHaveCount(0);
  const title = page.getByRole('textbox', { name: 'Note title' });
  await expect(title).toBeDisabled();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeEnabled();

  await retry.click();
  await expect(page).toHaveURL(/\/notes$/);
  expect(api.mutations.filter((mutation) => mutation.method === 'DELETE')).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);
});

test('requires Trash confirmation, returns to the workspace, then restores by receipt version', async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto('/notes');
  await page.getByRole('link', { name: 'Lifecycle active note' }).click();
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Lifecycle active note'
  );

  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Move note to Trash?' });
  await expect(dialog).toContainText('remain recoverable from Trash');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(api.mutations).toHaveLength(0);

  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.textContent ?? ''))
    .toContain('Active');
  await expect(page.getByRole('status')).toContainText('Note 1 moved to Trash');
  expect(api.mutations).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);

  await page.getByRole('button', { name: 'Undo Note 1 delete' }).click();
  await expect(page.getByRole('heading', { name: 'Lifecycle active note' })).toBeVisible();
  expect(api.mutations.at(-1)).toEqual({
    method: 'POST',
    path: '/api/v1/notes/1/restore-deleted',
    expectedVersion: '5',
  });
});

test('keeps a timed-out delete unconfirmed and retries at the original version', async ({
  page,
}) => {
  const api = await installApi(page);
  api.failNextDelete();
  await page.goto('/notes/1');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Move to Trash' }).click();

  await expect(
    page
      .getByRole('region', { name: 'Note updates' })
      .getByText("Couldn't confirm moving Note 1 to Trash")
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo Note 1 delete' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes\/1$/);
  await page.getByRole('button', { name: 'Retry delete for Note 1' }).click();
  await expect(page.getByRole('button', { name: 'Undo Note 1 delete' })).toBeVisible();
  expect(api.mutations).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);
});

test('surfaces version conflicts for review without rebasing the lifecycle request', async ({
  page,
}) => {
  const api = await installApi(page);
  api.conflictNextArchive();
  await page.goto('/notes');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();

  await expect(page.getByRole('alert')).toContainText('This note changed elsewhere');
  expect(api.mutations).toEqual([
    { method: 'POST', path: '/api/v1/notes/1/archive', expectedVersion: '4' },
  ]);
  await expect(page.getByRole('heading', { name: 'Lifecycle active note' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Note updates' })).toHaveCount(0);
});

test('a DELETE 409 stays a visible conflict and never becomes an unconfirmed-delete notice', async ({
  page,
}) => {
  const api = await installApi(page);
  api.conflictNextDelete();
  await page.goto('/notes');
  await page.getByRole('button', { name: 'More actions for Lifecycle active note' }).click();
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Move Lifecycle active note to Trash?' });
  await dialog.getByRole('button', { name: 'Move to Trash' }).click();

  await expect(dialog).toContainText('changed elsewhere');
  await expect(page.getByRole('region', { name: 'Note updates' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo Note 1 delete' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry delete for Note 1' })).toHaveCount(0);
  expect(api.mutations).toEqual([
    { method: 'DELETE', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);
});

test('Load latest conflict recovery updates archived metadata without remounting the editor', async ({
  page,
}) => {
  const api = await installApi(page);
  api.conflictNextUpdate();
  await page.goto('/notes/1');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Local draft to replace');
  await expect(page.getByRole('region', { name: 'Version conflict' })).toBeVisible();
  await page.getByRole('button', { name: 'Load latest version' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();

  await expect(title).toHaveValue('Lifecycle active note');
  await expect(page.getByRole('button', { name: 'Restore from Archive' })).toBeVisible();
  await page.getByRole('button', { name: 'Restore from Archive' }).click();
  expect(api.mutations).toEqual([
    { method: 'PATCH', path: '/api/v1/notes/1', expectedVersion: '4' },
    { method: 'POST', path: '/api/v1/notes/1/restore', expectedVersion: '5' },
  ]);
});

test('waits for delayed editor autosave and uses the acknowledged version to Archive', async ({
  page,
}) => {
  const api = await installApi(page);
  const releaseSave = api.holdNextUpdate();
  await page.goto('/notes/1');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Updated before archive');
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect.poll(() => api.mutations.length).toBe(1);
  expect(api.mutations[0]).toEqual({
    method: 'PATCH',
    path: '/api/v1/notes/1',
    expectedVersion: '4',
  });

  releaseSave();
  await expect(page.getByRole('status')).toContainText('Note 1 archived');
  expect(api.mutations[1]).toEqual({
    method: 'POST',
    path: '/api/v1/notes/1/archive',
    expectedVersion: '5',
  });
  await expect(page).toHaveURL(/\/notes\/1$/);
  await expect(title).toHaveValue('Updated before archive');
});

test('does not dispatch Archive when the editor save fails', async ({ page }) => {
  const api = await installApi(page);
  api.failNextUpdate();
  await page.goto('/notes/1');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Unsaved title stays in the editor');
  await page.getByRole('button', { name: 'Archive' }).click();

  await expect(title).toHaveValue('Unsaved title stays in the editor');
  await expect.poll(() => api.mutations.length).toBe(1);
  expect(api.mutations).toEqual([
    { method: 'PATCH', path: '/api/v1/notes/1', expectedVersion: '4' },
  ]);
  await expect(page).toHaveURL(/\/notes\/1$/);
});
