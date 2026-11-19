import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers.js';

// Runs in the phone (Pixel 7), small-phone (320 px), tablet (768) and tablet-landscape (1024) projects
for (const [role, email] of Object.entries(ACCOUNTS)) {
  test(`${role} pages fit the screen`, async ({ page }) => {
    await signIn(page, email);
    const adminPages = role === 'admin' ? ['/#/admin/facilities', '/#/admin/engineers', '/#/admin/people'] : [];
    // the first incident this person can see (a row in a table, or a card on smaller screens)
    await page.goto('/#/incidents');
    const first = page.locator('main a[href^="#/incidents/"]:not([href="#/incidents/new"])').first();
    const incident = '/' + (await first.getAttribute('href'));
    for (const path of ['/', '/#/incidents', '/#/incidents/new', incident, ...adminPages]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(0);
      // tables must fit their box too: below their width, lists become cards
      const tableOverflow = await page.evaluate(() => [...document.querySelectorAll('.MuiTableContainer-root')]
        .filter((t) => t.scrollWidth > t.clientWidth + 1).length);
      expect(tableOverflow, `a table scrolls sideways on ${path}`).toBe(0);
    }
  });
}
