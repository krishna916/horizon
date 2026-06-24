import { test, expect } from '@playwright/test';

test('has heading', async ({ page }) => {
  // Mock the users/me API call to return a mock authenticated user
  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'smoke-test@example.com' }),
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome to Horizon/i, level: 1 })).toBeVisible();
});

test('successful registration smoke test', async ({ page }) => {
  // Mock the register API call to avoid dependency on running backend/DB
  await page.route('**/api/v1/auth/register', async (route) => {
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'smoke-test@example.com' }),
    });
  });

  // Mock the users/me API call to return a mock authenticated user on redirect to '/'
  await page.route('**/api/v1/users/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 1, email: 'smoke-test@example.com' }),
    });
  });

  await page.goto('/register');

  const emailInput = page.locator('input[name="email"]');
  const passwordInput = page.locator('input[name="password"]');
  const confirmPasswordInput = page.locator('input[name="confirmPassword"]');
  const agreeCheckbox = page.locator('#agreeTerms-checkbox');
  const submitButton = page.locator('button[type="submit"]');

  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await expect(submitButton).toBeVisible();

  await emailInput.fill('smoke-test@example.com');
  await passwordInput.fill('password123');
  await confirmPasswordInput.fill('password123');
  
  await agreeCheckbox.check();

  await submitButton.click();

  // On success, the form component redirects to '/'
  await expect(page).toHaveURL('/');
});

