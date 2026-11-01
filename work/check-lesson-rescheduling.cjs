const {savePlan,undoPlan}=require('./assistant-test-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
const seed=(conflict=false)=>({format:'xixu-backup',schemaVersion:10,termStart:'2026-08-31',courses:[{id:'c1',name:'软件工程',short:'软工',mark:'软'}],lessons:[{id:'l1',course:'c1',day:4,block:0,period:'1–2',room:'教学楼 302',weeks:[4],rule:'第 4 周'}].concat(conflict?[{id:'l2',course:'c1',day:2,block:0,period:'1–2',room:'教学楼 105',weeks:[5],rule:'第 5 周'}]:[]),tasks:[],notes:[],scratchEntries:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true}});
async function openPage(browser,value){const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});await page.clock.install({time:new Date('2026-09-27T09:00:00+08:00')});await page.addInitScript(state=>{if(!localStorage.getItem('xixu-v1'))localStorage.setItem('xixu-v1',JSON.stringify(state))},value);await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'提醒与设置'}).click();await page.getByRole('button',{name:/汐序 Agent/}).click();return page}
function message(){return '9月25号的软件工程一二节课调到了我的这一个9月30号的早上一二节课'}
async function ask(page){await page.locator('[name=question]').fill(message());await page.getByRole('button',{name:'发送'}).click()}
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await openPage(browser,seed()),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await ask(page);await page.getByText('调课',{exact:true}).waitFor();
  assert.match(await page.locator('.xixu-reschedule-preview').innerText(),/软件工程/);assert.deepEqual(await page.locator('.xixu-reschedule-preview input').evaluateAll(inputs=>Object.fromEntries(inputs.map(input=>[input.name,input.value]))),{sourceDate:'2026-09-25',sourcePeriods:'1-2',targetDate:'2026-09-30',targetPeriods:'1-2'});
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.lessons.length,1);assert.equal(state.lessons[0].cancelledDates,undefined);
  await page.getByRole('button',{name:'确认调课'}).click();await savePlan(page);
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.lessons.length,2);assert.deepEqual(state.lessons[0].cancelledDates,['2026-09-25']);assert.equal(state.lessons[1].dateOverride,'2026-09-30');assert.equal(state.lessons[1].period,'1–2');assert.deepEqual(state.lessons[1].weeks,[5]);
  await undoPlan(page);state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.lessons.length,1);assert.equal(state.lessons[0].cancelledDates,undefined);
  await ask(page);await page.getByText('调课',{exact:true}).waitFor();await page.getByRole('button',{name:'确认调课'}).click();await savePlan(page);
  await page.getByText(/已按核对内容保存/).last().waitFor();
  await page.reload();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.lessons.length,2);assert.equal(state.lessons[1].dateOverride,'2026-09-30');
  await page.locator('button[data-action="nav"][data-page="today"]').click();
  let dayButton=page.locator('[data-action=home-day][data-date="2026-09-27"]');assert.equal(await dayButton.getAttribute('aria-current'),'date');assert.equal(await dayButton.locator('strong').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(182, 71, 85)');
  await page.locator('[data-action=home-day][data-date="2026-09-25"]').click();assert.equal(await page.locator('.xixu-home-lesson.is-rescheduled-out').count(),1);assert.equal(await page.locator('.xixu-home-lesson.is-rescheduled-out').evaluate(node=>getComputedStyle(node).opacity),'0.27');
  await page.getByRole('button',{name:'下一周'}).click();dayButton=page.locator('[data-action=home-day][data-date="2026-09-30"]');assert.ok((await dayButton.getAttribute('class')).includes('has-reschedule'));
  await page.locator('[data-action=home-day][data-date="2026-09-30"]').click();assert.equal(await page.locator('.xixu-home-lesson.is-rescheduled-in').count(),1);assert.equal(await page.locator('.xixu-home-lesson.is-rescheduled-in').evaluate(node=>getComputedStyle(node).backgroundImage).then(value=>value.includes('linear-gradient')),true);
  const conflict=await openPage(browser,seed(true));await ask(conflict);await conflict.getByText(/新时间和现有课程冲突/).waitFor();assert.equal(await conflict.locator('.xixu-reschedule-preview').count(),0);state=await conflict.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.lessons.length,2);assert.equal(state.lessons[0].cancelledDates,undefined);
  const incomplete=await openPage(browser,seed());await incomplete.locator('[name=question]').fill('我想把软件工程调课');await incomplete.getByRole('button',{name:'发送'}).click();await incomplete.getByText(/原日期和调入日期都告诉我/).waitFor();assert.equal((await incomplete.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')))).lessons.length,1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:13,checks:['date and period extraction from natural Chinese request','preview lists source and destination','no write before confirmation','confirm stores source cancellation and single-date destination','reschedule confirmation can be undone','reschedule survives reload','today is distinctly highlighted red','destination day has independent incoming marker','source occurrence is visibly faded','incoming course has its own high-contrast treatment','occupied destination is rejected without mutation','incomplete request asks for required details','no browser errors']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
