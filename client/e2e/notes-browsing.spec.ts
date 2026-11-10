import { expect, test, type Page } from '@playwright/test';

type NoteSummary = {
  id: number;
  title: string | null;
  preview: Record<string, unknown> | null;
  tags: Array<{ id: number; name: string }>;
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

function summary(
  id: number,
  collection: 'active' | 'archived',
  title?: string,
  ownerId = 1,
  ownerLabels = false
): NoteSummary {
  return {
    id,
    title:
      title ??
      (ownerLabels ? `Owner ${ownerId} note ${id}` : `Note ${String(id).padStart(3, '0')}`),
    preview:
      id === 1
        ? {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: 'Preview heading' }],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `${'A long note preview. '.repeat(2_000)}${'X'.repeat(400)}`,
                  },
                ],
              },
            ],
          }
        : richText(id === 7 ? '<img src=x onerror=alert(1)>' : `Preview for ${id}`),
    version: 1,
    tags: [],
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

async function installNotesApi(page: Page, initialOwner = 1, archivedCount = 3) {
  let ownerId = initialOwner;
  let ownerLabels = false;
  let nextUserGate: Promise<void> | null = null;
  let failNextUserRequest = false;
  const listRequests: Array<{ collection: string; sort: string; page: number; size: number }> = [];
  const listOwners: number[] = [];
  const detailRequests: number[] = [];
  const writes: string[] = [];
  const createdNotes: NoteSummary[] = [];
  const changedNotes = new Map<number, NoteDetail>();

  await page.route('**/api/v1/users/me', async (route) => {
    if (nextUserGate !== null) {
      const gate = nextUserGate;
      nextUserGate = null;
      await gate;
    }
    if (failNextUserRequest) {
      failNextUserRequest = false;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: ownerId, email: `owner-${ownerId}@example.test` }),
    });
  });

  // Match the collection endpoint before the item endpoint. The collection path is exact.
  await page.route(/\/api\/v1\/notes(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        title: string | null;
        content: Record<string, unknown> | null;
      };
      const id = 900 + createdNotes.length;
      const item = summary(id, 'active', body.title ?? 'Untitled note', ownerId, ownerLabels);
      createdNotes.unshift(item);
      const created = { ...item, content: body.content };
      changedNotes.set(id, created);
      writes.push('POST');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(created),
      });
      return;
    }
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
    listOwners.push(ownerId);

    const all =
      collection === 'archived'
        ? Array.from({ length: archivedCount }, (_, index) =>
            summary(201 + index, 'archived', undefined, ownerId, ownerLabels)
          )
        : Array.from({ length: 40 }, (_, index) =>
            summary(index + 1, 'active', undefined, ownerId, ownerLabels)
          );
    if (collection === 'active') all.unshift(...createdNotes);
    for (const [id, updated] of changedNotes) {
      const index = all.findIndex((item) => item.id === id);
      if (index >= 0)
        all[index] = { ...all[index]!, title: updated.title, updatedAt: updated.updatedAt };
    }
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
        counts: { active: 40 + createdNotes.length, archived: 3 },
      }),
    });
  });

  await page.route('**/api/v1/notes/*', async (route) => {
    const url = new URL(route.request().url());
    const rawId = url.pathname.split('/').at(-1) ?? '';
    if (route.request().method() !== 'GET') {
      const id = Number(rawId);
      const current = changedNotes.get(id) ?? detail(id, ownerId);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const updated = {
        ...current,
        ...body,
        version: current.version + 1,
        updatedAt: timestamps.updatedAt,
      } as NoteDetail;
      changedNotes.set(id, updated);
      const item = createdNotes.find((note) => note.id === id);
      if (item) item.title = updated.title;
      writes.push(route.request().method());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(updated),
      });
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
    const found = changedNotes.get(id) ?? detail(id, ownerId);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(found),
    });
  });

  return {
    listRequests,
    listOwners,
    detailRequests,
    writes,
    setOwner: (id: number) => {
      ownerId = id;
    },
    enableOwnerLabels: () => {
      ownerLabels = true;
    },
    holdNextUserResponse: () => {
      let release!: () => void;
      nextUserGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    failNextUserResponse: () => {
      failNextUserRequest = true;
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
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(/Owner 1 note/);
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);
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

test('keeps paginated pages and browse scroll after a long detail visit', async ({ page }) => {
  const api = await installNotesApi(page);
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Note 020' })).toBeVisible();
  await page.getByRole('button', { name: 'Load more notes' }).click();
  await expect(page.getByRole('heading', { name: 'Note 040' })).toBeVisible();

  const main = page.locator('main');
  await main.evaluate((element) => {
    element.scrollTop = 320;
  });
  await page.getByRole('link', { name: /Note 040/ }).evaluate((element) => {
    (element as HTMLAnchorElement).click();
  });
  await expect(page).toHaveURL(/\/notes\/40$/);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Owner 1 note 40');
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(0);

  await page.clock.fastForward(5 * 60 * 1000 + 1);
  await page.goBack();
  await expect(page).toHaveURL(/\/notes\/?$/);
  await expect(page.getByRole('heading', { name: 'Note 040' })).toBeVisible();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBe(320);
  expect(api.listRequests).toHaveLength(2);
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

test('supports direct editor routes and keeps an untouched /notes/new draft empty', async ({
  page,
}) => {
  const api = await installNotesApi(page);
  await page.goto('/notes/7');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('Owner 1 note 7');
  await expect(page.getByLabel('Note content editor')).toContainText(
    '<img src=x onerror=alert(1)>'
  );
  await expect(page.locator('img')).toHaveCount(0);

  await page.goto('/notes/404');
  await expect(page.getByRole('heading', { name: 'Note unavailable' })).toBeVisible();
  await page.goto('/notes/not-a-number');
  await expect(page.getByRole('heading', { name: 'Note unavailable' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Note editor coming next' })).toHaveCount(0);

  await page.goto('/notes/new');
  await expect(page).toHaveURL(/\/notes\/new$/);
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('');
  await expect(page.getByLabel('Note content editor')).toBeVisible();
  await expect(page.getByText('Not saved yet')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Notes' }).click();
  await expect(page).toHaveURL(/\/notes\/?$/);
  expect(api.detailRequests).toEqual([7, 404]);
  expect(api.writes).toEqual([]);
});

test('refreshes the saved Notes list and count after creating a note without a reload', async ({
  page,
}) => {
  const api = await installNotesApi(page);
  await page.goto('/notes');
  await expect(page.getByRole('button', { name: 'Active 40' })).toBeVisible();
  await page.getByRole('link', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('Created without reload');
  await expect(page).toHaveURL(/\/notes\/900$/);
  await page.getByRole('button', { name: 'Back to Notes' }).click();

  await expect(page.getByRole('heading', { name: 'Created without reload' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Active 41' })).toBeVisible();
  expect(api.listRequests.length).toBeGreaterThan(1);
});

test('keeps the same editor instance through same-owner focus verification', async ({ page }) => {
  const api = await installNotesApi(page);
  await page.goto('/notes/7');
  const editor = page.getByLabel('Note content editor');
  const before = await editor.elementHandle();
  await editor.click();

  const releaseVerification = api.holdNextUserResponse();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Verifying session…').first()).toBeVisible();
  await expect(page.getByTestId('private-content')).toHaveAttribute('aria-hidden', 'true');
  releaseVerification();

  await expect(page.getByTestId('private-content')).toHaveAttribute('aria-hidden', 'false');
  expect(await editor.evaluate((current, prior) => current === prior, before)).toBe(true);
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

test('restores the same-owner Notes workspace after focus verification', async ({ page }) => {
  const api = await installNotesApi(page, 1, 40);
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Archived' }).click();
  await page.getByRole('button', { name: 'Load more notes' }).click();
  await page.getByLabel('Sort notes').selectOption('title_asc');
  await page.getByRole('button', { name: 'List' }).click();
  await page.getByRole('button', { name: 'Load more notes' }).click();

  const main = page.locator('main');
  await main.evaluate((element) => {
    element.scrollTop = 650;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(600);
  const scrollBeforeVerification = await main.evaluate((element) => element.scrollTop);
  const requestCountBeforeVerification = api.listRequests.length;
  const releaseVerification = api.holdNextUserResponse();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  const privateContent = page.getByTestId('private-content');
  await expect(page.getByText('Verifying session…').first()).toBeVisible();
  await expect(privateContent).toHaveAttribute('aria-hidden', 'true');
  await expect(privateContent).toHaveCSS('visibility', 'hidden');
  releaseVerification();

  await expect(privateContent).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('list', { name: 'Notes list' }).getByRole('link')).toHaveCount(40);
  await expect(page.getByRole('button', { name: 'Archived' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Sort notes')).toHaveValue('title_asc');
  await expect
    .poll(() => main.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(scrollBeforeVerification - 2);
  expect(api.listRequests).toHaveLength(requestCountBeforeVerification);
});

test('restores browsing state and scroll after retryable session verification failure', async ({
  page,
}) => {
  const api = await installNotesApi(page, 1, 40);
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Archived' }).click();
  await page.getByRole('button', { name: 'Load more notes' }).click();
  await page.getByRole('button', { name: 'List' }).click();
  const main = page.locator('main');
  await main.evaluate((element) => {
    element.scrollTop = 520;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(480);

  const releaseFailure = api.holdNextUserResponse();
  api.failNextUserResponse();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Verifying session…').first()).toBeVisible();
  const privateContent = page.getByTestId('private-content');
  await expect(privateContent).toHaveAttribute('aria-hidden', 'true');
  releaseFailure();

  await expect(page.getByRole('alert')).toContainText("couldn't verify your session");
  await expect(privateContent).toHaveAttribute('aria-hidden', 'true');
  await expect(privateContent.getByText('Preview for 201')).toBeHidden();
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(480);
  await page.getByRole('button', { name: 'Retry session verification' }).click();

  await expect(privateContent).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('list', { name: 'Notes list' }).getByRole('link')).toHaveCount(40);
  await expect(page.getByRole('button', { name: 'Archived' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(480);
});

test('resets Notes browse state and content when verification changes owners', async ({ page }) => {
  const api = await installNotesApi(page, 1, 40);
  api.enableOwnerLabels();
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');
  await page.getByRole('button', { name: 'Archived' }).click();
  await page.getByRole('button', { name: 'List' }).click();
  await page.getByLabel('Sort notes').selectOption('title_asc');
  await page.getByRole('button', { name: 'Load more notes' }).click();
  await expect(page.getByText('Owner 1 note 240')).toBeVisible();

  api.setOwner(2);
  const releaseVerification = api.holdNextUserResponse();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const privateContent = page.getByTestId('private-content');
  await expect(privateContent).toHaveAttribute('aria-hidden', 'true');
  await expect(privateContent).toHaveCSS('visibility', 'hidden');
  releaseVerification();

  await expect(privateContent).toHaveAttribute('aria-hidden', 'false');
  await expect(page.getByRole('heading', { name: 'Owner 2 note 1', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owner 1 note 240', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Active' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(page.getByRole('button', { name: 'Cards' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Sort notes')).toHaveValue('updated_desc');
  expect(api.listRequests.at(-1)).toMatchObject({
    collection: 'active',
    sort: 'updated_desc',
    page: 0,
  });
  expect(api.listOwners.at(-1)).toBe(2);
});

test('keeps the current scroll position when Load More appends a page', async ({ page }) => {
  await installNotesApi(page);
  await page.setViewportSize({ width: 1440, height: 420 });
  await page.goto('/notes');
  await expect(page.getByRole('heading', { name: 'Note 020' })).toBeVisible();
  const main = page.locator('main');
  await main.evaluate((element) => {
    element.scrollTop = 360;
  });
  await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(340);
  const scrollBeforeLoadMore = await main.evaluate((element) => element.scrollTop);

  await page.getByRole('button', { name: 'Load more notes' }).evaluate((element) => {
    (element as HTMLButtonElement).click();
  });
  await expect(page.getByRole('heading', { name: 'Note 040' })).toBeVisible();
  await expect
    .poll(() => main.evaluate((element) => element.scrollTop))
    .toBeGreaterThanOrEqual(scrollBeforeLoadMore - 2);
});

test('applies Notes preview typography and height in the browser cascade', async ({ page }) => {
  await installNotesApi(page);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.goto('/notes');
  const firstCard = page.getByRole('list', { name: 'Notes cards' }).locator('li').first();
  const title = firstCard.locator('h2');
  const preview = firstCard.locator('.note-preview');
  const previewHeading = preview.locator('h1');
  const previewParagraph = preview.locator('p');
  const previewFrame = preview.locator('xpath=..');

  await expect(title).toHaveCSS('font-size', '18px');
  await expect(previewParagraph).toHaveCSS('font-size', '16px');
  await expect(previewHeading).not.toHaveCSS('font-size', '56px');
  await expect(previewHeading).toHaveCSS('margin-block-start', '6px');
  await expect(previewFrame).toHaveCSS('max-height', '240px');
  expect(
    await firstCard.evaluate((element) => element.getBoundingClientRect().height)
  ).toBeLessThanOrEqual(440);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(600);

  await page.setViewportSize({ width: 601, height: 900 });
  await expect(previewFrame).toHaveCSS('max-height', '265px');
  const lightColors = await Promise.all([
    title.evaluate((element) => getComputedStyle(element).color),
    previewParagraph.evaluate((element) => getComputedStyle(element).color),
  ]);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const darkColors = await Promise.all([
    title.evaluate((element) => getComputedStyle(element).color),
    previewParagraph.evaluate((element) => getComputedStyle(element).color),
  ]);
  expect(darkColors[0]).not.toBe(darkColors[1]);
  expect(darkColors[0]).not.toBe(lightColors[0]);
  expect(darkColors[1]).not.toBe(lightColors[1]);
  expect([...lightColors, ...darkColors].every((color) => color !== 'transparent')).toBe(true);
});
