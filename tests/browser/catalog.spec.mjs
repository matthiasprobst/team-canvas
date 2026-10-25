import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { canvas } from '../fixtures.mjs';

const first = canvas({ name: 'First canvas' });
const second = canvas({ id: '00000000-0000-4000-8000-000000000002', name: 'Second canvas' });
const matching = canvas({ id: '00000000-0000-4000-8000-000000000003', name: 'Matching canvas' });

test('catalog pagination deduplicates results and late pages cannot overwrite a new search', async ({ page }) => {
  let release;
  let delay = false;
  await page.route('**/api/me', route => route.fulfill({ json: first.owner }));
  await page.route('**/api/boards?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.get('q') === 'Matching') {
      await route.fulfill({ json: { items: [matching], nextCursor: null } });
    } else if (params.has('cursor')) {
      if (delay) await new Promise(resolve => { release = resolve; });
      await route.fulfill({ json: { items: [first, second], nextCursor: null } }).catch(() => {});
    } else {
      await route.fulfill({ json: { items: [first], nextCursor: 'next' } });
    }
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'First canvas', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Second canvas', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'First canvas', exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('link', { name: 'First canvas', exact: true })).toBeVisible();
  delay = true;
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect.poll(() => !!release).toBe(true);
  await page.getByLabel('Search canvases or tags', { exact: true }).fill('Matching');
  await expect(page.getByRole('link', { name: 'Matching canvas', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('link', { name: 'Second canvas', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'First canvas', exact: true })).toHaveCount(0);
  await page.getByLabel('Search canvases or tags', { exact: true }).fill('');
  await expect(page.getByRole('link', { name: 'First canvas', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Second canvas', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeVisible();
});
