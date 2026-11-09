import { expect, test, type Page } from '@playwright/test';

type NoteSummary = {
  id: number;
  title: string | null;
  preview: Record<string, unknown> | null;
  version: number;
  inbox: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type NoteDetail = Omit<NoteSummary, 'preview'> & { content: Record<string, unknown> | null };

const timestamps = {
  createdAt: '2026-11-08T10:00:00Z',
  updatedAt: '2026-11-09T10:00:00Z',
};

function richText(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

function summary(id: number, collection: 'active' | 'archived', title?: string): NoteSummary {
  return {
    id,
    title: title ?? `Note ${String(id).padStart(3, '0')}`,
    preview: richText(
      id === 7
        ? '<img src=x onerror=alert(1)>'
        : id === 1
          ? 'A long note preview. '.repeat(2_000)
          : `Preview for ${id}`
    ),
    version: 1,
    inbox: false,
    archivedAt: collection === 'archived' ? timestamps.updatedAt : null,
    ...timestamps,
  };
}

function detail(id: number, ownerId: number): NoteDetail {
  const note = summary(id, id >= 200 ? 'archived' : 'active', `Owner ${ownerId} note ${id}`);
  const { preview: _preview, ...rest } = note;
  return {
    ...rest,
    content: richText(
      id === 7 ? '<img src=x onerror=alert(1)>' : `Private content for owner ${ownerId}.`
    ),
  };
}

async function installNotesApi(page: Page, initialOwner = 1) {
  let ownerId = initialOwner;
  const listRequests: Array<{ collection: string; sort: string; page: number; size: number }> = [];
  const detailRequests: number[] = [];
  const writes: string[] = [];

  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: ownerId, email: `owner-${ownerId}@example.test` }),
    });
  });

  // Match the collection endpoint before the item endpoint. The collection path is exact.
  await page.route(/\/api\/v1\/notes(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') {
      writes.push(route.request().method());
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    const url = new URL(route.request().url());
    const collection = url.searchParams.get('collection') ?? 'active';
    const sort = url.searchParams.get('sort') ?? 'updated_desc';
    const pageNumber = Number(url.searchParams.get('page') ?? 0);
    const size = Number(url.searchParams.get('size') ?? 20);
    listRequests.push({ collection, sort, page: pageNumber, size });

    const all =
      collection === 'archived'
        ? Array.from({ length: 3 }, (_, index) => summary(201 + index, 'archived'))
        : Array.from({ length: 40 }, (_, index) => summary(index + 1, 'active'));
    if (sort === 'title_asc') all.reverse();
    const items = all.slice(pageNumber * size, (pageNumber + 1) * size);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        page: pageNumber,
        size,
        hasNext: (pageNumber + 1) * size < all.length,
        counts: { active: 40, archived: 3 },
      }),
    });
  });

  await page.route('**/api/v1/notes/*', async (route) => {
    const url = new URL(route.request().url());
    const rawId = url.pathname.split('/').at(-1) ?? '';
    if (route.request().method() !== 'GET') {
      writes.push(route.request().method());
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    if (!/^\d+$/.test(rawId)) {
      await route.fallback();
      return;
    }
    const id = Number(rawId);
    detailRequests.push(id);
    if (id === 404) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail(id, ownerId)),
    });
  });

  return {
    listRequests,
    detailRequests,
    writes,
    setOwner: (id: number) => {
      ownerId = id;
    },
  };
}

test('browses pages and restores collection, sort, view, and scroll on Back', async ({ page }) => {
  const api = await installNotesApi(page);
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');

  await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Note 001' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Note 020' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Note 021' })).toHaveCount(0);
  await expect(page.getByText('<img src=x onerror=alert(1)>')).toBeVisible();
  await expect(page.locator('img')).toHaveCount(0);
  expect(api.listRequests[0]).toEqual({
    collection: 'active',
    sort: 'updated_desc',
    page: 0,
    size: 20,
  });

  await page.getByRole('button', { name: 'Load more notes' }).click();
  await expect(page.getByRole('heading', { name: 'Note 040' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more notes' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Archived' }).click();
  await expect(page.getByRole('heading', { name: 'Note 201' })).toBeVisible();
  await page.getByLabel('Sort notes').selectOption('title_asc');
  await page.getByRole('button', { name: 'List' }).click();
  const main = page.locator('main');
  await main.evaluate((element) => {
    element.scrollTop = 140;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  const noteLink = page.getByRole('link', { name: /Owner|Note 203/ }).first();
  await noteLink.click();
  await expect(page).toHaveURL(/\/notes\/20[1-3]$/);
  await expect(page.getByRole('heading', { name: /Owner 1 note/ })).toBeVisible();
  expect(api.detailRequests).toHaveLength(1);

  await page.goBack();
  await expect(page).toHaveURL(/\/notes\/?$/);
  await expect(page.getByRole('button', { name: 'Archived' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Sort notes')).toHaveValue('title_asc');
  await expect(page.getByRole('list', { name: 'Notes list' }).getByRole('link')).toHaveCount(3);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Active' }).click();
  await expect(page.getByRole('link', { name: /Note 040/ })).toBeVisible();
  expect(api.listRequests.filter((request) => request.collection === 'active')).toHaveLength(3);
  expect(api.listRequests.at(-1)).toMatchObject({
    collection: 'active',
    sort: 'title_asc',
    page: 0,
  });
});

test('persists only the view for one owner and handles blocked storage', async ({ page }) => {
  const api = await installNotesApi(page);
  await page.goto('/notes');
  await page.getByRole('button', { name: 'List' }).click();
  await page.getByRole('button', { name: 'Archived' }).click();
  await page.getByLabel('Sort notes').selectOption('title_asc');
  await page.reload();
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Active' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByLabel('Sort notes')).toHaveValue('updated_desc');

  api.setOwner(2);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');

  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage blocked', 'SecurityError');
      },
    });
  });
  await page.reload();
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /Note 001/ })).toBeVisible();
});

test('supports direct read routes and keeps /notes/new inert', async ({ page }) => {
  const api = await installNotesApi(page);
  await page.goto('/notes/7');
  await expect(page.getByRole('heading', { name: 'Owner 1 note 7' })).toBeVisible();
  await expect(page.getByLabel('Note content')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img')).toHaveCount(0);

  await page.goto('/notes/404');
  await expect(page.getByRole('heading', { name: 'Note unavailable' })).toBeVisible();
  await page.goto('/notes/not-a-number');
  await expect(page.getByRole('heading', { name: 'Note unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Note editor coming next' })).toHaveCount(0);

  await page.goto('/notes/new');
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect(page.getByRole('heading', { name: 'Note editor coming next' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Notes' }).click();
  await expect(page).toHaveURL(/\/notes\/?$/);
  expect(api.detailRequests).toEqual([7, 404]);
  expect(api.writes).toEqual([]);
});

test('keeps the card grid responsive, compact, bounded, and keyboard navigable', async ({
  page,
}) => {
  await installNotesApi(page);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Note 001' })).toBeVisible();

  const grid = page.getByRole('list', { name: 'Notes cards' });
  for (const [width, columns] of [
    [600, 1],
    [601, 2],
    [1220, 2],
    [1221, 3],
    [1599, 3],
    [1600, 4],
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length)
      )
      .toBe(columns);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  }

  const firstCard = grid.locator('li').first().getByRole('link');
  await firstCard.focus();
  await expect(firstCard).toBeFocused();
  expect(
    await firstCard.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeLessThanOrEqual(440);
  expect(
    await grid
      .locator('li')
      .nth(1)
      .evaluate((element) => element.getBoundingClientRect().height)
  ).toBeLessThan(440);
});
