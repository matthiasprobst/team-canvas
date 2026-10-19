import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

test('private templates stay owner-only and public templates start independent canvases', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base, viewport: { width: 1440, height: 1000 } });
  const bob = await browser.newContext({ baseURL: base });
  let source;
  let bobCopy;
  try {
    const a = await alice.newPage();
    const b = await bob.newPage();
    await login(a, 'alice');
    await login(b, 'bob');
    const title = `Template verification ${Date.now()}`;
    source = await api(alice, '/api/boards', { name: title });

    await a.goto(`${base}/b/${source.id}`);
    await expect(a.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await a.getByRole('button', { name: 'Sticky note' }).click();
    await expect(a.getByText('● Saved', { exact: true })).toBeVisible();
    await a.getByRole('link', { name: 'Canvases', exact: false }).click();
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Manage tags', exact: true }).click();
    const tagDialog = a.getByRole('dialog', { name: 'Manage tags' });
    await tagDialog.getByLabel('Add a tag').fill('planning');
    await tagDialog.getByRole('button', { name: 'Add tag', exact: true }).click();
    await tagDialog.getByRole('button', { name: 'Save tags', exact: true }).click();
    await expect(a.getByText('planning', { exact: true })).toBeVisible();
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Manage tags', exact: true }).click();
    const suggestionsDialog = a.getByRole('dialog', { name: 'Manage tags' });
    await suggestionsDialog.getByRole('button', { name: 'Remove planning' }).click();
    await suggestionsDialog.getByLabel('Add a tag').fill('plan');
    await expect(suggestionsDialog.getByRole('button', { name: 'planning', exact: true })).toBeVisible();
    await suggestionsDialog.getByRole('button', { name: 'planning', exact: true }).click();
    await suggestionsDialog.getByRole('button', { name: 'Save tags', exact: true }).click();
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Make template', exact: true }).click();
    const settings = a.getByRole('dialog', { name: 'Make this a template' });
    await expect(settings.getByLabel('Who can find and start this template?')).toHaveValue('private');
    await settings.getByRole('button', { name: 'Save settings' }).click();

    await b.reload();
    await b.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(b.getByRole('heading', { name: 'No templates available' })).toBeVisible();
    await api(bob, `/api/boards/${source.id}/start-template`, { name: 'Unauthorized copy' }, 'POST', 404);

    await a.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Start template', exact: true })).toBeVisible();
    await a.getByLabel(`Actions for ${title}`, { exact: true }).click();
    await a.getByRole('button', { name: 'Template settings', exact: true }).click();
    const publicSettings = a.getByRole('dialog', { name: 'Template settings' });
    await publicSettings.getByLabel('Who can find and start this template?').selectOption('public');
    await publicSettings.getByRole('button', { name: 'Save settings' }).click();

    await b.reload();
    await b.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(b.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(b.getByText('Public template by Alice Morgan', { exact: true })).toBeVisible();
    await expect(b.getByRole('button', { name: 'Edit template', exact: true })).toHaveCount(0);
    await a.getByRole('link', { name: 'Templates', exact: true }).click();
    await a.getByRole('button', { name: 'Edit template', exact: true }).click();
    await expect(a.locator('.topbar strong')).toHaveText(title);
    expect(new URL(a.url()).pathname).toBe(`/b/${source.id}`);
    await a.getByRole('link', { name: 'Canvases', exact: false }).click();
    await a.getByRole('link', { name: 'Templates', exact: true }).click();
    await b.screenshot({ path: testInfo.outputPath('public-template-desktop.png') });
    await b.setViewportSize({ width: 390, height: 844 });
    await b.getByRole('button', { name: 'Toggle navigation', exact: true }).click();
    await b.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(b.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await b.screenshot({ path: testInfo.outputPath('public-template-mobile.png') });
    await b.getByRole('button', { name: 'Start template', exact: true }).click();
    const nameDialog = b.getByRole('dialog', { name: 'Name your canvas' });
    const copyName = 'Bob session copy';
    await expect(nameDialog.getByLabel('Canvas name')).toHaveValue(`Untitled canvas (based on template ${title})`);
    await nameDialog.getByLabel('Canvas name').fill(copyName);
    await nameDialog.getByRole('button', { name: 'Start canvas', exact: true }).click();
    await expect(b.locator('.topbar strong')).toHaveText(copyName);
    const bobPath = new URL(b.url()).pathname;
    bobCopy = { id: bobPath.split('/').at(-1) };
    expect(bobCopy.id).not.toBe(source.id);
    await expect.poll(async () => (await api(bob, '/api/boards?filter=mine&q=planning', undefined, 'GET')).items.some(canvas => canvas.id === bobCopy.id && canvas.name === copyName && canvas.templateVisibility == null && canvas.tags.includes('planning'))).toBe(true);
    await b.getByRole('button', { name: 'Switch canvas', exact: true }).click();
    const switcher = b.getByRole('dialog', { name: 'Switch canvas' });
    await switcher.getByLabel('Search canvases or tags').fill('planning');
    await expect(switcher.getByRole('link', { name: new RegExp(copyName) })).toBeVisible();
    await b.goto(`${base}/?filter=mine&q=planning`);
    await expect(b.getByRole('link', { name: new RegExp(copyName) })).toBeVisible();

    await api(alice, `/api/boards/${source.id}/template`, {}, 'DELETE', 204);
    await b.goto(`${base}/?filter=templates`);
    await expect(b.getByRole('heading', { name: 'No templates available' })).toBeVisible();
  } finally {
    if (source) await alice.request.delete(`${base}/api/boards/${source.id}`, { headers: { Origin: base } });
    if (bobCopy) await bob.request.delete(`${base}/api/boards/${bobCopy.id}`, { headers: { Origin: base } });
    await alice.close();
    await bob.close();
  }
});
