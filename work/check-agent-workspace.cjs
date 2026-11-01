const {installModelFixture,approveFixtureRequests,savePlan}=require('./assistant-test-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('./browser-test-runtime.cjs');
const raw = path.resolve(__dirname, '../xixu-harmony/entry/src/main/resources/rawfile');
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  const file = path.join(raw, name);
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const createdAt = '2026-10-12T01:00:00Z';
const seed = {
  format: 'xixu-backup', schemaVersion: 10, termStart: '2026-08-31', courses: [], lessons: [], tasks: [],
  notes: [{ id: 'kb-1', title: '研究想法', text: '下次研究需要保留实验记录。', category: '想法', createdAt, updatedAt: createdAt, images: [] }],
  scratchEntries: [], ocrCorrectionRules: {},
  agentHistory: Array.from({ length: 104 }, (_, index) => ({ id: 'message-' + index, conversationId: 'old', role: index % 2 ? 'assistant' : 'user', text: '旧对话中的完整消息 ' + index, createdAt })),
  agentPreferences: { courses: true, tasks: true, notes: true, activeConversationId: 'old', conversations: { old: { title: '已有对话', createdAt, updatedAt: createdAt } }, conversationDrafts: {} },
};
let browser;
const checks = [];
function check(label, condition) { assert.ok(condition, label); checks.push(label); }
async function openAgent(page) { await page.locator('.tide-settings-fab').click(); await page.locator('[data-action="agent-open"]').click(); }
async function openDrawer(page, width) { if (width < 760) await page.locator('[data-action="agent-open-drawer"]').click(); }
async function select(page, id, width) { await openDrawer(page, width); await page.locator('[data-action="agent-select-conversation"][data-id="' + id + '"]').click(); }
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function state(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1'))); }

async function runCase(width) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce', hasTouch: width < 760, isMobile: width < 760 });
  await context.addInitScript(value => {
    if (!localStorage.getItem('xixu-v1')) localStorage.setItem('xixu-v1', JSON.stringify(value));
    window.__workspacePayloads = [];
    window.XixuAI = { hasKey: () => true, analyze(payload) { window.__workspacePayloads.push(JSON.parse(payload)); return true; } };
    window.XixuOCR = { recognizeAssistant() { window.__ocrStarted = true; return true; } };
    window.__workspaceReply = answer => window.XixuReceiveAI(true, 200, JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer, action: { type: 'none' } }) } }] }));
  }, seed);
  const p = await context.newPage(), errors = []; p.on('pageerror', error => errors.push(error.message));
  try {
    await installModelFixture(p);await approveFixtureRequests(p);await p.goto('http://127.0.0.1:' + server.address().port); await openAgent(p); await settle(p);
    check(width + ': older history is not silently truncated', (await state(p)).agentHistory.length === 104);
    check(width + ': history renders a bounded page', await p.locator('.xixu-agent-message').count() === 40);
    await p.locator('[data-action="agent-load-earlier"]').click();
    check(width + ': earlier messages load without deleting history', await p.locator('.xixu-agent-message').count() === 80 && (await state(p)).agentHistory.length === 104);
    check(width + ': no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const bounds = await p.locator('#xixu-agent-form').boundingBox();
    check(width + ': composer stays inside the viewport', bounds.y >= 0 && bounds.y + bounds.height <= 845);
    if (width < 760) {
      await openDrawer(p, width); check(width + ': drawer opens with accessible dialog', await p.getByRole('dialog', { name: '对话列表' }).isVisible());
      await p.locator('.xixu-agent-library').focus();await p.keyboard.press('Tab');
      check(width + ': Tab stays within the drawer', await p.locator('.xixu-agent-drawer-close').evaluate(el => el === document.activeElement));
      await p.keyboard.press('Shift+Tab');check(width + ': reverse Tab stays within the drawer', await p.locator('.xixu-agent-library').evaluate(el => el === document.activeElement));
      await p.keyboard.press('Escape'); check(width + ': Escape closes the drawer', !await p.locator('.xixu-agent-workspace').evaluate(el => el.classList.contains('is-drawer-open')));
      await openDrawer(p, width); await p.locator('.xixu-agent-drawer-scrim').click({ position: { x: width - 10, y: 150 } });
      check(width + ': outside click closes the drawer', !await p.locator('.xixu-agent-workspace').evaluate(el => el.classList.contains('is-drawer-open')));
      await openDrawer(p, width); await p.evaluate(() => window.XixuHandleSystemBack());
      check(width + ': system back closes drawer before leaving chat', await p.locator('.xixu-agent-workspace').count() === 1 && !await p.locator('.xixu-agent-workspace').evaluate(el => el.classList.contains('is-drawer-open')));
    } else check(width + ': desktop has a visible persistent sidebar', await p.locator('.xixu-agent-sidebar').isVisible());
    await p.locator('[name="question"]').fill('旧对话尚未发送的草稿');
    await p.getByRole('button', { name: '新对话', exact: true }).click();
    const freshId = (await state(p)).agentPreferences.activeConversationId;
    check(width + ': a new conversation preserves the previous draft', (await state(p)).agentPreferences.conversationDrafts.old === '旧对话尚未发送的草稿' && await p.locator('[name="question"]').inputValue() === '');
    await p.locator('[name="question"]').fill('新对话独立草稿'); await select(p, 'old', width);
    check(width + ': returning to a conversation restores its independent draft', await p.locator('[name="question"]').inputValue() === '旧对话尚未发送的草稿');
    await select(p, freshId, width); check(width + ': second draft remains separate', await p.locator('[name="question"]').inputValue() === '新对话独立草稿');
    await openDrawer(p, width);
    const row = p.locator('.xixu-agent-session').filter({ has: p.locator('[data-action="agent-select-conversation"][data-id="' + freshId + '"]') });
    await row.locator('summary').click(); await row.getByRole('button', { name: '重命名', exact: true }).click();
    await p.getByRole('textbox', { name: '对话名称' }).fill('研究与日程'); await p.locator('#xixu-agent-name-form button[type=submit]').click();
    if (width < 760) await p.locator('.xixu-agent-drawer-close').click();
    check(width + ': renamed conversation persists', (await state(p)).agentPreferences.conversations[freshId].title === '研究与日程');
    await p.locator('[name="question"]').fill('综合分析研究想法，先不要修改资料'); await p.getByRole('button', { name: '发送', exact: true }).click();
    await p.waitForFunction(() => window.__workspacePayloads.length === 1);
    await select(p, 'old', width); await p.locator('[name="question"]').fill('等待时仍可以编辑另一段对话的草稿');
    await p.evaluate(() => window.__workspaceReply('这条迟到回复只属于研究与日程。')); await settle(p);
    check(width + ': delayed response does not appear in another conversation', !await p.locator('.xixu-agent-history').innerText().then(text => text.includes('这条迟到回复只属于研究与日程。')));
    check(width + ': delayed response does not overwrite current draft', await p.locator('[name="question"]').inputValue() === '等待时仍可以编辑另一段对话的草稿');
    await select(p, freshId, width); check(width + ': delayed response is preserved in its origin conversation', (await p.locator('.xixu-agent-history').innerText()).includes('这条迟到回复只属于研究与日程。'));
    const reply = (await state(p)).agentHistory.find(item => item.text === '这条迟到回复只属于研究与日程。');
    check(width + ': retrieval sources are stored as small snapshots', reply.retrievalRefs.length > 0 && !JSON.stringify(reply.retrievalRefs).includes('tokenWeights'));
    await p.locator('.xixu-agent-refs summary').click(); check(width + ': retrieved note offers the original source', await p.getByRole('button', { name: '打开原文：研究想法' }).isVisible());
    await p.locator('[name="question"]').fill('重载后仍在这里的草稿'); await p.locator('[data-action="back"]').click();
    await p.reload(); await openAgent(p); check(width + ': reload preserves the named conversation and draft', await p.locator('[name="question"]').inputValue() === '重载后仍在这里的草稿' && (await state(p)).agentPreferences.conversations[freshId].title === '研究与日程');
    check(width + ': reload preserves retrieval sources', await p.locator('.xixu-agent-refs summary').count() > 0);
    const longDraft = '非常重要的长草稿。'.repeat(2300),beforeLong = (await state(p)).agentHistory.length;
    await p.locator('[name="question"]').fill(longDraft);await p.getByRole('button', { name: '发送', exact: true }).click();
    check(width + ': oversized message is explicitly rejected without truncating the draft', await p.locator('[name="question"]').inputValue() === longDraft && (await state(p)).agentHistory.length === beforeLong);
    await p.locator('[data-action="back"]').click();await p.reload();await openAgent(p);
    check(width + ': long rejected draft survives reload without corrupting stored history', await p.locator('[name="question"]').inputValue() === longDraft && (await state(p)).agentHistory.length === beforeLong);
    await p.locator('[name="question"]').fill('图片识别前的草稿');
    await p.locator('#xixu-agent-image').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=', 'base64') });
    await p.waitForFunction(() => window.__ocrStarted); await select(p, 'old', width); await p.evaluate(() => window.XixuReceiveAgentOCR(true, '图片里的重要文字')); await settle(p);
    check(width + ': delayed image recognition does not pollute another draft', !await p.locator('[name="question"]').inputValue().then(text => text.includes('图片里的重要文字')));
    await select(p, freshId, width); check(width + ': image recognition returns to its origin draft', (await p.locator('[name="question"]').inputValue()).includes('图片里的重要文字'));
    await p.getByRole('button', { name: '新对话', exact: true }).click();const disposableId=(await state(p)).agentPreferences.activeConversationId;
    await p.locator('[name="question"]').fill('这份草稿可以在撤销后回来');await openDrawer(p,width);
    const disposable=p.locator('.xixu-agent-session').filter({has:p.locator('[data-action="agent-select-conversation"][data-id="'+disposableId+'"]')});
    await disposable.locator('summary').click();await disposable.getByRole('button',{name:'删除对话',exact:true}).click();
    check(width + ': deleting a conversation waits for explicit confirmation', Boolean((await state(p)).agentPreferences.conversations[disposableId]));
    await p.getByRole('button',{name:'确认删除对话',exact:true}).click();
    check(width + ': confirmed conversation deletion does not remove knowledge notes', !(await state(p)).agentPreferences.conversations[disposableId]&&(await state(p)).notes.length===1);
    await p.getByRole('button',{name:'撤销',exact:true}).click();
    check(width + ': undo restores a deleted conversation and its complete draft', (await state(p)).agentPreferences.activeConversationId===disposableId&&await p.locator('[name="question"]').inputValue()==='这份草稿可以在撤销后回来');
    check(width + ': reduced motion disables drawer animation', await p.locator('.xixu-agent-sidebar').evaluate(el => getComputedStyle(el).transitionDuration === '0s'));
    check(width + ': no browser runtime errors', errors.length === 0);
    await p.screenshot({ path: path.join(__dirname, 'agent-workspace-' + width + '.png'), fullPage: true });
  } finally { await context.close(); }
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); browser = await chromium.launch(launchOptions);
  for (const width of [320, 390, 1280]) await runCase(width);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
