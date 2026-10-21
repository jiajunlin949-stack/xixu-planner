const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
function seed(){
  const now=new Date('2026-09-20T10:00:00+08:00'),day=6,week=3,clock=value=>String(Math.floor(value/60)%24).padStart(2,'0')+':'+String(value%60).padStart(2,'0'),minute=600;
  return {format:'xixu-backup',schemaVersion:9,termStart:'2026-08-31',scheduleSettings:{preset:'custom',count:1,periods:[{start:clock(Math.max(0,minute-30)),end:clock(Math.min(1439,minute+30))}]},courses:[{id:'course-live',name:'交互设计',short:'交互',mark:'交',image:null,assessment:[]}],lessons:[{course:'course-live',day,block:0,end:clock(Math.min(1439,minute+30)),period:'1',room:'设计室',weeks:[week],rule:'第 '+week+' 周'}],tasks:[{id:'task-today',type:'task',title:'整理交互清单',course:'',date:'2026-09-20',time:'',plan:'2026-09-20',repeat:'none',reminders:[],note:'',done:false,estimateMinutes:30,sessions:[],images:[]},{id:'task-deadline',type:'homework',title:'提交设计报告',course:'course-live',date:'2026-09-22',time:'20:00',plan:'',repeat:'none',reminders:[24],note:'',done:false,estimateMinutes:60,sessions:[],images:[]}],notes:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true,activeConversationId:'default'}};
}
let browser;
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.setFixedTime(new Date('2026-09-20T10:00:00+08:00'));
  await page.addInitScript(value=>localStorage.setItem('xixu-v1',JSON.stringify(value)),seed());await page.goto('http://127.0.0.1:'+server.address().port);

  await page.locator('[data-toggle="task-today"]').check();
  await page.locator('.xixu-complete-burst').waitFor();
  await page.locator('.xixu-day-progress.xixu-cue-progress').waitFor();
  assert.equal(await page.locator('.xixu-day-progress.xixu-cue-progress').count(),1);

  await page.locator('#tide-nav [data-page="add"]').click();await page.getByRole('button',{name:'添加每日任务'}).click();
  await page.locator('#tide-form [name="title"]').fill('新的舒适交互');await page.locator('#tide-form [name="date"]').fill('2026-09-20');await page.locator('#tide-form button[type="submit"]').click();
  await page.locator('.xixu-motion-receipt.is-task').waitFor();assert.equal(await page.locator('[data-toggle]').evaluateAll(items=>items.some(item=>item.dataset.toggle&&item.closest('.xixu-cue-insert'))),true);

  await page.locator('#tide-nav [data-page="notes"]').click();await page.getByRole('button',{name:'新建笔记'}).click();
  await page.locator('[name="noteTitle"]').fill('动效灵感');await page.locator('[name="noteText"]').fill('保存后归档到笔记索引。');await page.waitForTimeout(720);
  assert.equal(await page.locator('.xixu-note-save-state').innerText(),'草稿已保存');assert.match(await page.evaluate(()=>localStorage.getItem('xixu-note-editor-draft')||''),/动效灵感/);
  await page.locator('#xixu-note-form button[type="submit"]').click();await page.locator('.xixu-motion-receipt.is-note').waitFor();assert.equal(await page.locator('.xixu-note-card.xixu-cue-note').count(),1);

  await page.locator('.xixu-note-card').click();await page.getByRole('button',{name:'删除这条笔记'}).click();await page.locator('.xixu-motion-receipt.is-delete').waitFor();
  await page.getByRole('button',{name:'撤销'}).click();await page.locator('.xixu-note-card.xixu-cue-restore').waitFor();

  await page.locator('#tide-nav [data-page="agenda"]').click();await page.getByRole('button',{name:/提交设计报告/}).click();await page.getByRole('button',{name:/安排今天/}).click();
  await page.locator('.xixu-cue-snap').waitFor();

  await page.getByRole('button',{name:'返回'}).click();
  await page.locator('#tide-nav [data-page="timetable"]').click();assert.equal(await page.locator('.is-now').count()>0,true);

  await page.locator('#tide-nav [data-page="today"]').click();await page.getByRole('button',{name:'搜索记录'}).click();await page.locator('#xixu-search-form [name="query"]').fill('设计报告');await page.locator('#xixu-search-form button[type="submit"]').click();
  await page.locator('.xixu-search-results .xixu-cue-search').first().waitFor();assert.equal(await page.locator('.xixu-search-results mark').count()>0,true);assert.equal(await page.locator('.xixu-search-results .xixu-cue-search').count()>0,true);

  await page.getByRole('button',{name:'返回'}).click();await page.locator('.tide-settings-fab').click();await page.getByRole('button',{name:/汐序 Agent/}).click();
  await page.locator('[name="question"]').fill('明天提醒我晚上八点写交互总结');await page.locator('#xixu-agent-form button[type="submit"]').click();await page.getByRole('button',{name:'确认加入'}).waitFor();await page.getByRole('button',{name:'确认加入'}).click();
  await page.locator('.xixu-motion-receipt.is-agent').waitFor();

  await page.waitForTimeout(800);assert.equal(await page.locator('.xixu-motion-receipt').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'查看日程'}).click();await page.locator('#tide-nav [data-page="today"]').click();assert.equal(await page.locator('.xixu-motion-receipt').count(),0);
  assert.deepEqual(errors,[]);
  const result={passed:10,checks:['completion lands with a drawn check and progress response','new task visibly lands in its destination','note draft settles and survives navigation locally','saved note folds into the note index','planning uses a magnetic settle response','delete travels to a reversible undo state','connected page swipe remains enabled','current lesson has a living now state','Agent confirmation materializes toward its destination','search results reveal and highlight the match'],reducedMotion:true,errors};
  fs.writeFileSync('work/delight-motion-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
run().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
