import { expect, test, type Page, type Route } from '@playwright/test';

const timestamps = {
  createdAt: '2026-11-10T10:00:00Z',
  updatedAt: '2026-11-10T10:00:00Z',
};

async function installEmptyNotesApi(page: Page) {
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  let created: Record<string, unknown> | null = null;
  const tags = [{ id: 41, name: 'Research' }];

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 41, email: 'notes-tags@example.test' }),
    })
  );
  await page.route(/\/api\/v1\/notes(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: created ? [created] : [],
          page: 0,
          size: 20,
          hasNext: false,
          counts: { active: created ? 1 : 0, archived: 0 },
        }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/v1/tags/suggestions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: tags }),
    })
  );
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ method: 'POST', body });
    created = {
      id: 941,
      title: body.title,
      content: body.content,
      tags,
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
    if (route.request().method() === 'GET' && created) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  return { requests, getCreated: () => created };
}

async function stageResearchTag(page: Page) {
  const input = page.getByRole('combobox', { name: 'Add tags' });
  await input.fill('Res');
  await page.getByRole('option', { name: 'Research' }).click();
}

function noteDetail(
  title: string | null,
  content: unknown,
  tags: Array<{ id: number; name: string }>,
  version: number
) {
  return {
    id: 941,
    title,
    content,
    tags,
    version,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
}

function richDocument(text: string) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

async function installExistingNoteApi(
  page: Page,
  options: { initial: ReturnType<typeof noteDetail>; latest?: ReturnType<typeof noteDetail> }
) {
  const patches: Array<Record<string, unknown>> = [];
  let detailReads = 0;
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 41, email: 'notes-tags@example.test' }),
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
  await page.route('**/api/v1/tags/suggestions**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ id: 42, name: 'Planning' }] }),
    })
  );
  await page.route('**/api/v1/notes/941', async (route: Route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      const note = detailReads++ === 0 ? options.initial : (options.latest ?? options.initial);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(note),
      });
      return;
    }
    if (request.method() !== 'PATCH') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    patches.push(body);
    if (patches.length === 1 && options.latest) {
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'Note version conflict' }),
      });
      return;
    }
    if (patches.length === 1) {
      await route.fulfill({
        status: 400,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          title: 'Validation Failed',
          errors: { tags: ['One selected Tag is no longer available.'] },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        noteDetail(
          typeof body.title === 'string' ? body.title : options.initial.title,
          body.content ?? options.initial.content,
          [{ id: 42, name: 'Planning' }],
          2
        )
      ),
    });
  });
  return { patches };
}

test('Notes Tags stay keeps tag-only drafts local, then creates and reloads canonical Tags', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await installEmptyNotesApi(page);
  await page.goto('/notes/new');

  await stageResearchTag(page);
  await page.clock.fastForward(1_200);
  expect(fixture.requests).toHaveLength(0);

  await page.getByRole('button', { name: 'Back to Notes' }).click();
  await expect(page.getByRole('dialog')).toContainText('Tags');
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByRole('combobox', { name: 'Add tags' })).toBeVisible();
  await expect(page.getByText('Research').first()).toBeVisible();
  expect(fixture.requests).toHaveLength(0);

  await page.getByLabel('Note content editor').click();
  await page.keyboard.type('A note with a shared Tag');
  await expect(page).toHaveURL(/\/notes\/941$/);
  await expect.poll(() => fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.body).toMatchObject({
    title: null,
    tags: [{ id: 41 }],
  });
  expect(fixture.getCreated()).toMatchObject({ tags: [{ id: 41, name: 'Research' }] });

  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove tag Research' })).toBeVisible();
});

test('Notes Tags discard leaves without creating a Note or Tag association', async ({ page }) => {
  await page.clock.install();
  const fixture = await installEmptyNotesApi(page);
  await page.goto('/notes/new');

  await stageResearchTag(page);
  await page.getByRole('button', { name: 'Back to Notes' }).click();
  await expect(page.getByRole('dialog')).toContainText('Tags');
  await page.getByRole('button', { name: 'Discard Tags and Leave' }).click();
  await expect(page).toHaveURL(/\/notes$/);
  await page.clock.fastForward(1_200);
  expect(fixture.requests).toHaveLength(0);
});

test('Notes Tags keep the draft after a Tag validation error and retry only after correction', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await installExistingNoteApi(page, {
    initial: noteDetail('Original title', richDocument('Original body'), [], 1),
  });
  await page.goto('/notes/941');
  const tagInput = page.getByRole('combobox', { name: 'Add tags' });
  await tagInput.fill('Broken');
  await page.getByRole('option', { name: /Add tag.*Broken/ }).click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('Updated title');
  const editor = page.getByLabel('Note content editor');
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Updated body');
  await page.clock.fastForward(1_100);

  await expect(page.getByRole('alert')).toContainText('One selected Tag is no longer available.');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Updated title');
  await expect(editor).toContainText('Updated body');
  await expect(page.getByRole('button', { name: 'Remove tag Broken' })).toBeVisible();
  expect(fixture.patches).toHaveLength(1);
  expect(fixture.patches[0]).toMatchObject({ tags: [{ name: 'Broken' }] });

  await page.getByRole('button', { name: 'Remove tag Broken' }).click();
  await tagInput.fill('Plan');
  await page.getByRole('option', { name: 'Planning' }).click();
  await page.clock.fastForward(1_100);
  expect(fixture.patches).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => fixture.patches).toHaveLength(2);
  expect(fixture.patches[1]).toMatchObject({
    expectedVersion: 1,
    title: 'Updated title',
    tags: [{ id: 42 }],
  });
  await expect(page.getByText('Saved')).toBeVisible();
});

test('Notes Tags Load latest displays canonical names after a confirmed version conflict', async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await installExistingNoteApi(page, {
    initial: noteDetail(
      'Original title',
      richDocument('Original body'),
      [{ id: 41, name: 'Research' }],
      1
    ),
    latest: noteDetail(
      'Latest title',
      richDocument('Latest body'),
      [{ id: 42, name: 'Planning' }],
      2
    ),
  });
  await page.goto('/notes/941');
  await page.getByRole('textbox', { name: 'Note title' }).fill('My local title');
  await page.clock.fastForward(1_100);

  await expect(page.getByRole('region', { name: 'Version conflict' })).toBeVisible();
  expect(fixture.patches).toHaveLength(1);
  await page.getByRole('button', { name: 'Load latest version' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();

  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Latest title');
  await expect(page.getByRole('button', { name: 'Remove tag Planning' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove tag Tag 42' })).toHaveCount(0);
  expect(fixture.patches).toHaveLength(1);
});
