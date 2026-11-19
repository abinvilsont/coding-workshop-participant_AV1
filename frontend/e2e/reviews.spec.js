import { expect, test } from '@playwright/test';
import { ACCOUNTS, actions, asUser, stamp } from './helpers.js';

/** Choose the option whose text contains `text` (option labels carry extra details). */
async function choose(select, text) {
  const value = await select.locator('option', { hasText: text }).getAttribute('value');
  await select.selectOption(value);
}

/**
 * Emma's incident is fixed by Tom and closed; Emma rates Tom. The admin sees the
 * review on the incident and on the Engineers page; Tom never sees it.
 */
test('employee reviews the engineer; admins see it, the engineer does not', async ({ browser }) => {
  const title = `[e2e] Desk lamp flickers ${stamp()}`;
  const comment = `Fixed before lunch ${stamp()}`;

  const emma = await asUser(browser, ACCOUNTS.employee);
  await emma.goto('/#/incidents/new');
  await emma.getByLabel('Title').fill(title);
  await emma.getByLabel('Description').fill('The lamp on my desk flickers on and off.');
  await emma.getByLabel('Category').selectOption('electrical');
  await emma.getByLabel('Building').selectOption({ label: 'ACME Headquarters' });
  await emma.getByRole('button', { name: 'Submit incident' }).click();
  await expect(emma.getByRole('heading', { name: title })).toBeVisible();
  const url = emma.url();

  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.goto(url);
  await choose(actions(admin, 'Assign engineer').locator('select'), 'Tom Tech');
  await admin.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(admin.getByTestId('incident-details')).toContainText('Tom Tech');

  const tom = await asUser(browser, ACCOUNTS.engineer);
  await tom.goto(url);
  await tom.getByRole('button', { name: 'Start work' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('In progress');
  await tom.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('Resolved');

  // --- Emma confirms the fix, then rates Tom ----------------------------------------
  await emma.reload();
  await expect(emma.getByRole('region', { name: 'Rate Tom Tech' })).toHaveCount(0); // not until closed
  await emma.getByRole('button', { name: 'Confirm fixed & close' }).click();
  await expect(emma.getByTestId('incident-badges')).toContainText('Closed');

  const rate = emma.getByRole('region', { name: 'Rate Tom Tech' });
  await rate.locator('label', { hasText: '4 stars' }).click(); // the visible star (MUI hides the radio)
  await expect(rate).toContainText('Very good');
  await rate.getByLabel('Comment (optional)').fill(comment);
  await rate.getByRole('button', { name: 'Submit review' }).click();
  await expect(rate.getByText('Your review', { exact: true })).toBeVisible();
  await expect(rate.getByRole('img', { name: '4 stars' })).toBeVisible();

  // --- Tom sees no trace of it -------------------------------------------------------
  await tom.reload();
  await expect(tom.getByTestId('incident-badges')).toContainText('Closed');
  await expect(tom.getByText(comment)).toHaveCount(0);
  await expect(tom.getByText(/review/i)).toHaveCount(0);

  // --- Admin sees it on the incident and on the Engineers page -----------------------
  await admin.reload();
  const reviews = admin.getByRole('region', { name: 'Engineer reviews (1)' });
  await expect(reviews).toContainText('Emma Employee rated Tom Tech');
  await expect(reviews).toContainText(comment);

  await admin.goto('/#/admin/engineers');
  await admin.getByRole('button', { name: /^Tom Tech: .* out of 5 from \d+ reviews?\. Show reviews$/ }).click();
  const panel = admin.getByRole('region', { name: 'Reviews of Tom Tech' });
  await expect(panel).toContainText(comment);
  await expect(panel.getByRole('link', { name: /^INC-/ }).first()).toBeVisible();
});
