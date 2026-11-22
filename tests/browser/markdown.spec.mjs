import { test, expect } from '../../frontend/node_modules/playwright/test.mjs';
import { api, base, login } from './helpers.mjs';

const ticket = '# CANVAS-42: Markdown notes\n\n**Owner:** Team Canvas\n\n## Acceptance criteria\n- [x] Render Markdown\n- [ ] Verify permissions\n\n| Field | Value |\n| --- | --- |\n| Status | Ready |\n\n[Ticket](https://example.com/ticket/42)\n\n```ts\nconst ready = true;\n```';
const note = page => page.getByRole('article', { name: 'Markdown note', exact: true });
async function newNote(page, source = ticket) {
  await page.getByRole('button', { name: 'Markdown note', exact: true }).click();
  await page.getByLabel('Markdown source', { exact: true }).fill(source);
  await expect(page.getByRole('region', { name: 'Markdown preview' }).getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Save Markdown note', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'New Markdown note', exact: true })).toBeHidden();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
}

test('Markdown tickets render, synchronize, edit safely, undo and persist on desktop and mobile', async ({ browser }, testInfo) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(), b = await bob.newPage();
    const errors = [];
    const consoleProblems = [];
    for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));
    for (const page of [a, b]) page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleProblems.push(message.text()); });
    await login(a, 'alice'); await login(b, 'bob');
    consoleProblems.length = 0; // The sign-in screen's unauthenticated /api/me probe is expected.
    board = await api(alice, '/api/boards', { name: `Markdown verification ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    await Promise.all([a.goto(`${base}/b/${board.id}`), b.goto(`${base}/b/${board.id}`)]);
    await expect(a).toHaveTitle('Team Canvas');
    await expect(a).toHaveURL(new RegExp(`/b/${board.id}$`));
    await newNote(a);
    await expect(note(a).getByRole('heading', { name: 'CANVAS-42: Markdown notes', exact: true })).toBeVisible();
    await expect(note(b).getByRole('heading', { name: 'CANVAS-42: Markdown notes', exact: true })).toBeVisible();
    await expect(note(a).locator('table')).toContainText('Ready');
    await expect(note(a).getByRole('checkbox')).toHaveCount(2);
    await expect(note(a).locator('pre code')).toContainText('const ready = true;');
    await expect(note(a).getByRole('link', { name: 'Ticket', exact: true })).toHaveAttribute('href', 'https://example.com/ticket/42');
    await a.screenshot({ path: testInfo.outputPath('markdown-desktop.png') });
    // Selection is retained after insertion, allowing keyboard-accessible editing.
    await a.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
    await a.getByLabel('Markdown source', { exact: true }).fill('# Updated ticket\n\n- [ ] New criterion');
    await a.getByRole('button', { name: 'Save Markdown note', exact: true }).click();
    await expect(note(b).getByRole('heading', { name: 'Updated ticket', exact: true })).toBeVisible();
    await a.getByRole('button', { name: /^Undo/ }).click();
    await expect(note(b).getByRole('heading', { name: 'CANVAS-42: Markdown notes', exact: true })).toBeVisible();
    await a.getByRole('button', { name: /^Redo/ }).click();
    await expect(note(b).getByRole('heading', { name: 'Updated ticket', exact: true })).toBeVisible();
    await a.reload();
    await expect(note(a).getByRole('heading', { name: 'Updated ticket', exact: true })).toBeVisible();
    // Keep both source editors open and reject overwriting an edit already received.
    for (const page of [a, b]) {
      const box = await note(page).boundingBox();
      await page.mouse.click(box.x + 24, box.y + 20);
      await page.getByRole('button', { name: 'Edit Markdown', exact: true }).click();
    }
    await a.getByLabel('Markdown source', { exact: true }).fill('# My draft');
    await b.getByLabel('Markdown source', { exact: true }).fill('# Team update');
    await b.getByRole('button', { name: 'Save Markdown note', exact: true }).click();
    await expect(note(a).getByRole('heading', { name: 'Team update', exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Save Markdown note', exact: true }).click();
    await expect(a.getByRole('alert')).toContainText('Someone changed this note');
    await expect(a.getByLabel('Markdown source', { exact: true })).toHaveValue('# My draft');
    await a.getByRole('button', { name: 'Cancel', exact: true }).click();
    // No HTML execution or remote image requests from a note.
    const requests = [];
    a.on('request', request => { if (request.url().includes('markdown-tracker.invalid')) requests.push(request.url()); });
    await newNote(a, '# Safety\n\n<script>window.markdownExecuted = true</script>\n\n[Bad](javascript:alert(1))\n\n![Tracking](https://markdown-tracker.invalid/pixel.png)');
    await expect(note(a)).toHaveCount(2);
    expect(await a.evaluate(() => window.markdownExecuted)).toBeUndefined();
    await expect(note(a).getByRole('link', { name: 'Bad', exact: true })).toHaveCount(0);
    await expect(note(a).locator('img,script,iframe')).toHaveCount(0);
    expect(requests).toEqual([]);
    await a.setViewportSize({ width: 390, height: 844 });
    await a.reload();
    await expect(a.getByText('Saved', { exact: true })).toBeVisible();
    await a.getByRole('button', { name: 'Markdown note', exact: true }).click();
    await expect(a.getByRole('dialog', { name: 'New Markdown note', exact: true })).toBeVisible();
    const dialog = await a.getByRole('dialog', { name: 'New Markdown note', exact: true }).boundingBox();
    expect(dialog.x).toBeGreaterThanOrEqual(0);
    expect(dialog.x + dialog.width).toBeLessThanOrEqual(390);
    await a.screenshot({ path: testInfo.outputPath('markdown-mobile-editor.png') });
    await a.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(a.locator('vite-error-overlay')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(consoleProblems).toEqual([]);
  } finally {
    if (board) await api(alice, `/api/boards/${board.id}`, undefined, 'DELETE', 204);
    await alice.close(); await bob.close();
  }
});

test('Markdown notes follow poker privacy and reveal with their source intact', async ({ browser }) => {
  const alice = await browser.newContext({ baseURL: base });
  const bob = await browser.newContext({ baseURL: base });
  let board;
  try {
    const a = await alice.newPage(), b = await bob.newPage();
    await login(a, 'alice'); await login(b, 'bob');
    board = await api(alice, '/api/boards', { name: `Markdown privacy ${Date.now()}` });
    const invitation = await api(alice, `/api/boards/${board.id}/invitations`, {});
    await api(bob, `/api/boards/${board.id}/join`, { inviteKey: invitation.inviteKey });
    await Promise.all([a.goto(`${base}/b/${board.id}`), b.goto(`${base}/b/${board.id}`)]);
    await newNote(a, '# Shared ticket');
    await a.getByRole('button', { name: 'Start poker', exact: true }).click();
    await expect(b.getByText('Poker round', { exact: false })).toBeVisible();
    await expect(note(a).getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
    await newNote(a, '# Private ticket\n\n- [ ] Secret criterion');
    await expect(note(a)).toHaveCount(2);
    await expect(note(b)).toHaveCount(1);
    const shared = await api(bob, `/api/boards/${board.id}/assistant`, undefined, 'GET');
    expect(shared.canvas.objects.map(object => object.text)).toEqual(['# Shared ticket']);
    await a.getByRole('button', { name: 'Stop poker and reveal', exact: true }).click();
    await a.getByRole('button', { name: 'Reveal saved contributions', exact: true }).click();
    await expect(note(b).getByRole('heading', { name: 'Private ticket', exact: true })).toBeVisible();
    await b.reload();
    await expect(note(b).getByRole('heading', { name: 'Private ticket', exact: true })).toBeVisible();
  } finally {
    if (board) await api(alice, `/api/boards/${board.id}`, undefined, 'DELETE', 204);
    await alice.close(); await bob.close();
  }
});
