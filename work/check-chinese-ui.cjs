const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('./browser-test-runtime.cjs');

// Chinese copy is the product language. This check intentionally covers only
// fixed chrome and labels; user-created course/task/note text may be any language.
const raw = path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  const file = path.join(raw, name);
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', mime[path.extname(file)] || 'text/plain');
  res.end(fs.readFileSync(file));
});

const chinese = /[\u4e00-\u9fff]/;
const staleEnglishChrome = /^(Today|Agenda|Timetable|Notes|Add|Back|Send|Settings|Reminders & settings|Close|Previous month|Next month|Done)$/;
let browser;

async function assertChineseChrome(page, label) {
  const text = await page.locator('#tide-main').innerText();
  assert.match(text, chinese, label + ' has Chinese fixed copy');
  const chrome = await page.locator('#tide-main [aria-label], #tide-main [placeholder], #tide-main [title]').evaluateAll(nodes =>
    nodes.flatMap(node => ['aria-label', 'placeholder', 'title'].map(name => node.getAttribute(name) || ''))
  );
  assert.ok(chrome.every(value => !staleEnglishChrome.test(value)), label + ' has no stale English chrome labels');
}

async function fit(page, label) {
  const size = await page.locator('.tide-phone').evaluate(node => ({ scroll: node.scrollWidth, width: node.clientWidth }));
  assert.ok(size.scroll <= size.width + 1, label + ' has no horizontal overflow');
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(launchOptions);
  const url = 'http://127.0.0.1:' + server.address().port;

  for (const width of [320, 390, 900]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);

    // The app no longer spends the first row on a product badge/brand header.
    assert.ok(['zh-CN', 'zh', 'zh-Hans'].includes(await page.locator('html').getAttribute('lang')), 'document locale is Chinese');
    assert.equal(await page.locator('.tide-brand').count(), 0, 'brand strip remains removed');
    assert.equal(await page.locator('.tide-settings-fab').getAttribute('aria-label'), '提醒与设置');
    const fonts = await page.evaluate(async () => (await document.fonts.load('500 16px "Xixu Nunito"', '今天')).length);
    assert.equal(fonts, 1, 'bundled rounded font loads offline');
    assert.match(await page.locator('.xixu-home-calendar').evaluate(node => getComputedStyle(node).backdropFilter), /blur\(/, 'home calendar keeps restrained glass');
    const nav = await page.locator('#tide-nav button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label')));
    assert.ok(nav.includes('今天') && nav.includes('日程') && nav.includes('课表'), 'primary navigation stays Chinese');
    assert.ok(nav.every(value => chinese.test(value || '')), 'primary navigation labels use Chinese');
    await assertChineseChrome(page, 'Today');
    await fit(page, 'Today');

    const calendarLabels = await page.locator('.xixu-home-calendar [aria-label]').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label') || ''));
    assert.ok(calendarLabels.some(value => value === '上一周') && calendarLabels.some(value => value === '下一周'), 'calendar navigation uses Chinese labels');
    assert.ok(calendarLabels.every(value => !/Previous month|Next month|Today/.test(value)), 'calendar has no stale English labels');

    for (const [name, label] of [['agenda', 'Agenda'], ['timetable', 'Timetable'], ['notes', 'Notes']]) {
      await page.locator('#tide-nav [data-page="' + name + '"]').click();
      await assertChineseChrome(page, label);
      await fit(page, label);
    }

    await page.locator('.tide-settings-fab').click();
    await assertChineseChrome(page, 'Settings');
    await fit(page, 'Settings');
    const settings = await page.locator('#tide-main').innerText();
    assert.match(settings, /提醒|设置|课程|日程/, 'settings exposes Chinese product concepts');

    const agentEntry = page.locator('[data-action="agent-open"]');
    if (await agentEntry.count()) {
      await agentEntry.click();
      await assertChineseChrome(page, 'Agent');
      assert.match(await page.locator('#tide-main').innerText(), /汐序|从一句话开始|和汐序说点什么/, 'Agent chrome remains Chinese');
      assert.match(await page.locator('[name="question"]').getAttribute('placeholder'), /汐序/);
    }

    assert.deepEqual(errors, [], 'no browser runtime errors');
    await page.close();
  }

  console.log(JSON.stringify({
    passed: 8,
    checks: [
      'Chinese document locale and primary navigation',
      'brand strip remains removed',
      'rounded local font and glass shell remain exercised by the shared page',
      'calendar picker uses Chinese labels',
      'Today, Agenda, Timetable, and Notes screens use Chinese chrome',
      'Settings and Agent entry use Chinese chrome',
      '320/390/900px layouts have no horizontal overflow',
      'no browser runtime errors'
    ]
  }, null, 2));
})().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  server.close();
});
