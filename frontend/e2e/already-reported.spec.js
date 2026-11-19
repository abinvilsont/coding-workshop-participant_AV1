import { expect, test } from '@playwright/test';
import { ACCOUNTS, asUser, openNotification, stamp, submitReport } from './helpers.js';

const SECOND_EMPLOYEE = 'liam.lee@acme.inc';

async function fillReport(page, title) {
  await page.goto('/#/incidents/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('The printer on the first floor jams on every job.');
  await page.getByLabel('Category').selectOption('it_hardware');
  await page.getByLabel('Building').selectOption({ label: 'ACME Headquarters' });
  await page.getByLabel(/^Floor/).selectOption({ index: 1 });
}

/**
 * Emma reports a jammed printer. Liam starts reporting the same thing, is told it's already
 * reported, and requests escalation instead: no duplicate, and he follows Emma's incident.
 */
test('an employee finds the problem already reported and requests escalation', async ({ browser }) => {
  const title = `[e2e] Printer jams on every job ${stamp()}`;

  const emma = await asUser(browser, ACCOUNTS.employee);
  await fillReport(emma, title);
  await submitReport(emma);
  await expect(emma.getByRole('heading', { name: title })).toBeVisible();
  const url = emma.url();

  // --- Liam tries to report the same problem ------------------------------------------
  const liam = await asUser(browser, SECOND_EMPLOYEE);
  await fillReport(liam, '[e2e] Printer broken');
  await liam.getByRole('button', { name: 'Submit incident' }).click();

  const prompt = liam.getByRole('dialog', { name: 'This may already be reported' });
  const match = prompt.getByRole('listitem', { name: new RegExp(title.replace(/[[\]]/g, '\\$&')) });
  await expect(match).toBeVisible();
  await match.getByRole('button', { name: 'Request escalation' }).click();
  await match.getByLabel(/Why is it urgent/).fill('Nobody on the floor can print.');
  await match.getByRole('button', { name: 'Send request' }).click();

  // ...lands on Emma's incident, following it, and it's now escalated
  await expect(liam.getByRole('heading', { name: title })).toBeVisible();
  expect(liam.url()).toBe(url);
  await expect(liam.getByText(/You're following this incident/)).toContainText('asked for it to be escalated');
  await expect(liam.getByTestId('incident-badges')).toContainText('Escalated');

  // --- Emma and the admin hear about it ------------------------------------------------
  await emma.goto('/');
  await openNotification(emma, /reported the same problem and asked to escalate/);
  await expect(emma.getByRole('heading', { name: title })).toBeVisible();

  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.goto(url);
  await expect(admin.getByTestId('incident-details')).toContainText('Asked to escalateLiam Lee');
  await expect(admin.getByText('Nobody on the floor can print.').first()).toBeVisible();

  // --- reporting it again offers no second request ------------------------------------
  await fillReport(liam, '[e2e] Printer still broken');
  await liam.getByRole('button', { name: 'Submit incident' }).click();
  await expect(prompt.getByRole('listitem', { name: new RegExp(title.replace(/[[\]]/g, '\\$&')) }))
    .toContainText("You're following this.");
});
