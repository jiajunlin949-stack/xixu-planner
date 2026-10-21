const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
async function openCapture(page){const toggle=page.locator('[data-action="scratch-toggle"]');if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()}
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const seed={format:'xixu-backup',schemaVersion:9,termStart:'2026-08-31',scheduleSettings:{preset:'sztu',count:14,periods:[]},courses:[],lessons:[],tasks:[],notes:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true,activeConversationId:'default'}};
  await page.addInitScript(value=>{if(!localStorage.getItem('xixu-v1'))localStorage.setItem('xixu-v1',JSON.stringify(value))},seed);
  await page.goto('http://127.0.0.1:'+server.address().port);
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(state.schemaVersion,10);assert.deepEqual(state.scratchEntries,[]);

  const first='技术栈了解一遍概念\n把简历发给 AI 整理工作流\n给简历增加专业内容';
  await openCapture(page);
  await page.locator('#xixu-scratch-form textarea').fill(first);await page.locator('#xixu-scratch-form button[type=submit]').click();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.scratchEntries.length,1);assert.equal(state.scratchEntries[0].text,first);
  await page.reload();await openCapture(page);assert.match(await page.locator('.xixu-scratch-stream').innerText(),/整理工作流/);

  await page.locator('.xixu-scratch-stream button').first().click();await page.locator('#xixu-scratch-edit-form textarea').fill(first+'\n周末再慢慢整理');await page.getByRole('button',{name:/保存修改/}).click();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.match(state.scratchEntries[0].text,/周末再慢慢整理/);
  await page.locator('.xixu-scratch-stream button').first().click();await page.getByRole('button',{name:'删除这条碎片'}).click();assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')))).scratchEntries.length,0);await page.getByRole('button',{name:'撤销'}).click();assert.equal((await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')))).scratchEntries.length,1);

  await page.getByRole('button',{name:'搜索记录',exact:true}).click();await page.locator('[name=query]').fill('周末再慢慢整理');await page.getByRole('button',{name:'搜索',exact:true}).click();assert.match(await page.locator('#tide-main').innerText(),/碎片/);
  await page.getByRole('button',{name:'返回'}).click();

  await openCapture(page);await page.locator('#xixu-scratch-form textarea').fill('明天整理课程汇报提纲');await page.locator('#xixu-scratch-form button[type=submit]').click();await openCapture(page);await page.locator('.xixu-scratch-stream button').filter({hasText:'明天整理课程汇报提纲'}).click();await page.getByRole('button',{name:/变成任务/}).click();
  assert.equal(await page.locator('[name=title]').inputValue(),'明天整理课程汇报提纲');assert.equal(await page.locator('[name=note]').inputValue(),'明天整理课程汇报提纲');await page.getByRole('button',{name:/保存事项/}).click();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.ok(state.tasks.some(item=>item.title==='明天整理课程汇报提纲'));assert.ok(!state.scratchEntries.some(item=>item.text.includes('课程汇报')));

  await openCapture(page);await page.locator('#xixu-scratch-form textarea').fill('读完一本书之后的零散感受');await page.locator('#xixu-scratch-form button[type=submit]').click();await openCapture(page);await page.locator('.xixu-scratch-stream button').filter({hasText:'零散感受'}).click();await page.getByRole('button',{name:/收进笔记/}).click();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.ok(state.notes.some(item=>item.text==='读完一本书之后的零散感受'));assert.ok(!state.scratchEntries.some(item=>item.text.includes('零散感受')));
  await page.getByRole('button',{name:'返回'}).click();await page.getByRole('button',{name:'提醒与设置'}).click();await page.getByRole('button',{name:/汐序 Agent/}).click();await page.locator('[name=question]').fill('找一下我写过的碎片，里面提到整理工作流的');await page.getByRole('button',{name:'发送'}).click();
  const retrieved=page.locator('.xixu-agent-refs');await retrieved.waitFor();
  const retrievalState=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1'))),fragment=retrievalState.scratchEntries.find(item=>item.text.includes('整理工作流')),reply=retrievalState.agentHistory.filter(item=>item.role==='assistant').at(-1);
  assert.ok(fragment&&reply?.retrievalRefs?.some(ref=>ref.recordType==='scratch'&&ref.id===fragment.id&&ref.text.includes('整理工作流')),'Agent must retrieve the actual matching fragment, not an unrelated source');
  await retrieved.locator('summary').click();assert.match(await retrieved.innerText(),/技术栈了解一遍概念/);

  await page.getByRole('button',{name:'返回'}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:/导出全部/}).click();const download=await downloadPromise,backupPath=await download.path(),backup=JSON.parse(fs.readFileSync(backupPath,'utf8'));assert.ok(Array.isArray(backup.scratchEntries));assert.match(backup.scratchEntries[0].text,/整理工作流/);
  const overflow=await page.evaluate(()=>({body:document.documentElement.scrollWidth-window.innerWidth,main:document.querySelector('#tide-main').scrollWidth-document.querySelector('#tide-main').clientWidth}));assert.ok(overflow.body<=1&&overflow.main<=1,JSON.stringify(overflow));
  await page.screenshot({path:path.resolve('work/scratch-stream-mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:12,checks:['v9 data migrates to v10 with an empty scratch stream','multiline fragments are created','fragments persist across reload','fragments can be edited','delete can be undone','global search finds fragments','task conversion carries title and note then removes the fragment','note conversion preserves text then removes the fragment','Agent retrieval returns the matching fragment','manual backup contains scratch entries','390px layout has no horizontal overflow','no page errors were raised']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
