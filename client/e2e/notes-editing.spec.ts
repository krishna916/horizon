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
      tags: [],
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
        tags: [],
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
  await page.clock.fastForward(1_200);
  expect(writeCount).toBe(0);

  await page.getByRole('button', { name: 'Discard unsent changes and sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
  await page.clock.fastForward(1_000);
  expect(writeCount).toBe(0);
});

test('blocks immediate sign out from a saved Note and discards only the unsent edit', async ({
  page,
}) => {
  await page.clock.install();
  let authenticated = true;
  let loginCount = 0;
  let logoutCount = 0;
  let patchCount = 0;
  const original = {
    id: 607,
    title: 'Original saved title',
    content: null,
    tags: [],
    version: 3,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  let serverNote = { ...original };

  const user = { id: 67, email: 'owner-sixty-seven@example.test' };
  await page.route('**/api/v1/users/me', (route) =>
    authenticated
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      : route.fulfill({ status: 401, contentType: 'application/problem+json', body: '{}' })
  );
  await page.route('**/api/v1/auth/login', async (route) => {
    const body = route.request().postDataJSON() as { email: string; password: string };
    expect(body).toEqual({ email: user.email, password: 'Password123!' });
    loginCount += 1;
    authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(user),
    });
  });
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    authenticated = false;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/607', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverNote),
      });
      return;
    }
    patchCount += 1;
    serverNote = { ...serverNote, ...route.request().postDataJSON(), version: 4 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(serverNote),
    });
  });

  await page.goto('/notes/607');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await expect(title).toHaveValue(original.title);
  await title.fill('Unsaved replacement title');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('dialog')).toContainText('Sign out with an unsaved note');
  await expect(page).not.toHaveURL(/\/login$/);
  expect(logoutCount).toBe(0);
  expect(patchCount).toBe(0);
  await page.clock.fastForward(1_100);
  expect(logoutCount).toBe(0);
  expect(patchCount).toBe(0);

  await page.getByRole('button', { name: 'Discard unsent changes and sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
  await page.clock.fastForward(1_000);
  expect(patchCount).toBe(0);

  await page.getByLabel('Email address').fill(user.email);
  await page.getByRole('textbox', { name: 'Password' }).fill('Password123!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  expect(loginCount).toBe(1);
  await page.goto('/notes/607');
  await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue(
    'Original saved title'
  );
  expect(serverNote.title).toBe(original.title);
  expect(loginCount).toBe(1);
  expect(logoutCount).toBe(1);
});

test('holds a saved Note debounce during sign out and resumes it after Stay', async ({ page }) => {
  await page.clock.install();
  let logoutCount = 0;
  let patchCount = 0;
  const original = {
    id: 610,
    title: 'Saved before Stay',
    content: null,
    tags: [],
    version: 3,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  let serverNote = { ...original };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 70, email: 'owner-seventy@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/610', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverNote),
      });
      return;
    }
    patchCount += 1;
    serverNote = { ...serverNote, ...route.request().postDataJSON(), version: 4 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(serverNote),
    });
  });

  await page.goto('/notes/610');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Saved after Stay');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sign out with an unsaved note');
  await page.clock.fastForward(1_100);
  expect(patchCount).toBe(0);
  expect(logoutCount).toBe(0);
  await expect(page).not.toHaveURL(/\/login$/);

  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/notes\/610$/);
  await expect(title).toHaveValue('Saved after Stay');
  await page.clock.fastForward(1_000);
  await expect.poll(() => patchCount).toBe(1);
  await expect.poll(() => serverNote.title).toBe('Saved after Stay');
  expect(logoutCount).toBe(0);
});

test('waits for a queued saved-Note PATCH before signing out', async ({ page }) => {
  await page.clock.install();
  let releasePatch!: () => void;
  const patchGate = new Promise<void>((resolve) => (releasePatch = resolve));
  let logoutCount = 0;
  let patchCount = 0;
  const original = {
    id: 611,
    title: 'Saved before Wait',
    content: null,
    tags: [],
    version: 3,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  let serverNote = { ...original };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 71, email: 'owner-seventy-one@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/611', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverNote),
      });
      return;
    }
    patchCount += 1;
    const patch = route.request().postDataJSON();
    await patchGate;
    serverNote = { ...serverNote, ...patch, version: 4 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(serverNote),
    });
  });

  await page.goto('/notes/611');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Saved through Wait');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsent changes');
  expect(patchCount).toBe(0);
  expect(logoutCount).toBe(0);
  await page.getByRole('button', { name: 'Wait for save and sign out' }).click();
  await expect.poll(() => patchCount).toBe(1);
  await expect(page).toHaveURL(/\/notes\/611$/);
  expect(logoutCount).toBe(0);

  releasePatch();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
  expect(patchCount).toBe(1);
  expect(serverNote.title).toBe('Saved through Wait');
});

test('does not sign out when a queued saved-Note Wait PATCH fails', async ({ page }) => {
  await page.clock.install();
  let logoutCount = 0;
  let patchCount = 0;
  const saved = {
    id: 612,
    title: 'Saved before failed Wait',
    content: null,
    tags: [],
    version: 3,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 72, email: 'owner-seventy-two@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/612', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(saved),
      });
      return;
    }
    patchCount += 1;
    await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
  });

  await page.goto('/notes/612');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Unsaved and failing');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Wait for save and sign out' }).click();
  await expect.poll(() => patchCount).toBe(1);
  await expect(page.getByRole('button', { name: 'Retry save and sign out' })).toBeVisible();
  await expect(page).toHaveURL(/\/notes\/612$/);
  expect(logoutCount).toBe(0);
});

test('blocks sign out after a saved Note rich-text edit and discards the unsent body', async ({
  page,
}) => {
  await page.clock.install();
  let logoutCount = 0;
  let patchCount = 0;
  const original = {
    id: 608,
    title: 'Saved body note',
    content: document('Original body'),
    tags: [],
    version: 2,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  let serverNote = { ...original };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 68, email: 'owner-sixty-eight@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/api/v1/notes/608', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverNote),
      });
      return;
    }
    patchCount += 1;
    serverNote = { ...serverNote, ...route.request().postDataJSON(), version: 3 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(serverNote),
    });
  });

  await page.goto('/notes/608');
  const editor = page.getByLabel('Note content editor');
  await expect(editor).toContainText('Original body');
  await editor.click();
  await page.keyboard.type('Unsaved body change');
  await page.getByRole('button', { name: 'Sign out' }).click();

  await expect(page.getByRole('dialog')).toContainText('Sign out with an unsaved note');
  expect(logoutCount).toBe(0);
  expect(patchCount).toBe(0);
  await page.clock.fastForward(1_100);
  expect(logoutCount).toBe(0);
  expect(patchCount).toBe(0);

  await page.getByRole('button', { name: 'Discard unsent changes and sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect.poll(() => logoutCount).toBe(1);
  await page.goto('/notes/608');
  await expect(page.getByLabel('Note content editor')).toContainText('Original body');
  expect(serverNote.content).toEqual(original.content);
  expect(patchCount).toBe(0);
});

test('keeps an explicitly discarded saved Note discarded when logout fails', async ({ page }) => {
  await page.clock.install();
  let logoutCount = 0;
  let patchCount = 0;
  const original = {
    id: 609,
    title: 'Original after failed logout',
    content: null,
    tags: [],
    version: 5,
    inbox: false,
    archivedAt: null,
    ...timestamps,
  };
  const serverNote = { ...original };

  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 69, email: 'owner-sixty-nine@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', async (route) => {
    logoutCount += 1;
    await route.fulfill({ status: 500, contentType: 'application/problem+json', body: '{}' });
  });
  await page.route('**/api/v1/notes/609', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(serverNote),
      });
      return;
    }
    patchCount += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/notes/609');
  const title = page.getByRole('textbox', { name: 'Note title' });
  await title.fill('Discard this before logout fails');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('Sign out with an unsaved note');
  await page.getByRole('button', { name: 'Discard unsent changes and sign out' }).click();

  await expect.poll(() => logoutCount).toBe(1);
  await expect(page).toHaveURL(/\/notes\/609$/);
  await expect(title).toHaveValue(original.title);
  await expect(page.getByRole('alert')).toHaveText('Sign out failed. Please try again.');
  await page.clock.fastForward(1_100);
  expect(patchCount).toBe(0);
  expect(serverNote.title).toBe(original.title);
});

test('holds a debounced create while the sign-out decision is open and resumes after Stay', async ({
  page,
}) => {
  await page.clock.install();
  let writeCount = 0;
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 7, email: 'owner-seven@example.test' }),
    })
  );
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/notes', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    writeCount += 1;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 701,
        ...route.request().postDataJSON(),
        version: 1,
        inbox: false,
        archivedAt: null,
        ...timestamps,
      }),
    });
  });

  await page.goto('/notes/new');
  await page.getByRole('textbox', { name: 'Note title' }).fill('Save after staying');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('dialog')).toContainText('unsent changes');
  await page.clock.fastForward(1_200);
  expect(writeCount).toBe(0);

  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.fastForward(1_000);
  await expect.poll(() => writeCount).toBe(1);
  await expect(page).toHaveURL(/\/notes\/701$/);
});

test('opens a fresh draft after creating a Note and never patches the prior Note', async ({
  page,
}) => {
  await page.clock.install();
  const writes: Array<{
    method: string;
    url: string;
    idempotencyKey: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  await page.route('**/api/v1/users/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 8, email: 'owner-eight@example.test' }),
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
    const body = route.request().postDataJSON() as Record<string, unknown>;
    writes.push({
      method: 'POST',
      url: route.request().url(),
      idempotencyKey: route.request().headers()['idempotency-key'],
      body,
    });
    const id = 801 + writes.length;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        id,
        ...body,
        version: 1,
        inbox: false,
        archivedAt: null,
        ...timestamps,
      }),
    });
  });
  await page.route('**/api/v1/notes/*', async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
    if (route.request().method() === 'GET') {
      const post = writes[id - 802];
      await route.fulfill({
        status: post ? 200 : 404,
        contentType: 'application/json',
        body: post
          ? JSON.stringify({
              id,
              ...post.body,
              version: 1,
              inbox: false,
              archivedAt: null,
              ...timestamps,
            })
          : '{}',
      });
      return;
    }
    writes.push({
      method: route.request().method(),
      url: route.request().url(),
      idempotencyKey: route.request().headers()['idempotency-key'],
      body: (route.request().postDataJSON() ?? {}) as Record<string, unknown>,
    });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/notes');
  await page.getByRole('link', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note title' }).fill('First Note');
  await expect(page).toHaveURL(/\/notes\/802$/);

  await page.evaluate(() => {
    window.history.pushState({}, '', '/notes/new');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  });
  await expect(page).toHaveURL(/\/notes\/new$/);
  const secondTitle = page.getByRole('textbox', { name: 'Note title' });
  await expect(secondTitle).toHaveValue('');
  await secondTitle.fill('Second Note');
  await expect(page).toHaveURL(/\/notes\/803$/);
  await page.clock.fastForward(1_000);

  expect(writes.map(({ method, url }) => [method, url])).toEqual([
    ['POST', expect.stringMatching(/\/api\/v1\/notes$/)],
    ['POST', expect.stringMatching(/\/api\/v1\/notes$/)],
  ]);
  expect(writes.map(({ body }) => body.title)).toEqual(['First Note', 'Second Note']);
  expect(writes[0]?.idempotencyKey).toBeTruthy();
  expect(writes[1]?.idempotencyKey).toBeTruthy();
  expect(writes[0]?.idempotencyKey).not.toBe(writes[1]?.idempotencyKey);
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
    tags: [],
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
