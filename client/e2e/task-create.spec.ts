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
  return { ...task, description, deletedAt: null };
}

async function installStatefulTaskApi(
  page: Page,
  {
    initialTasks = [],
    failFirstPost = false,
  }: { initialTasks?: TaskSummary[]; failFirstPost?: boolean } = {}
) {
  const items = [...initialTasks];
  const details = new Map(initialTasks.map((task) => [task.id, detail(task)]));
  const requests: Array<{ payload: CreatePayload; requestKey: string; body: string }> = [];
  const creationsByRequestKey = new Map<string, TaskDetail>();
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'task-create@example.com' }),
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

    const request = route.request();
    const requestKey = request.headers()['idempotency-key'] ?? '';
    const payload = request.postDataJSON() as CreatePayload;
    requests.push({ payload, requestKey, body: request.postData() ?? '' });
    const replay = creationsByRequestKey.get(requestKey);
    if (replay) {
      await route.fulfill({
        status: 201,
        headers: { Location: `/api/v1/tasks/${replay.id}` },
        contentType: 'application/json',
        body: JSON.stringify(replay),
      });
      return;
    }

    const id = 41;
    const createdSummary = summary(id, payload.title, {
      priority: payload.priority ?? null,
      dueDate: payload.dueDate ?? null,
    });
    const createdDetail = detail(createdSummary, payload.description ?? null);
    details.set(id, createdDetail);
    items.unshift(createdSummary);
    if (requestKey) creationsByRequestKey.set(requestKey, createdDetail);
    if (failFirstPost && requests.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: 201,
      headers: { Location: `/api/v1/tasks/${id}` },
      contentType: 'application/json',
      body: JSON.stringify(createdDetail),
    });
  });
  await page.route('**/api/v1/tasks/*', async (route) => {
    const match = new URL(route.request().url()).pathname.match(/\/api\/v1\/tasks\/(\d+)$/);
    if (route.request().method() !== 'GET' || !match) {
      await route.fallback();
      return;
    }
    const task = details.get(Number(match[1]));
    if (!task) {
      await route.fulfill({ status: 404, contentType: 'application/problem+json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(task),
    });
  });
  return { items, requests };
}

test('creates one Active task and replaces the create entry with its detail panel', async ({
  page,
}) => {
  const fixture = await installStatefulTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Activeâ€¦' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  const title = page.getByRole('textbox', { name: 'Title' });
  await expect(title).toBeFocused();
  await title.fill('Prepare the launch notes');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Prepare the launch notes' })).toBeVisible();
  await expect(page.getByTestId('task-detail-pane').getByText('TASK-41')).toBeVisible();
  expect(fixture.requests).toHaveLength(1);
  expect(fixture.requests[0]?.requestKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  expect(fixture.requests[0]?.payload).toEqual({ title: 'Prepare the launch notes' });
  expect(fixture.items[0]).toMatchObject({
    id: 41,
    title: 'Prepare the launch notes',
    key: 'TASK-41',
    inbox: false,
  });

  await page.goBack();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(
    page.getByRole('button', { name: 'Open TASK-41: Prepare the launch notes' })
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
});

test('retries an ambiguous create with the frozen payload and request key', async ({ page }) => {
  const fixture = await installStatefulTaskApi(page, { failFirstPost: true });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Activeâ€¦' }).click();
  const title = page.getByRole('textbox', { name: 'Title' });
  const description = page.getByRole('textbox', { name: 'Description (optional)' });
  await title.fill('Recover the submitted draft');
  await description.fill('Keep these details unchanged.');
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText(
    'could not confirm whether this task was created'
  );
  expect(fixture.items).toHaveLength(1);
  expect(fixture.items[0]).toMatchObject({ id: 41, key: 'TASK-41' });
  await expect(title).toBeDisabled();
  await expect(description).toBeDisabled();
  await page.getByRole('button', { name: 'Retry creation' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=41$/);
  await expect(page.getByRole('heading', { name: 'Recover the submitted draft' })).toBeVisible();
  await expect(page.getByTestId('task-detail-pane').getByText('TASK-41')).toBeVisible();

  expect(fixture.requests).toHaveLength(2);
  expect(fixture.requests[1]).toEqual(fixture.requests[0]);
  expect(fixture.requests[1]?.body).toBe(fixture.requests[0]?.body);
  expect(fixture.items).toHaveLength(1);
  expect(fixture.items[0]).toMatchObject({ id: 41, key: 'TASK-41' });
});

test('keeps a dirty draft on Back, then follows the chosen discard destination', async ({
  page,
}) => {
  await installStatefulTaskApi(page, { initialTasks: [summary(7, 'Review the plan')] });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Activeâ€¦' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Unsaved task draft');

  await page.goBack();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await confirmation.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page).toHaveURL(/\/tasks\?create=true$/);
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Unsaved task draft');

  await page.getByRole('button', { name: 'Open TASK-7: Review the plan' }).click();
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page).toHaveURL(/\/tasks\?task=7$/);
  await expect(page.getByRole('heading', { name: 'Review the plan' })).toBeVisible();
});

test('guards Escape and backdrop dismissal in the narrow overlay, while explicit Cancel discards', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await installStatefulTaskApi(page);
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add a task to Activeâ€¦' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create task' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Title' }:Ó›h‘éì¶»§q«^uÈXİ]™x )‰ÈJK˜ÛXÚÊ
NÂˆ]ØZ]^Xİ
YÙJKÒ]™UT“
×İ\ÚÜ×ØÜ™X]O]YIÊNÂˆ]ØZ]^Xİ
YÙK™Ù]T›ÛJ	ÙX[ÙÉËÈ˜[YNˆ	ĞÜ™X]H\ÚÉÈJJKĞ™Uš\ÚX›J
NÂˆ]ØZ]YÙK™Ù]T›ÛJ	İ^›Ş	ËÈ˜[YNˆ	Õ]IÈJK™š[
	ĞØ[˜Ù[[[YYX][IÊNÂˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ĞØ[˜Ù[	ÈJK˜ÛXÚÊ
NÂˆ]ØZ]^Xİ
YÙJKÒ]™UT“
×İ\ÚÜÉÊNÂˆ]ØZ]^Xİ
YÙK™Ù]T›ÛJ	Ø[\X[ÙÉÊJKÒ]™PÛİ[

NÂŸJNÂ‚\İ
	ÚÙY\ÈH\H˜YÚ[ˆÚYÛˆİ]\ÈØ[˜Ù[Y[™ÙÜÈİ]Y\ˆ\ØØ\™	Ë\Ş[˜È
ÂˆYÙKŸJHOˆÂˆ]ÙÛİ]™\]Y\İÈHÂˆ]ØZ][œİ[İ]Y[\ÚĞ\JYÙJNÂˆ]ØZ]YÙKœ›İ]J	ÊŠ‹Ø\KİŒKØ]]ÛÙÛİ]	Ë\Ş[˜È
›İ]JHOˆÂˆÙÛİ]™\]Y\İÈ
ÏHNÂˆ]ØZ]›İ]K™[š[
Èİ]\ÎˆŒJNÂˆJNÂˆ]ØZ]YÙK™ÛİÊ	Ëİ\ÚÜÉÊNÂˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ĞYH\ÚÈÈXİ]™x )‰ÈJK˜ÛXÚÊ
NÂˆÛÛœİ]HHYÙK™Ù]T›ÛJ	İ^›Ş	ËÈ˜[YNˆ	Õ]IÈJNÂˆ]ØZ]]K™š[
	ÒÙY\\È˜YYˆHİ^HÚYÛ™Y[‰ÊNÂ‚ˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ÔÚYÛˆİ]	ÈJK˜ÛXÚÊ
NÂˆÛÛœİÛÛ™š\›X][ÛˆHYÙK™Ù]T›ÛJ	Ø[\X[ÙÉÊNÂˆ]ØZ]^Xİ
ÛÛ™š\›X][ÛŠKĞ™Uš\ÚX›J
NÂˆ]ØZ]ÛÛ™š\›X][Û‹™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ÒÙY\Y][™ÉÈJK˜ÛXÚÊ
NÂˆ]ØZ]^Xİ
]JKÒ]™U˜[YJ	ÒÙY\\È˜YYˆHİ^HÚYÛ™Y[‰ÊNÂˆ^Xİ
ÙÛİ]™\]Y\İÊKĞ™J
NÂ‚ˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ÔÚYÛˆİ]	ÈJK˜ÛXÚÊ
NÂˆ]ØZ]^Xİ
ÛÛ™š\›X][ÛŠKĞ™Uš\ÚX›J
NÂˆ]ØZ]ÛÛ™š\›X][Û‹™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	Ñ\ØØ\™˜Y	ÈJK˜ÛXÚÊ
NÂˆ]ØZ]^Xİ
YÙJKÒ]™UT“
×ÛÙÚ[‰ÊNÂˆ]ØZ]^XİœÛ


HOˆÙÛİ]™\]Y\İÊKĞ™JJNÂŸJNÂ‚\İ
	Ü™]\›œÈÈH™]š[İ\È›İ]H[™ÚİÜÈ[ˆ\œ›ÜˆÚ[ˆÚYÛˆİ]˜Z[ÉË\Ş[˜È
ÈYÙHJHOˆÂˆ]ÙÛİ]™\]Y\İÈHÂˆ]ØZ][œİ[İ]Y[\ÚĞ\JYÙJNÂˆ]ØZ]YÙKœ›İ]J	ÊŠ‹Ø\KİŒKØ]]ÛÙÛİ]	Ë\Ş[˜È
›İ]JHOˆÂˆÙÛİ]™\]Y\İÈ
ÏHNÂˆ]ØZ]›İ]K™[š[
Èİ]\ÎˆLÛÛ[\Nˆ	Ø\XØ][Û‹Ü›Ø›[JÚœÛÛ‰Ë›ÙNˆ	ŞßIÈJNÂˆJNÂˆ]ØZ]YÙK™ÛİÊ	Ëİ\ÚÜÉÊNÂˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ĞYH\ÚÈÈXİ]™x )‰ÈJK˜ÛXÚÊ
NÂˆ]ØZ]YÙK™Ù]T›ÛJ	İ^›Ş	ËÈ˜[YNˆ	Õ]IÈJK™š[
	Ñ\ØØ\™™Y›Ü™HÙÛİ]	ÊNÂ‚ˆ]ØZ]YÙK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	ÔÚYÛˆİ]	ÈJK˜ÛXÚÊ
NÂˆ]ØZ]YÙK™Ù]T›ÛJ	Ø[\X[ÙÉÊK™Ù]T›ÛJ	Ø]Û‰ËÈ˜[YNˆ	Ñ\ØØ\™˜Y	ÈJK˜ÛXÚÊ
NÂ‚ˆ]ØZ]^XİœÛ


HOˆÙÛİ]™\]Y\İÊKĞ™JJNÂˆ]ØZ]^Xİ
YÙJKÒ]™UT“
×İ\ÚÜ×ØÜ™X]O]YIÊNÂˆ]ØZ]^Xİ
YÙK™Ù]T›ÛJ	Ü™YÚ[Û‰ËÈ˜[YNˆ	ĞÜ™X]H\ÚÉÈJJKĞ™Uš\ÚX›J
NÂˆ]ØZ]^Xİ
YÙK™Ù]T›ÛJ	Ø[\	ÊJKÒ]™U^
	ÔÚYÛˆİ]˜Z[YˆX\ÙHHYØZ[‹‰ÊNÂŸJNÂ