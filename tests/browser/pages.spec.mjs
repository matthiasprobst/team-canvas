import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

function snapshots(page) {
  const states = [];
  page.on('websocket', socket => socket.on('framereceived', event => {
    const packet = JSON.parse(String(event.payload));
    if (packet.type === 'snapshot') states.push(packet.data);
  }));
  return states;
}

async function createPage(page, { copy = true, poker = false } = {}) {
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create next page' });
  await dialog.getByLabel('Copy current page content').setChecked(copy);
  if (poker) await dialog.getByLabel('Include drawings created during poker', { exact: false }).check();
  await dialog.getByRole('button', { name: 'Create page', exact: true }).click();
  await expect(page.getByLabel('Canvas page', { exact: true })).toBeEnabled();
}

test('page copies preserve sticky bindings and synchronize selection, blank pages and poker options', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage();
    const b = await bob.newPage();
    const errors = [];
    a.on('pageerror', error => errors.push(error.message));
    b.on('pageerror', error => errors.push(error.message));
    await login(a, 'alice');
    await login(b, 'bob');
    board = await api(alice, '/api/boards', { name: `Page verification ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    const aStates = snapshots(a);
    const bStates = snapshots(b);
    await a.goto(`/b/${board.id}`);
    await b.goto(`/b/${board.id}`);
    await expect(a.getByRole('button', { name: 'Sticky note' })).toBeEnabled();
    await expect(b.getByText('2/10', { exact: true })).toBeVisible();
    const originalPage = aStates.at(-1).board.pageId;
    await a.getByRole('button', { name: 'Sticky note' }).click();
    await createPage(a);
    await expect.poll(() => aStates.at(-1)?.pages.length).toBe(2);
    await expect.poll(() => bStates.at(-1)?.board.pageId).toBe(aStates.at(-1).board.pageId);
    const copied = aStates.at(-1);
    const box = copied.elements.find(element => element.type === 'rectangle');
    const text = copied.elements.find(element => element.type === 'text');
    expect(text.containerId).toBe(box.id);
    expect(box.boundElements).toContainEqual({ id: text.id, type: 'text' });
    await a.screenshot({ path: testInfo.outputPath('copied-page-desktop.png') });
    await a.setViewportSize({ width: 390, height: 844 });
    await a.screenshot({ path: testInfo.outputPath('copied-page-mobile.png') });
    await a.setViewportSize({ width: 1440, height: 1000 });
    await b.getByLabel('Canvas page', { exact: true }).selectOption(originalPage);
    await expect.poll(() => aStates.at(-1)?.board.pageId).toBe(originalPage);
    expect(aStates.at(-1).elements.some(element => element.id === box.id)).toBe(false);
    await createPage(a, { copy: false });
    await expect.poll(() => aStates.at(-1)?.pages.length).toBe(3);
    expect(aStates.at(-1).elements).toEqual([]);
    const pokerPage = aStates.at(-1).board.pageId;
    await a.getByRole('button', { name: 'Start poker' }).click();
    await expect(b.getByRole('button', { name: 'New page', exact: true })).toBeDisabled();
    await expect(b.getByLabel('Canvas page', { exact: true })).toBeDisabled();
    await b.getByRole('button', { name: 'Sticky note' }).click();
    b.once('dialog', dialog => dialog.accept());
    await b.getByRole('button', { name: 'Stop poker and reveal', exact: true }).click();
    await expect(a.getByRole('button', { name: 'Start poker' })).toBeEnabled();
    await createPage(a);
    await expect.poll(() => aStates.at(-1)?.pages.length).toBe(4);
    expect(aStates.at(-1).elements).toEqual([]);
    await a.getByLabel('Canvas page', { exact: true }).selectOption(pokerPage);
    await expect.poll(() => aStates.at(-1)?.board.pageId).toBe(pokerPage);
    await createPage(a, { poker: true });
    await expect.poll(() => aStates.at(-1)?.pages.length).toBe(5);
    expect(aStates.at(-1).elements).toHaveLength(2);
    expect(aStates.at(-1).pokerCreatedIds).toHaveLength(2);
    await expect.poll(() => bStates.at(-1)?.board.pageId).toBe(aStates.at(-1).board.pageId);
    expect(errors).toEqual([]);
  } finally {
    if (board) await alice.request.delete(`${base}/api/boards/${board.id}`, { headers: { Origin: base } });
    await alice.close();
    await bob.close();
  }
});
