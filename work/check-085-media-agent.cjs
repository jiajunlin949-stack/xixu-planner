const {installModelFixture,approveFixtureRequests,savePlan,undoPlan}=require('./assistant-test-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNk+M9Qz0AEYBxVSFUAAM0ABf4B6cQAAAAASUVORK5CYII=','base64');
// The production preview stages changes on a clone; capacity rejection must
// leave both the source and storage untouched.
const vm=require('node:vm'),core=fs.readFileSync('xixu-harmony/web/modules/assistant-core.js','utf8');
const start=core.indexOf('  function assistantPreviewPlan('),end=core.indexOf('  async function assistantApplyPlan(',start);
const limitedNote={id:'limit',title:'容量边界',text:'原'.repeat(49999),updatedAt:'2026-09-18T01:02:03Z'},unchangedLimit={...limitedNote};
const preview=vm.runInNewContext(core.slice(start,end)+'\nassistantPreviewPlan',{storageBlocked:false,lessons:[],assistantRows:()=>({notes:[limitedNote]}),assistantClone:value=>JSON.parse(JSON.stringify(value)),assistantStable:JSON.stringify,assistantShowSheet:()=>{throw Error('oversized append must not open a save preview')}});
assert.throws(()=>preview({type:'append_note',noteId:'limit',text:'新增'}),/超出容量/);
assert.deepEqual(limitedNote,unchangedLimit);
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:900}}),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const originalNoteText='  已经完成第一次沟通\r\n原始行尾验证\t\r\n  ',now=new Date().toISOString(),seed={format:'xixu-backup',schemaVersion:8,termStart:'2026-08-31',courses:[],lessons:[],tasks:[],notes:[{id:'n1',title:'申请记录',text:originalNoteText,category:'笔记',course:'',createdAt:now,updatedAt:now}],ocrCorrectionRules:{},agentHistory:[{role:'user',text:'旧问题'},{role:'assistant',text:'旧回答'}],agentPreferences:{courses:true,tasks:true,notes:true}};
  await page.addInitScript(value=>{localStorage.setItem('xixu-v1',JSON.stringify(value));window.XixuAI={hasKey:()=>true,analyze(payload){window.__mediaAgentPayload=JSON.parse(payload);setTimeout(()=>window.XixuReceiveAI(true,200,JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'我会把这次内容整理到申请记录，确认后写入。',action:{type:'append_note',noteId:'n1',text:'第二次沟通已经结束',reason:'继续补充同一主题'}})}}]})),10);return true},saveKey:()=>true,deleteKey:()=>true}},seed);
  await installModelFixture(page);await approveFixtureRequests(page);await page.goto('http://127.0.0.1:'+server.address().port);
  let state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(state.schemaVersion,10);assert.ok(state.agentHistory.every(item=>item.id));assert.deepEqual(state.notes[0].images,[]);

  await page.locator('[data-action="add"]').click();await page.locator('[data-action="create-task"]').click();
  assert.match(await page.locator('#tide-main').innerText(),/计划时间（可选）/);assert.equal(await page.locator('[name=time]').inputValue(),'');
  await page.locator('[name=title]').fill('只要求今天完成的事情');await page.locator('[name=date]').fill(today);
  await page.locator('#xixu-task-images').setInputFiles({name:'任务凭证.png',mimeType:'image/png',buffer:png});await page.locator('#xixu-task-image-list .xixu-attachment').waitFor();
  await page.getByRole('button',{name:/保存事项/}).click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].time,'');assert.equal(state.tasks[0].images.length,1);

  await page.locator('#tide-nav').getByRole('button',{name:'备忘录',exact:true}).click();await page.getByRole('button',{name:'新建笔记'}).click();
  assert.equal(await page.locator('[name=category]').count(),0);const noteTypography=await page.locator('#tide-planner').evaluate(node=>getComputedStyle(node).fontFamily);assert.match(noteTypography,/MiSans/);await page.locator('[name=noteText]').focus();const noteFocus=await page.locator('[name=noteText]').evaluate(node=>({border:getComputedStyle(node).borderStyle,outline:getComputedStyle(node).outlineStyle,shadow:getComputedStyle(node).boxShadow}));assert.equal(noteFocus.border,'none');assert.equal(noteFocus.outline,'none');assert.equal(noteFocus.shadow,'none');
  await page.locator('[name=noteTitle]').fill('图片笔记');await page.locator('#xixu-note-images').setInputFiles({name:'现场照片.png',mimeType:'image/png',buffer:png});await page.locator('#xixu-note-image-list .xixu-attachment').waitFor();
  await page.getByRole('button',{name:/保存/}).click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.length,2);assert.equal(state.notes[1].text,'');assert.equal(state.notes[1].images.length,1);
  await page.getByRole('button',{name:'新建笔记'}).click();await page.locator('[name=noteTitle]').fill('产品会议记录');await page.locator('[name=noteText]').fill('会议讨论了新版交互和下周安排。');await page.getByRole('button',{name:/保存/}).click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.at(-1).category,'会议');

  await page.locator('.xixu-agent-entry').click();assert.equal(await page.locator('#xixu-agent-note-target').count(),0);await page.locator('[name=question]').fill('把第二次沟通结果整理进申请记录');await page.getByRole('button',{name:'发送'}).click();await page.getByRole('button',{name:'确认操作'}).waitFor();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.find(note=>note.id==='n1').text,originalNoteText,'Preparing an append must leave the source body unchanged');assert.equal(state.notes.find(note=>note.id==='n1').updatedAt,now);
  await page.getByRole('button',{name:'确认操作'}).click();await savePlan(page);
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.find(note=>note.id==='n1').text,originalNoteText+'\n\n第二次沟通已经结束','Appending must preserve the entire existing body, including whitespace and CRLF');assert.equal(state.agentHistory.length,4);
  await undoPlan(page);state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.find(note=>note.id==='n1').text,originalNoteText,'Undo must restore the exact original body');assert.equal(state.notes.find(note=>note.id==='n1').updatedAt,now);
  await page.locator('.xixu-agent-history .is-user').last().locator('summary').click();await page.locator('.xixu-agent-history .is-user').last().getByRole('button',{name:'修改消息'}).click();assert.equal(await page.locator('[name=question]').inputValue(),'把第二次沟通结果整理进申请记录');await page.locator('[name=question]').fill('把修改后的第二次沟通整理进申请记录');await page.getByRole('button',{name:'重新发送'}).click();await page.getByRole('button',{name:'确认操作'}).waitFor();
  state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.agentHistory.length,4);assert.equal(state.agentHistory[2].text,'把修改后的第二次沟通整理进申请记录');
  await page.locator('.xixu-agent-history .is-user').last().locator('summary').click();await page.locator('.xixu-agent-history .is-user').last().getByRole('button',{name:'删除消息'}).click();state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.agentHistory.length,2);
  const protectedNoteText=state.notes.find(note=>note.id==='n1').text;await page.locator('[name=question]').fill('查找办理旅行护照签证需要的材料');await page.getByRole('button',{name:'发送'}).click();await page.waitForFunction(()=>JSON.parse(localStorage.getItem('xixu-v1')).agentHistory.length===4);assert.equal(await page.getByRole('button',{name:'确认操作'}).count(),0);state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(state.notes.find(note=>note.id==='n1').text,protectedNoteText);const ungroundedPrompt=await page.evaluate(()=>window.__mediaAgentPayload.messages.at(-1).content);assert.doesNotMatch(ungroundedPrompt,/\"id\":\"n1\"/);
  await page.screenshot({path:'work/check-085-media-agent.png',fullPage:true});
  console.log(JSON.stringify({passed:19,checks:['Schema v8 migrates to v10','Legacy Agent messages gain stable ids','Legacy notes gain image arrays','Ordinary task time is optional','Task image persists','Manual note category selector is absent','MiSans typography is preferred','Note body focus has no rectangular frame','Image-only note persists','Note category is inferred from title and content','Manual note target selector is absent','Assistant infers a note from the request','Unconfirmed append preserves the existing note body and edit time','Confirmed content appends without changing source whitespace or CRLF','Undo restores the original note body and edit time','Oversized append is refused before any record change or persistence','Sent user message can be edited and resent','User message and paired answer can be deleted','An ungrounded model note id cannot produce a write action']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
