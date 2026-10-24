import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { canvas, snapshot } from '../fixtures.mjs';

const id = snapshot().board.id;
const displayName = 'Alexandria Verylongdisplaynamewithoutbreaks'.repeat(3);

async function fixture(page, admin) {
  let loggedOut = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/logout') {
      loggedOut = true;
      await route.fulfill({ json: { redirect: '/login' } });
      return;
    }
    if (path === '/api/me' && loggedOut) {
      await route.fulfill({ status: 401, json: { message: 'Please sign in to continue.' } });
      return;
    }
    const json = path === '/api/me' ? { id: 'account', displayName, admin } :
      path.endsWith('/join') ? { id, participantId: 'member', role: 'host', token: 'test' } :
      { items: [canvas()], nextCursor: null };
    await route.fulfill({ json });
  });
  await page.routeWebSocket('**/ws/boards/*', ws => {
    ws.onMessage(raw => {
      const packet = JSON.parse(String(raw));
      if (packet.type === 'hello') {
        const data = snapshot();
        data.participantId = 'member';
        ws.send(JSON.stringify({ type: 'snapshot', data }));
      } else if (packet.type === 'ping') ws.send('{"type":"pong"}');
      // Leave patches unacknowledged to exercise navigation protection.
    });
  });
}

for (const width of [1440, 390]) {
  for (const admin of [false, true]) {
    test(`account controls match on both pages at ${width}px, admin=${admin}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (['error', 'warning'].includes(message.type())) errors.push(message.text());
      });
      await fixture(page, admin);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'All canvases' })).toBeVisible();
      let dashboardStyle;
      for (const route of ['/', `/b/${id}`]) {
        if (route !== '/') {
          await page.getByRole('link', { name: 'Navigation canvas', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
        }
        const trigger = page.getByRole('button', { name: /^Account:/ });
        const panel = page.getByRole('navigation', { name: 'Account', exact: true });
        const box = await trigger.boundingBox();
        expect(box.x).toBeGreaterThan(width - 80);
        expect(box.y).toBeLessThan(25);
        const style = await trigger.evaluate(element => {
          const css = getComputedStyle(element);
          return [css.width, css.height, css.backgroundColor, css.borderRadius, css.font];
        });
        if (route === '/') dashboardStyle = style;
        else expect(style).toEqual(dashboardStyle);
        await trigger.focus();
        await page.keyboard.press('Enter');
        await expect(panel).toBeVisible();
        await expect(panel.locator('.account-name')).toHaveText(displayName);
        await expect(panel.getByRole('link', { name: 'User administration' })).toHaveCount(admin ? 1 : 0);
        await page.keyboard.press('Tab');
        await expect(panel.getByRole('link').first()).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await page.keyboard.press('Space');
        await expect(panel).toBeVisible();
        await page.keyboard.press('Tab');
        if (admin) await page.keyboard.press('Tab');
        await expect(panel.getByRole('link', { name: 'Sign out' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(panel).toHaveCount(0);
        await trigger.click();
        const panelBox = await panel.boundingBox();
        expect(panelBox.x).toBeGreaterThanOrEqual(0);
        expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(width);
        expect(await panel.evaluate(element => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.right - 12, box.top + box.height / 2));
        })).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (admin) await page.screenshot({ path: `/tmp/account-${route === '/' ? 'dashboard' : 'canvas'}-${width}.png` });
        await page.locator(route === '/' ? 'h1' : '.canvas-heading').click();
        await expect(panel).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'Sticky note' }).click();
      await expect(page.getByText('Saving', { exact: true })).toBeVisible();
      for (const action of admin ? ['Sign out', 'User administration'] : ['Sign out']) {
        await page.getByRole('button', { name: /^Account:/ }).click();
        await page.getByRole('link', { name: action, exact: true }).click();
        await expect(page.getByRole('dialog', { name: 'Leave this canvas?' })).toBeVisible();
        await page.getByRole('button', { name: 'Stay here' }).click();
        await expect(page).toHaveURL(new RegExp(`/b/${id}$`));
        await expect(page.getByRole('navigation', { name: 'Account', exact: true })).toHaveCount(0);
      }
      expect(errors).toEqual([]);
      await page.getByRole('button', { name: /^Account:/ }).click();
      await page.getByRole('link', { name: 'Sign out', exact: true }).click();
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Discard and leave' }).click();
      await expect(page.getByRole('button', { name: 'Login with SSO', exact: true })).toBeVisible();
    });
  }
}
