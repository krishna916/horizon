import { expect, test } from '@playwright/test';

const timestamps = {
  createdAt: '2026-11-09T10:00:00Z',
  updatedAt: '2026-11-09T10:01:00Z',
};

function document(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

test('creates a title-only note from the full-page editor and replaces the route in place', async ({
  page,
}) => {
  await page.clock.install();
  let created: Record<string, unknown> | null = null;
  let createCount = 0;

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'owner@example.test' }),
    })
  );
  await page.route(/\/api\/v1\/notes(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [],
        page: 0,
        size: 20,
        hasNext: false,
        counts: { active: 0, archived: 0 },
      }),
    })
  );
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    createCount += 1;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    created = {
      id: 501,
      title: body.title,
      content: body.content,
      version: 1,
      inbox: false,
      archivedAt: null,
      ...timestamps,
    };
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify(created),
    });
  });
  await page.route('**/api/v1/notes/*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET' && created) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/notes');
  await page.getByRole('link', { name: 'New note' }).click();
  const title = page.getByRole('textbox', { name: 'Note title' });
  const editor = page.getByLabel('Note content editor');
  await expect(title).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(page.getByText('Not saved yet')).toBeVisible();
  await page.clock.fastForward(1_100);
  expect(createCount).toBe(0);

  const editorBeforeCreate = await editor.elementHandle();
  await title.fill('A title only');
  await expect(title).toHaveValue('A title only');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page).toHaveURL(/\/notes\/501$/);
  expect(createCount).toBe(1);
  expect(created).toMatchObject({ title: 'A title only', content: null });
  const editorAfterCreate = page.getByLabel('Note content editor');
  expect(
    await editorAfterCreate.evaluate((current, prior) => current === prior, editorBeforeCreate)
  ).toBe(true);

  await page.getByRole('button', { name: 'Back to Notes' }).click();
  await expect(page).toHaveURL(/\/notes$/);
});

test('saves rich body content while leaving an empty title nullable', async ({ page }) => {
  let postBody: Record<string, unknown> | null = null;
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 2, email: 'owner-two@example.test' }),
    })
  );
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    postBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 502,
        ...postBody,
        version: 1,
        inbox: false,
        archivedAt: null,
        ...timestamps,
      }),
    });
  });
  await page.route('**/api/v1/notes/*', async (route) => {
    await route.fulfill({ status: 404, body: '' });
  });

  await page.goto('/notes/new');
  const editor = page.getByLabel('Note content editor');
  await editor.click();
  await page.keyboard.type('Body only');
  await expect(page).toHaveURL(/\/notes\/502$/);
  expect(postBody).toMatchObject({ title: null, content: document('Body only') });
});

test('blocks workspace navigation while the note draft is dirty and lets the user stay', async ({
  page,
}) => {
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 3, email: 'owner-three@example.test' }),
    })
  );
  await page.route('**/api/v1/notes', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 503,
        title: 'Pending title',
        content: null,
        version: 1,
        inbox: false,
        archivedAt: null,
        ...timestamps,
      }),
    })
  );

  await page.goto('/notes/new');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Pending title');
  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsaved changes');
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Pending title');
});

test('discards an unsent draft before signing out without dispatching a write', async ({
  page,
}) => {
  await page.clock.install();
  let logoutCount = 0;
  let writeCount = 0;
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 4, email: 'owner-four@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    writeCount += 1;
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/notes/new');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Keep me unless confirmed');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsent changes');
  expect(logoutCount).toBe(0);

  await page.getByRole('button', { name: 'Discard unsent changes and sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
  await page.clock.fastForward(1_000);
  expect(writeCount).toBe(0);
});

test('warns that an issued PATCH may save and waits before signing out', async ({ page }) => {
  await page.clock.install();
  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => {
    releasePatch = resolve;
  });
  let logoutCount = 0;
  let patchCount = 0;
  const existing = {
    id: 601,
    title: 'Before',
    content: null,
    version: 2,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 6, email: 'owner-six@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/601', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(existing),
      });
      return;
    }
    patchCount += 1;
    await patchGate;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...existing, title: 'After', version: 3 }),
    });
  });

  await page.goto('/notes/601');
  await page.getByRole('textbox', { name: 'Note title' }).fill('After');
  await page.clock.fastForward(900);
  await expect.poll(() => patchCount).toBe(1);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('may still be applied');
  await expect(page.getByRole('button', { name: /Discard/ })).toHaveCount(0);
  expect(logoutCount).toBe(0);

  const saveAndSignOut = page.getByRole('button', { name: 'Wait for save and sign out' });
  await saveAndSignOut.click();
  releasePatch();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
});
