import { expect, test } from '@playwright/test';
import { ACCOUNTS, actions, asUser, stamp, submitReport } from './helpers.js';

/** Choose the option whose text contains `text` (option labels carry extra details). */
async function choose(select, text) {
  const value = await select.locator('option', { hasText: text }).getAttribute('value');
  await select.selectOption(value);
}

/**
 * Two people act on the same incident from pages that are both open. Whoever saves
 * second is told what happened and sees the latest version: nothing is overwritten.
 */
test('people acting at the same time never overwrite each other', async ({ browser }) => {
  const title = `[e2e] Projector flickers ${stamp()}`;

  const emma = await asUser(browser, ACCOUNTS.employee);
  await emma.goto('/#/incidents/new');
  await emma.getByLabel('Title').fill(title);
  await emma.getByLabel('Description').fill('The projector in room 2B flickers every few seconds.');
  await emma.getByLabel('Category').selectOption('audio_visual');
  await emma.getByLabel('Building').selectOption({ label: 'ACME Headquarters' });
  await submitReport(emma);
  await expect(emma.getByRole('heading', { name: title })).toBeVisible();
  const url = emma.url();

  const admin = await asUser(browser, ACCOUNTS.admin);
  await admin.goto(url);
  await choose(actions(admin, 'Assign engineer').locator('select'), 'Tom Tech');
  await admin.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(admin.getByTestId('incident-details')).toContainText('Tom Tech');

  // --- 1. Emma cancels from a page that still says "Assigned", just after Tom started work
  await emma.reload();
  await expect(emma.getByRole('button', { name: 'Cancel incident' })).toBeVisible();
  const tom = await asUser(browser, ACCOUNTS.engineer);
  await tom.goto(url);
  await tom.getByRole('button', { name: 'Start work' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('In progress');

  await emma.getByRole('button', { name: 'Cancel incident' }).click(); // confirm() accepted by the helper
  await expect(emma.getByRole('alert')).toContainText("You can't change this incident from in_progress to cancelled.");
  await expect(emma.getByTestId('incident-badges')).toContainText('In progress'); // the page caught up
  await expect(emma.getByRole('button', { name: 'Cancel incident' })).toHaveCount(0);

  // --- 2. The admin edits the title while Tom puts the ticket on hold
  await admin.reload();
  await admin.getByRole('button', { name: 'Edit details' }).click();
  await admin.getByLabel(/^Title/).fill(`${title} (admin edit)`);
  await tom.getByRole('button', { name: 'Put on hold' }).click();
  await expect(tom.getByTestId('incident-badges')).toContainText('On hold');

  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByRole('alert')).toContainText("Your changes weren't saved: someone updated this incident");
  await expect(admin.getByTestId('incident-badges')).toContainText('On hold');
  await expect(admin.getByRole('heading', { name: title, exact: true })).toBeVisible(); // title not overwritten

  // editing again starts from the latest version and saves
  await admin.getByRole('button', { name: 'Edit details' }).click();
  await admin.getByLabel(/^Title/).fill(`${title} (admin edit)`);
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByRole('heading', { name: `${title} (admin edit)` })).toBeVisible();
});
