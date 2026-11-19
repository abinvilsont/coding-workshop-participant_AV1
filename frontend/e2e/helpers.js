import { expect } from '@playwright/test';

export const PASSWORD = 'Password123!';
export const ACCOUNTS = {
  admin: 'alice.admin@acme.inc',
  engineer: 'tom.eng@acme.inc',
  employee: 'emma@acme.inc',
};

export const stamp = () => Date.now().toString(36);

/** Sign in through the login form; waits for the signed-in shell. */
export async function signIn(page, email, password = PASSWORD) {
  await page.goto('/');
  await page.getByLabel('Work email').fill(email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // The dashboard greeting appears on every screen size (Sign out moves into the menu on phones)
  await expect(page.getByRole('heading', { level: 1, name: /^Hello, / })).toBeVisible();
}

/** A fresh, signed-in page for one persona (separate browser context = separate session). */
export async function asUser(browser, email) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('dialog', (d) => d.accept()); // confirm() prompts
  await signIn(page, email);
  return page;
}

/** Open the bell and click the notification containing `text`. */
export async function openNotification(page, text) {
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName(/unread/);
  await bell.click();
  await page.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: text }).first().click();
}

// An action block on the incident page: a <section> labelled by its heading
export const actions = (page, heading) => page.getByRole('region', { name: heading, exact: true });

/**
 * Submit the report form. If the app asks whether the problem is already reported,
 * answer "it's a different problem" (journeys that test that prompt drive it themselves).
 */
export async function submitReport(page) {
  await page.getByRole('button', { name: 'Submit incident' }).click();
  const prompt = page.getByRole('dialog', { name: 'This may already be reported' });
  const saved = page.waitForURL(/#\/incidents\/\d+$/).then(() => 'saved', () => null);
  const asked = prompt.waitFor().then(() => 'asked', () => null);
  if ((await Promise.race([saved, asked])) === 'asked') {
    await prompt.getByRole('button', { name: /different problem, report it/ }).click();
    await page.waitForURL(/#\/incidents\/\d+$/);
  }
}
