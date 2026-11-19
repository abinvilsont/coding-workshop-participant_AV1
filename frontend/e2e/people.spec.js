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

/** The admin sets a new employee's usual building; their report form then starts on it. */
test("admin sets someone's usual building and their reports start there", async ({ browser, request }) => {
  const email = `e2e.building.${stamp()}@acme.inc`;
  const r = await request.post(`${API}/auth/register`, { data: { name: 'Bea Building', email, password: PASSWORD } });
  expect(r.status()).toBe(201);

  // before: the form starts with no building
  const bea = await asUser(browser, email);
  await bea.goto('/#/incidents/new');
  await expect(bea.getByLabel('Building')).toBeEnabled();
  await expect(bea.getByLabel('Building')).toHaveValue('');

  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.goto('/#/admin/people');
  await admin.getByLabel('Search name or email').fill(email);
  const picker = admin.getByLabel("Bea Building's usual building");
  await expect(picker).toBeEnabled();
  await picker.selectOption({ label: 'ACME Innovation Hub' });
  await expect(admin.getByRole('status')).toHaveText("Bea Building's usual building is now ACME Innovation Hub.");

  // after: no need to sign in again
  await bea.reload();
  await expect(bea.getByLabel('Building').locator('option:checked')).toHaveText('ACME Innovation Hub');
  await expect(bea.getByText('Your usual building is filled in.', { exact: false })).toBeVisible();

  // reporting somewhere else gets a gentle note, not a block
  await bea.getByLabel('Building').selectOption({ label: 'ACME Headquarters' });
  await expect(bea.getByText("This isn't your usual building (ACME Innovation Hub). That's fine if the problem is here."))
    .toBeVisible();
});
