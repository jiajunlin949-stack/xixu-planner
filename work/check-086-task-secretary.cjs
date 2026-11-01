const {savePlan}=require('./assistant-test-fixture.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});

let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);

  await page.locator('[data-action="add"]').first().click();
  assert.match(await page.locator('#tide-main').innerText(), /告诉汐序秘书一件事/);
  await page.screenshot({ path: 'work/check-086-create-hub.png', fullPage: true });

  await page.locator('[data-action="create-task"]').click();
  const time = page.locator('input[name="time"]');
  assert.equal(await time.inputValue(), '');
  const timeTrigger = page.locator('#tide-time-field .xixu-control-trigger');
  assert.match(await timeTrigger.innerText(), /不设置时间/);
  await page.evaluate(() => {
    window.__nativeTimeClicks = 0;
    document.querySelector('input[name="time"]').addEventListener('click', () => window.__nativeTimeClicks++);
  });
  await timeTrigger.click();
  assert.equal(await page.evaluate(() => window.__nativeTimeClicks), 0);
  assert.equal(await page.locator('.xixu-control-panel').count(), 1);
  assert.match(await page.locator('.xixu-time-empty').innerText(), /不设置时间/);
  await page.screenshot({ path: 'work/check-086-time-picker.png', fullPage: true });
  await page.locator('.xixu-time-empty').click();
  assert.equal(await time.inputValue(), '');

  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="create-homework"]').click();
  assert.equal(await page.locator('input[name="time"]').inputValue(), '23:59');
  await page.locator('#tide-type').selectOption('task');
  assert.equal(await page.locator('input[name="time"]').inputValue(), '');
  assert.match(await page.locator('#tide-time-field .xixu-control-trigger').innerText(), /不设置时间/);
  assert.match(await page.locator('.tide-sub').innerText(), /每日任务没有截止时间/);

  await page.locator('[data-action="back"]').click();
  await page.locator('[data-action="agent-open"]').click();
  await page.locator('#xixu-agent-form textarea').fill('明天复习英语📚🙂');
  await page.locator('#xixu-agent-form button[type="submit"]').click();
  await page.locator('[data-action="agent-confirm"]').waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1')).tasks.length), 0);
  assert.match(await page.locator('.xixu-agent-action').innerText(), /加入日程/);
  await page.locator('.xixu-agent-action [name="title"]').fill('复习英语精读📚🙂');
  await page.locator('.xixu-agent-action [name="date"]').fill('2026-10-03');
  await page.locator('.xixu-agent-action [name="time"]').fill('18:30');
  await page.locator('.xixu-agent-action [name="type"]').selectOption('homework');
  await page.screenshot({ path: 'work/agent-editable-confirmation.png', fullPage: true });
  await page.locator('[data-action="agent-confirm"]').click();await savePlan(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1')).tasks.at(-1));
  assert.equal(saved.type, 'homework');
  assert.equal(saved.date, '2026-10-03');
  assert.equal(saved.time, '18:30');
  assert.match(saved.title, /复习英语精读/);
  assert.match(saved.title, /📚🙂/);
  await page.getByRole('button',{name:'查看已保存的安排'}).click();
  assert.equal(await page.locator('.tide-deadline-row[data-id="'+saved.id+'"]').count(),1);
  assert.ok((await page.locator('.tide-deadline-row[data-id="'+saved.id+'"]').getAttribute('class')).includes('xixu-cue-restore'));
  await page.reload();
  assert.match(await page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1')).tasks.at(-1).title), /📚🙂/);
  assert.deepEqual(errors, []);

  console.log(JSON.stringify({
    passed: 21,
    checks: [
      'center plus shows prominent secretary entry',
      'ordinary task starts without a plan time',
      'empty plan time is visibly selectable',
      'custom time trigger does not click native time input',
      'only one in-app time panel opens',
      'switching a deadline into a daily task clears 23:59',
      'switched daily task shows no planned time',
      'daily task wording explicitly removes deadline semantics',
      'deadline form keeps its own required time before switching',
      'secretary proposes a structured task locally',
      'secretary does not save before confirmation',
      'task title is editable before confirmation',
      'task date is editable before confirmation',
      'task time is editable before confirmation',
      'task type is editable before confirmation',
      'confirmed action exposes an explicit destination',
      'destination briefly highlights the new item',
      'emoji survives structured secretary input',
      'emoji survives local persistence and reload',
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
