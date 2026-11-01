const {savePlan,undoPlan,installModelFixture,approveFixtureRequests}=require('./assistant-test-fixture.cjs');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { chromium, launchOptions } = require('./browser-test-runtime.cjs');

const root = path.resolve(__dirname, '..');
const web = path.join(root, 'xixu-harmony/web');
const raw = path.join(root, 'xixu-harmony/entry/src/main/resources/rawfile');
// Exercise current production modules without rewriting generated resources.
const moduleNames = JSON.parse(fs.readFileSync(path.join(web, 'modules', 'manifest.json'), 'utf8'));
const runtime = moduleNames.map(name => fs.readFileSync(path.join(web, 'modules', name), 'utf8')).join('\n');
const shell = fs.readFileSync(path.join(web, 'modules/shell.js'), 'utf8');
const insertion = '  function applyDesign(){';
assert.ok(shell.includes(insertion));
const compiled = shell.replace(insertion, runtime + '\n' + fs.readFileSync(path.join(web, 'motion.js'), 'utf8') + '\n' + insertion);
new vm.Script(compiled);
const server = http.createServer((req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end();
  const file = path.join(raw, name);
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream');
  res.end(name === 'app.js' ? compiled : fs.readFileSync(file));
});
const checks = [], errors = [];
let browser;
function check(label, condition) { assert.ok(condition, label); checks.push(label); }
async function saved(page) { return page.evaluate(() => JSON.parse(localStorage.getItem('xixu-v1'))); }
async function calls(page) { return page.evaluate(() => ({ ai: window.__routingAiCalls, knowledge: window.__routingKnowledgeCalls })); }
async function send(page, query) {
  const before = (await saved(page)).agentHistory.length;
  await page.locator('[name="question"]').fill(query);
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('xixu-v1')).agentHistory.length === count + 2, before);
}
async function latest(page) { return (await saved(page)).agentHistory.at(-1).text; }

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    window.__routingAiCalls = 0;
    window.__routingKnowledgeCalls = 0;
    window.__routingPaired = true;
    window.__routingHasKey = true;
    window.XixuAI = {
      hasKey: () => window.__routingHasKey,
      analyze() {
        window.__routingAiCalls++;
        setTimeout(() => window.XixuReceiveAI(true, 200, JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: '请说明要修改的资料标题和具体内容；尚未修改。', action: { type: 'none' } }) } }] })), 0);
        return true;
      },
    };
    window.XixuKnowledge = {
      status: () => JSON.stringify({ paired: window.__routingPaired }),
      call(id,op,raw) {
        const body=JSON.parse(raw);
        if(op==='chat-prepare'){
          window.__routingKnowledgeCalls++;
          setTimeout(()=>window.XixuReceiveKnowledge(id,true,JSON.stringify({model_configured:true,ticket:'fixture-ticket',destination:'https://model.example.invalid',model:'fixture-model',question:body.query,sources:[],source_refs:[],local_context:[]})),0);
        }else if(op==='chat-stream'){
          setTimeout(()=>{const events='data: '+JSON.stringify({type:'delta',text:'来自电脑知识库的合成回答'})+'\n\ndata: '+JSON.stringify({type:'done'})+'\n\n';window.XixuReceiveKnowledgeStream(id,'chunk',btoa(unescape(encodeURIComponent(events))));window.XixuReceiveKnowledgeStream(id,'end','')},0);
        }
        return true;
      },
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00+08:00'));
  await installModelFixture(page);await approveFixtureRequests(page);await page.goto('http://127.0.0.1:' + server.address().port);
  await page.locator('.tide-settings-fab').click();
  await page.locator('[data-action="agent-open"]').click();

  await send(page, '我的DDL是2026年10月30日18:00交工程报告');
  check('paired computer and configured model are bypassed for an explicit DDL', JSON.stringify(await calls(page)) === JSON.stringify({ ai: 0, knowledge: 0 }));
  check('DDL preview leaves tasks unchanged', (await saved(page)).tasks.length === 0);
  check('DDL has an actionable confirmation preview', await page.locator('[data-action="agent-confirm"]').count() === 1);
  check('DDL date and clock remain exact', await page.locator('[data-agent-field="date"]').inputValue() === '2026-10-30' && await page.locator('[data-agent-field="time"]').inputValue() === '18:00');
  await page.locator('[data-action="agent-confirm"]').click();await savePlan(page);
  let state = await saved(page);
  check('confirmation writes one DDL with the correct date, clock and type', state.tasks.length === 1 && state.tasks[0].date === '2026-10-30' && state.tasks[0].time === '18:00' && state.tasks[0].type === 'homework');
  await undoPlan(page);
  check('DDL confirmation remains reversible', (await saved(page)).tasks.length === 0);

  const body = '工程想法\n第二行保留  两个空格与 emoji 🧭';
  await send(page, '帮我记下来：' + body);
  check('explicit note creation makes zero model or computer calls', JSON.stringify(await calls(page)) === JSON.stringify({ ai: 0, knowledge: 0 }));
  check('note preview leaves notes unchanged', (await saved(page)).notes.length === 0);
  check('note body is visible before confirmation', await page.locator('.xixu-agent-note-preview').textContent() === body);
  await page.locator('[data-action="agent-confirm"]').click();await savePlan(page);
  state = await saved(page);
  check('note confirmation preserves its exact body and edit timestamp', state.notes.length === 1 && state.notes[0].text === body && state.notes[0].updatedAt === '2026-10-29T02:00:00.000Z');
  await undoPlan(page);
  check('note confirmation remains reversible', (await saved(page)).notes.length === 0);
  await send(page, '我想记录一下：口语记录也只在确认后保存');
  check('spoken first-person note request stays local and waits for confirmation', (await calls(page)).knowledge === 0 && (await calls(page)).ai === 0 && await page.locator('[data-action="agent-confirm"]').count() === 1 && (await saved(page)).notes.length === 0);
  await page.locator('[data-action="agent-dismiss"]').click();

  await send(page, '帮我添加任务：联系导师');
  check('ambiguous write request asks for a date locally', /哪一天|日期/.test(await latest(page)));
  check('ambiguous request neither calls providers nor writes records', JSON.stringify(await calls(page)) === JSON.stringify({ ai: 0, knowledge: 0 }) && (await saved(page)).tasks.length === 0 && (await saved(page)).notes.length === 0);
  check('ambiguous request has no executable action', await page.locator('[data-action="agent-confirm"]').count() === 0);
  await send(page, '帮我记录一下');
  check('empty note command asks for content instead of being swallowed remotely', /正文|内容/.test(await latest(page)) && (await calls(page)).knowledge === 0);
  await send(page, '记下：什么是RAG');
  check('an explicitly quoted question can be saved as note text', await page.locator('.xixu-agent-note-preview').textContent() === '什么是RAG' && (await calls(page)).ai === 0 && (await calls(page)).knowledge === 0);
  await page.locator('[data-action="agent-dismiss"]').click();
  await send(page, '帮我添加事项：明天开会');
  check('meeting without a clock asks for the actual start time', /几点/.test(await latest(page)) && await page.locator('[data-action="agent-confirm"]').count() === 0);
  await send(page, '明天考试');
  check('exam without a clock does not invent a 23:59 appointment', /几点/.test(await latest(page)) && await page.locator('[data-action="agent-confirm"]').count() === 0 && (await saved(page)).tasks.length === 0);

  await send(page, '帮我添加任务：下周三18:00联系导师');
  check('qualified next-week date uses calendar week semantics', await page.locator('[data-agent-field="date"]').inputValue() === '2026-11-04');
  await page.locator('[data-action="agent-dismiss"]').click();
  await send(page, '帮我添加任务：周三18:00联系导师');
  check('bare weekday asks which week without a provider call', /本周|下周/.test(await latest(page)) && (await calls(page)).ai === 0 && (await calls(page)).knowledge === 0);
  check('ordinary task clarification does not ask for lesson periods', !/原来第几节|换到第几节|调课/.test(await latest(page)));
  let beforeChoice = (await saved(page)).agentHistory.length;
  await page.getByRole('button', { name: '下周', exact: true }).click();
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('xixu-v1')).agentHistory.length === count + 2, beforeChoice);
  const chosenFields = {date:await page.locator('[data-agent-field="date"]').inputValue(),time:await page.locator('[data-agent-field="time"]').inputValue(),title:await page.locator('[data-agent-field="title"]').inputValue()};
  assert.deepEqual(chosenFields,{date:'2026-11-04',time:'18:00',title:'联系导师'},'weekday choice preserves the task title, exact clock and requested week');
  checks.push('weekday choice preserves the task title, exact clock and requested week');
  check('weekday choice remains a local read-only preview', (await saved(page)).tasks.length === 0 && (await calls(page)).ai === 0 && (await calls(page)).knowledge === 0);
  await page.locator('[data-action="agent-confirm"]').click();await savePlan(page);
  state = await saved(page);
  check('weekday follow-up confirmation saves exactly the requested task', state.tasks.length === 1 && state.tasks[0].title === '联系导师' && state.tasks[0].date === '2026-11-04' && state.tasks[0].time === '18:00');
  await undoPlan(page);
  check('weekday follow-up creation is reversible without any API call', (await saved(page)).tasks.length === 0 && (await calls(page)).ai === 0 && (await calls(page)).knowledge === 0);
  await send(page, '帮我添加任务：周天18:00联系导师');
  beforeChoice = (await saved(page)).agentHistory.length;
  await page.getByRole('button', { name: '下周', exact: true }).click();
  await page.waitForFunction(count => JSON.parse(localStorage.getItem('xixu-v1')).agentHistory.length === count + 2, beforeChoice);
  check('spoken Sunday choice preserves its command and resolves without looping', await page.locator('[data-agent-field="date"]').inputValue() === '2026-11-08' && (await calls(page)).ai === 0 && (await calls(page)).knowledge === 0);
  await page.locator('[data-action="agent-dismiss"]').click();

  await send(page, '这份资料应该怎么理解？');
  check('ordinary questions still use the paired computer', (await calls(page)).knowledge === 1 && (await latest(page)).includes('合成回答'));
  await send(page, '添加任务需要什么步骤？');
  check('questions mentioning task creation are not mistaken for commands', (await calls(page)).knowledge === 2 && await page.locator('[data-action="agent-confirm"]').count() === 0);
  await send(page, '记住是什么意思？');
  check('questions mentioning remembering are not converted into notes', (await calls(page)).knowledge === 3 && (await saved(page)).notes.length === 0);
  await send(page, '我想知道如何记录会议内容');
  check('first-person informational question still uses read-only retrieval', (await calls(page)).knowledge === 4 && (await saved(page)).notes.length === 0);
  for (const question of ['明天考试几点？', '明天我有考试吗？', '明天的DDL还有多少？', '帮我看看明天考试几点']) {
    const count = (await calls(page)).knowledge;
    await send(page, question);
    check('read-only deadline/exam question is not turned into a task: ' + question, (await calls(page)).knowledge === count + 1 && await page.locator('[data-action="agent-confirm"]').count() === 0 && (await saved(page)).tasks.length === 0);
  }
  await send(page, '帮我修改那个安排');
  check('unresolved mutations bypass the read-only computer and reach structured model parsing', (await calls(page)).knowledge === 8 && (await calls(page)).ai === 1);
  check('unresolved mutation is explicitly clarified without writes', /标题|内容/.test(await latest(page)) && (await saved(page)).tasks.length === 0 && (await saved(page)).notes.length === 0);
  await send(page, '帮我把DDL改到明天可以吗');
  check('a polite deadline update question still reaches structured model parsing', (await calls(page)).knowledge === 8 && (await calls(page)).ai === 2 && await page.locator('[data-action="agent-confirm"]').count() === 0);

  await page.evaluate(() => { window.__routingPaired = false; });
  await send(page, '请解释一下什么是检索增强生成');
  check('ordinary questions use the model when no computer is paired', (await calls(page)).ai === 3 && (await calls(page)).knowledge === 8);
  await page.evaluate(() => { window.__routingHasKey = false; window.__routingPaired = true; });
  await send(page, '帮我更新那条笔记');
  check('unresolved write without a model cannot be consumed as successful read-only chat', /更具体|标题|联网解析/.test(await latest(page)) && (await calls(page)).knowledge === 8 && (await saved(page)).notes.length === 0);
  check('no browser errors', errors.length === 0);
  console.log(JSON.stringify({ passed: checks.length, checks, errors, externalApisCalled: false }, null, 2));
  await context.close();
})().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.close(); });
