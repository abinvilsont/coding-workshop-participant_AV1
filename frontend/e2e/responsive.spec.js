import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers.js';

// Runs in the "phone" project (Pixel 7 viewport)
for (const [role, email] of Object.entries(ACCOUNTS)) {
  test(`${role} pages fit a phone screen`, async ({ page }) => {
    await signIn(page, email);
    const adminPages = role === 'admin' ? ['/#/admin/facilities', '/#/admin/engineers', '/#/admin/people'] : [];
    for (const path of ['/', '/#/incidents', '/#/incidents/new', ...adminPages]) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(0);
    }
  });
}
