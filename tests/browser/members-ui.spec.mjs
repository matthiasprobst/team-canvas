import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { canvas } from '../fixtures.mjs';

for (const width of [1440, 390]) {
  test(`member management handles failures, filters and public templates at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const board = canvas({ name: 'Member management 1792849872532' });
    const name = 'Verylongdisplaynamewithoutanybreaks'.repeat(3);
    const members = [
      { id: 'owner', accountId: 'owner-account', username: 'owner', accountStatus: 'active', displayName: 'Owner', role: 'owner', revoked: false },
      { id: 'member', accountId: 'member-account', username: 'member', accountStatus: 'active', displayName: name, role: 'member', revoked: false },
      { id: 'disabled', accountId: 'disabled-account', username: 'disabled', accountStatus: 'deactivated', displayName: name, role: 'member', revoked: true },
    ];
    let failLoad = true, failAction = true, visibility = 'public';
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/members')) {
        if (failLoad) { failLoad = false; await route.fulfill({ status: 503, json: { message: 'Members temporarily unavailable.' } }); }
        else await route.fulfill({ json: { items: members, templateVisibility: visibility } });
      } else if (path.endsWith('/members/member')) {
        if (failAction) { failAction = false; await route.fulfill({ status: 503, json: { message: 'Access change failed. Try again.' } }); }
        else { members[1].revoked = route.request().postDataJSON().revoked; await route.fulfill({ status: 204 }); }
      } else if (path.endsWith('/invitations/revoke')) {
        if (route.request().postDataJSON().revokeMembers) members[1].revoked = true;
        await route.fulfill({ status: 204 });
      } else if (path.endsWith('/template')) { visibility = 'private'; await route.fulfill({ status: 204 }); }
      else if (path.endsWith('/access-history')) await route.fulfill({ json: [{ id: 1, action: 'member_removed', actorName: 'Owner', targetName: name, targetId: 'member-account', createdAt: '2026-10-25T07:00:00Z' }] });
      else await route.fulfill({ json: path === '/api/me' ? { id: 'account', displayName: 'Owner' } : { items: [board], nextCursor: null } });
    });
    await page.goto('/');
    await page.getByLabel(`Actions for ${board.name}`, { exact: true }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const sharing = page.getByRole('dialog', { name: `Share ${board.name}`, exact: true });
    await expect(sharing.getByRole('alert')).toHaveText(/Members temporarily unavailable/);
    await sharing.getByRole('button', { name: 'Retry members' }).click();
    const remove = sharing.getByRole('button', { name: `Remove access for ${name}`, exact: true });
    await expect(remove).toBeEnabled();
    await expect(sharing.getByText(/@member/)).toBeVisible();
    await expect(sharing.getByText(/@disabled/)).toBeVisible();
    await expect(sharing.getByText('Account deactivated · access blocked')).toBeVisible();
    await expect(sharing.getByRole('button', { name: `Restore access for ${name}`, exact: true })).toBeDisabled();
    expect(await sharing.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await remove.click();
    const removal = page.getByRole('dialog', { name: 'Remove member access?' });
    await page.keyboard.press('Escape');
    await expect(removal).toHaveCount(0);
    await expect(sharing).toBeVisible();
    await remove.click();
    await expect(removal.getByText(/public template/)).toBeVisible();
    await removal.getByRole('button', { name: 'Remove access', exact: true }).click();
    await expect(removal.getByRole('alert')).toHaveText('Access change failed. Try again.');
    await removal.getByRole('button', { name: 'Remove access', exact: true }).click();
    await expect(removal).toHaveCount(0);
    const memberRow = sharing.getByRole('listitem').filter({ has: page.getByText(/@member/) });
    const restore = memberRow.getByRole('button', { name: `Restore access for ${name}`, exact: true });
    await expect(restore).toBeEnabled();
    await restore.focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Restore member access?' }).getByRole('button', { name: 'Restore access', exact: true }).click();
    await expect(remove).toBeEnabled();
    await sharing.getByRole('button', { name: 'Remove all members and revoke links' }).click();
    await page.getByRole('dialog', { name: 'Remove all member access?' }).getByRole('button', { name: 'Remove all members', exact: true }).click();
    await expect(restore).toBeEnabled();
    await sharing.getByLabel('Filter members').selectOption('removed');
    await expect(sharing.getByText('Owner', { exact: true })).toHaveCount(0);
    await sharing.getByRole('button', { name: 'Make template private' }).click();
    await page.getByRole('dialog', { name: 'Make template private?' }).getByRole('button', { name: 'Make private', exact: true }).click();
    await expect(sharing.getByRole('button', { name: 'Make template private' })).toHaveCount(0);
    await sharing.getByRole('button', { name: 'Activity', exact: true }).click();
    await expect(sharing.getByText('Removed member access', { exact: true })).toBeVisible();
    await sharing.getByRole('button', { name: 'Members', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/optimized-sharing-${width}.png` });
    await sharing.getByRole('button', { name: 'Close dialog' }).click();
    await expect(sharing).toHaveCount(0);
  });
}
