import { expect, test } from '@playwright/test';
import { ACCOUNTS, PASSWORD, asUser, stamp } from './helpers.js';

const API = 'http://localhost:3001/api/api-service';

/**
 * The admin promotes a new employee to Facility Admin (they get the admin pages),
 * then deactivates them (they're signed out). Uses a throwaway e2e.* account, which
 * the suite's cleanup removes, so the sample accounts never change.
 */
test('admin promotes an employee, then deactivates them', async ({ browser, request }) => {
  const email = `e2e.people.${stamp()}@acme.inc`;
  const r = await request.post(`${API}/auth/register`, { data: { name: 'Pat People', email, password: PASSWORD } });
  expect(r.status()).toBe(201);

  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' }).click();
  await expect(admin.getByRole('heading', { name: 'People', level: 1 })).toBeVisible();
  await admin.getByLabel('Search name or email').fill(email);
  const row = admin.getByRole('row', { name: /Pat People/ });
  await expect(row).toContainText('Employee');

  await row.getByRole('button', { name: 'Make admin' }).click(); // confirm() is accepted by the helper
  await expect(admin.getByRole('status')).toHaveText('Pat People is now a Facility Admin.');
  await expect(row).toContainText('Facility Admin');

  // Pat now has the admin pages
  const pat = await asUser(browser, email);
  await expect(pat.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'People' })).toBeVisible();

  // ...until the admin deactivates the account: Pat's next request signs them out
  await row.getByRole('button', { name: 'Deactivate' }).click();
  await expect(admin.getByRole('status')).toHaveText('Pat People is deactivated.');
  await pat.reload();
  await expect(pat.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
