const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
function seed(){
  const courses=Array.from({length:180},(_,i)=>({id:'c'+i,name:'压力测试课程'+i,short:'课程'+i,mark:String(i%10),image:null,assessment:[]}));
  const weeks=Array.from({length:20},(_,i)=>i+1),lessons=Array.from({length:1260},(_,i)=>({course:'c'+(i%180),day:i%7,block:i%5,weeks,rule:'第 1—20 周',room:'测试楼'+(i%40),period:String((i%5)*2+1)}));
  const tasks=Array.from({length:2400},(_,i)=>({id:'t'+i,type:i%11===0?'exam':'homework',title:(i===2399?'关键语义检索目标':'压力任务')+i,course:'c'+(i%180),date:'2026-10-'+String(i%28+1).padStart(2,'0'),time:'20:00',plan:'',repeat:'none',reminders:[24,1],note:i===2399?'量子网络课程最终报告需要提交':'批量完整性检查',done:i%4===0,estimateMinutes:120,sessions:[]}));
  const notes=Array.from({length:2200},(_,i)=>({id:'n'+i,title:'长期记录'+i,text:i===2199?'量子网络会议决定周四提交最终报告':'用于验证大量个人记录保持完整',category:'会议',course:'c'+(i%180),createdAt:'2026-09-11T08:00:00.000Z'}));
  return {format:'xixu-backup',schemaVersion:3,termStart:'2026-08-31',courses,lessons,tasks,notes,ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true}};
}
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:900}}),data=seed(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(value=>{if(!localStorage.getItem('xixu-v1'))localStorage.setItem('xixu-v1',JSON.stringify(value))},data);
  const started=Date.now();await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'load'});
  await page.getByRole('button',{name:'提醒与设置'}).click();await page.getByRole('button',{name:/汐序 Agent/}).click();
  await page.locator('[name=question]').fill('量子网络最终报告在哪里提到，什么时候交？');await page.getByRole('button',{name:'发送'}).click();
  // Sources are collapsed until requested in the chat workspace. Expand them
  // through the normal summary interaction; don't wait on a hidden source label.
  await page.locator('.xixu-agent-refs summary').waitFor({timeout:10000});
  await page.locator('.xixu-agent-refs summary').click();
  await page.locator('.xixu-agent-refs button[data-id="t2399"]').waitFor({timeout:10000});
  await page.locator('.xixu-agent-refs button[data-id="n2199"]').waitFor({timeout:10000});
  const refs=await page.locator('.xixu-agent-refs button').count();assert.ok(refs>=2);
  const completed=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(completed.agentHistory.length,2);
  for(let i=0;i<3;i++)await page.reload({waitUntil:'load'});
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(saved.courses.length,180);assert.equal(saved.lessons.length,1260);assert.equal(saved.tasks.length,2400);assert.equal(saved.notes.length,2200);assert.equal(saved.tasks[2399].note,'量子网络课程最终报告需要提交');assert.equal(saved.notes[2199].text,'量子网络会议决定周四提交最终报告');assert.equal(saved.schemaVersion,10);assert.equal(saved.notes[2199].updatedAt,'');assert.equal(saved.notes[2199].createdAt,'2026-09-11T08:00:00.000Z');assert.deepEqual(saved.agentHistory,completed.agentHistory);assert.deepEqual(errors,[]);
  const elapsed=Date.now()-started;assert.ok(elapsed<30000,'large-data flow exceeded 30 seconds');
  console.log(JSON.stringify({passed:7,elapsedMs:elapsed,environment:'Desktop Chromium fixture; no HarmonyOS FPS claim',checks:['Large dataset opens and remains interactive','Expanded retrieved sources link the exact task and meeting note','Three reopen cycles preserve every collection and sentinel fields without reseeding','Schema upgrades to v10','Legacy source edit time remains unknown while original creation time is preserved','Completed conversation survives all reopen cycles','No browser runtime errors']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
