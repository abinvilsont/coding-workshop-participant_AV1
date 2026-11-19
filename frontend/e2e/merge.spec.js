import { expect, test } from '@playwright/test';
import { ACCOUNTS, actions, asUser, openNotification, stamp, submitReport } from './helpers.js';

const SECOND_EMPLOYEE = 'liam.lee@acme.inc';

/** Choose the option whose text contains `text` (option labels carry extra details). */
async function choose(select, text) {
  const value = await select.locator('option', { hasText: text }).getAttribute('value');
  await select.selectOption(value);
}

async function report(page, title, description) {
  await page.goto('/#/incidents/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Category').selectOption('plumbing');
  await page.getByLabel('Building').selectOption({ label: 'ACME Headquarters' });
  await submitReport(page);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  return page.url();
}

/**
 * Two employees report the same leak. The admin merges the second report into the
 * first and assigns it; both employees then follow the same incident to closure.
 */
test('admin merges a duplicate and both reporters get the updates', async ({ browser }) => {
  const id = stamp();
  const mainTitle = `[e2e] Water leaking under sink ${id}`;
  const dupTitle = `[e2e] Kitchen floor is wet ${id}`;

  const emma = await asUser(browser, ACCOUNTS.employee);
  const mainUrl = await report(emma, mainTitle, 'Water pools under the 2nd floor kitchen sink.');
  const liam = await asUser(browser, SECOND_EMPLOYEE);
  const dupUrl = await report(liam, dupTitle, 'The floor by the kitchen sink is soaked.');

  // --- Admin merges Liam's report into Emma's ----------------------------------------
  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.goto(dupUrl);
  const merge = actions(admin, 'Merge duplicate');
  await choose(merge.getByLabel(/^Merge into/), mainTitle);
  await merge.getByRole('button', { name: 'Merge' }).click(); // the confirm() is accepted by the helper

  // ...lands on the main incident, which now lists Liam as another reporter
  await expect(admin.getByRole('heading', { name: mainTitle })).toBeVisible();
  await expect(admin.getByTestId('incident-details')).toContainText('Also reported byLiam Lee');

  // --- Liam is told, and his report now points at the main incident ------------------
  await liam.reload(); // Liam is still on his report's page
  await expect(liam.getByTestId('incident-badges')).toContainText('Merged');
  await expect(liam.getByText(/This report was merged into/)).toBeVisible();
  await openNotification(liam, /merged your incident/);
  await expect(liam.getByRole('heading', { name: mainTitle })).toBeVisible();
  await expect(liam.getByText(/You're following this incident/)).toBeVisible();

  // --- Admin assigns Tom; Tom fixes it -------------------------------------------------
  await admin.reload();
  await choose(actions(admin, 'Assign engineer').locator('select'), 'Tom Tech');
  await admin.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(admin.getByTestId('incident-details')).toContainText('Tom Tech');

  const tom = await asUser(browser, ACCOUNTS.engineer);
  await tom.goto(mainUrl);
  await tom.getByRole('button', { name: 'Start work' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('In progress');
  await tom.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('Resolved');

  // --- Both employees hear about it; only Emma can confirm ------------------------------
  await liam.goto('/');
  await openNotification(liam, /Please confirm the fix/);
  await expect(liam.getByRole('heading', { name: mainTitle })).toBeVisible();
  await expect(liam.getByRole('button', { name: 'Confirm fixed & close' })).toHaveCount(0);

  await emma.goto('/');
  await openNotification(emma, /Please confirm the fix/);
  await emma.getByRole('button', { name: 'Confirm fixed & close' }).click();
  await expect(emma.getByTestId('incident-badges')).toContainText('Closed');

  await liam.goto('/');
  await openNotification(liam, /to Closed/);
  await expect(liam.getByTestId('incident-badges')).toContainText('Closed');
});
