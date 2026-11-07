import { expect, test } from '@playwright/test';

test('temporary issue 45 isolation probe fails deliberately', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'intentionally absent heading' })).toBeVisible();
});
