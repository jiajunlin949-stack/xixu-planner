const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('./browser-test-runtime.cjs');

const raw = path.resolve(__dirname, '../xixu-harmony/entry/src/main/resources/rawfile');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((request, response) => {
  const name = request.url === '/' ? 'index.html' : request.url.slice(1), file = path.join(raw, name);
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

const editedAt = '2026-10-03T12:05:06.789+08:00';
const createdAt = '2026-09-01T01:02:03.004Z';
const originalText = '  第一行保留前后空白\r\n\r\n最后一行仍有空白 \t\n';
const originalTitle = '  ' + '完整标题'.repeat(30) + '  ';
const seed = {
  format: 'xixu-backup', schemaVersion: 9, termStart: '2026-08-31', courses: [], lessons: [], tasks: [], scratchEntries: [], ocrCorrectionRules: {},
  notes: [
    { id: 'known', title: originalTitle, text: originalText, category: '笔记', course: '', images: [], createdAt, updatedAt: editedAt, sourceId: 'source-note-keep-me', sourceMetadata: { extra: '原始字段必须保留' } },
    { id: 'unknown', title: '没有来源时间', text: '旧数据缺少时间，不能用导入或启动时间补齐。', category: '笔记', course: '', images: [] },
    { id: 'created-only', title: '仅提供创建时间', text: '创建时间不代表编辑时间。', category: '笔记', course: '', images: [], createdAt },
    { id: 'invalid', title: '原始格式不明确', text: '不能改写不可识别的时间字段。', category: '笔记', course: '', images: [], createdAt: '', updatedAt: '原始时间-格式未知-但必须完整保留' },
    { id: 'invalid-calendar', title: '来源日期不存在', text: '二月三十一日不能被转换为三月。', category: '笔记', course: '', images: [], createdAt: '', updatedAt: '2026-02-31T12:05:06+08:00' },
    { id: 'local-source', title: '来源没有时区', text: '未知时区不能被假定成北京时间。', category: '笔记', course: '', images: [], createdAt: '', updatedAt: '2026-10-03 12:05:06' },
  ],
};
const checks = [];
function check(label, condition) { assert.ok(condition, label); checks.push(label); }
async function state(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1'))); }
async function saveNote(page) {
  await page.locator('#xixu-note-form button[type="submit"]').click();
  await page.locator('.xixu-note-list').waitFor();
}
async function openNote(page, id) {
  await page.locator('.xixu-note-card[data-id="' + id + '"]').click();
  await page.locator('#xixu-note-form').waitFor();
}

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-12T05:10:11.000Z'));
  await page.addInitScript(value => { if (!localStorage.getItem('xixu-v1')) localStorage.setItem('xixu-v1', JSON.stringify(value)); }, seed);
  await page.goto('http://127.0.0.1:' + server.address().port);
  const homeBefore = (await state(page)).notes.map(note => [note.id, note.createdAt, note.updatedAt]);
  const homeKnown = page.locator('.xixu-home-record[data-id="known"] time'), homeUnknown = page.locator('.xixu-home-record[data-id="invalid"] time');
  check('home keeps known edit times visually compact as a date', (await homeKnown.innerText()) === '2026/10/03');
  check('home exposes full edit time for inspection and accessibility', (await homeKnown.getAttribute('title')) === '上次编辑：2026/10/03 12:05:06' && (await homeKnown.getAttribute('aria-label')) === '上次编辑：2026/10/03 12:05:06' && (await homeKnown.getAttribute('datetime')) === editedAt);
  check('home marks unknown source times explicitly instead of saying just now', (await homeUnknown.innerText()) === '时间未知' && !/刚刚/.test(await page.locator('.xixu-home-recent').innerText()));
  await page.locator('[data-action="home-week"][data-direction="1"]').click();
  await page.locator('[data-action="home-today"]').click();
  check('home date navigation and record-time rendering do not edit source timestamps', JSON.stringify((await state(page)).notes.map(note => [note.id, note.createdAt, note.updatedAt])) === JSON.stringify(homeBefore));
  await page.locator('#tide-nav [data-page="notes"]').click();
  let saved = await state(page), known = saved.notes.find(note => note.id === 'known');
  check('migration preserves full existing title and whitespace/CRLF body', known.title === originalTitle && known.text === originalText);
  check('migration preserves exact source timestamps, including offset and milliseconds', known.updatedAt === editedAt && known.createdAt === createdAt);
  check('legacy missing timestamps remain unknown, not startup time', saved.notes.find(note => note.id === 'unknown').updatedAt === '' && saved.notes.find(note => note.id === 'unknown').createdAt === '');
  check('createdAt is not relabeled as an edit time', saved.notes.find(note => note.id === 'created-only').updatedAt === '');
  check('unrecognized original timestamp is preserved without truncation', saved.notes.find(note => note.id === 'invalid').updatedAt === seed.notes[3].updatedAt);
  check('notes list has a plain-language last-edit label', (await page.locator('.xixu-note-card[data-id="known"] [data-note-timestamp="edited"]').innerText()) === '上次编辑：2026/10/03 12:05');
  check('missing edit time is explicit in the notes list', (await page.locator('.xixu-note-card[data-id="created-only"] [data-note-timestamp="edited"]').innerText()) === '上次编辑：未知');
  check('nonexistent source dates are not rolled forward into a guessed edit date', (await page.locator('.xixu-note-card[data-id="invalid-calendar"] [data-note-timestamp="edited"]').innerText()) === '上次编辑：未知');

  await openNote(page, 'local-source');
  check('timezone-less source values are displayed without guessing Beijing time', (await page.locator('#xixu-note-form [data-note-timestamp="edited"]').innerText()) === '上次编辑：2026/10/03 12:05:06（源时区未提供）');
  await saveNote(page);

  await openNote(page, 'known');
  check('editor shows exact seconds and identifies Beijing time', (await page.locator('#xixu-note-form [data-note-timestamp="edited"]').innerText()) === '上次编辑：2026/10/03 12:05:06（北京时间）');
  check('machine-readable time retains original source value', (await page.locator('#xixu-note-form [data-note-timestamp="edited"]').getAttribute('datetime')) === editedAt);
  check('creation time has its own independent label', /创建时间：2026\/09\/01 09:02:03/.test(await page.locator('#xixu-note-form [data-note-timestamp="created"]').innerText()));
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 844 });
    const appearance = await page.locator('.xixu-note-timestamps').evaluate(element => {
      const style = getComputedStyle(element.querySelector('time'));
      return { background: style.backgroundColor, shadow: style.boxShadow, border: style.borderTopWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    check(width + 'px: timestamp is unframed text without horizontal overflow', appearance.background === 'rgba(0, 0, 0, 0)' && appearance.shadow === 'none' && appearance.border === '0px' && !appearance.overflow);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await saveNote(page);
  saved = await state(page); known = saved.notes.find(note => note.id === 'known');
  check('save without real edits preserves original edit time', known.updatedAt === editedAt);
  check('save without real edits preserves body, title, creation and extra metadata', known.text === originalText && known.title === originalTitle && known.createdAt === createdAt && known.sourceId === 'source-note-keep-me' && known.sourceMetadata.extra === '原始字段必须保留');

  await openNote(page, 'known');
  const editedText = '  真实修改后的内容\n前后空白继续保留  ';
  await page.locator('[name="noteText"]').fill(editedText);
  await saveNote(page);
  known = (await state(page)).notes.find(note => note.id === 'known');
  check('a real content edit sets a new updatedAt', known.updatedAt === '2026-10-12T05:10:11.000Z');
  check('a real edit does not rewrite original createdAt or other provenance', known.createdAt === createdAt && known.sourceId === 'source-note-keep-me');
  check('edited body is stored verbatim, without trimming', known.text === editedText);
  await page.clock.setFixedTime(new Date('2026-10-12T05:10:30.000Z'));
  await openNote(page, 'known'); await saveNote(page);
  check('a later no-op save does not bump updatedAt', (await state(page)).notes.find(note => note.id === 'known').updatedAt === '2026-10-12T05:10:11.000Z');
  await openNote(page, 'unknown');
  check('editor explicitly labels unknown edit time', (await page.locator('#xixu-note-form [data-note-timestamp="edited"]').innerText()) === '上次编辑：未知');
  await saveNote(page);
  check('no-op save of an old unknown-time note does not fabricate timestamps', (await state(page)).notes.find(note => note.id === 'unknown').updatedAt === '' && (await state(page)).notes.find(note => note.id === 'unknown').createdAt === '');

  const beforeSearch = (await state(page)).notes.map(note => [note.id, note.createdAt, note.updatedAt]);
  await page.locator('#xixu-note-search [name="noteSearch"]').fill('真实修改');
  await page.locator('#xixu-note-search').evaluate(form => form.requestSubmit());
  check('search and rendering do not edit note timestamps', JSON.stringify((await state(page)).notes.map(note => [note.id, note.createdAt, note.updatedAt])) === JSON.stringify(beforeSearch));
  await page.locator('[data-action="clear-note-search"]').click();

  // Generic, already-supported JSON fixtures only; not a claim about Huawei's export format.
  const importText = '  JSON 中的原始文字\r\n第二行\t  ';
  const jsonFixture = [{ title: '有来源时间的导入', text: importText, createdAt, updatedAt: editedAt }, { title: '不含来源时间的导入', text: '没有明确来源时间时必须显示未知。' }];
  await page.locator('.tide-settings-fab').click();
  await page.locator('#xixu-note-import-files').setInputFiles({ name: 'supported-notes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(jsonFixture), 'utf8') });
  await page.locator('#xixu-note-import-review').waitFor();
  await page.locator('#xixu-note-import-review button[type="submit"]').click();
  saved = await state(page);
  const imported = saved.notes.find(note => note.title === '有来源时间的导入'), missing = saved.notes.find(note => note.title === '不含来源时间的导入');
  assert.ok(imported && missing, 'both JSON fixture notes must be committed: ' + JSON.stringify(saved.notes.map(note => ({ title: note.title, updatedAt: note.updatedAt }))));
  check('generic JSON import retains source creation and edit timestamps independently', imported.createdAt === createdAt && imported.updatedAt === editedAt);
  check('generic JSON text remains verbatim', imported.text === importText);
  check('importedAt is recorded separately from source edit time', imported.importedAt === '2026-10-12T05:10:30.000Z' && imported.importedAt !== imported.updatedAt);
  check('file modification/import times do not invent unknown source note times', missing.updatedAt === '' && missing.createdAt === '' && missing.importedAt === '2026-10-12T05:10:30.000Z');
  await openNote(page, imported.id); await saveNote(page);
  const unchangedImport = (await state(page)).notes.find(note => note.id === imported.id);
  check('no-op saving an imported note preserves source timestamps, CRLF and importedAt', unchangedImport.updatedAt === editedAt && unchangedImport.createdAt === createdAt && unchangedImport.text === importText && unchangedImport.importedAt === imported.importedAt);
  await page.reload();
  check('timestamp fidelity survives reload', (await state(page)).notes.find(note => note.id === imported.id).updatedAt === editedAt);
  check('no browser runtime errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, environment: 'Desktop Chromium fixture; generic JSON only, no Huawei-format or device claim', checks }, null, 2));
  await context.close();
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
