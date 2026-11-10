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
