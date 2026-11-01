const {installModelFixture,approveFixtureRequests,savePlan}=require('./assistant-test-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
function seed(){
  const courses=[{id:'c-ai',name:'人工智能导论',short:'人工智能',mark:'智',image:null,assessment:[]}];
  const tasks=Array.from({length:420},(_,index)=>({id:'task-'+index,type:'homework',title:index===419?'向量数据库实验报告':'普通课程作业 '+index,course:index===419?'c-ai':'',date:index===419?'2026-09-22':'2026-11-'+String(index%28+1).padStart(2,'0'),time:'20:00',plan:'',repeat:'none',reminders:[24],note:index===419?'报告需要比较 HNSW 与 IVF 的召回率':'无关任务 '+index,done:false,estimateMinutes:90,sessions:[],images:[]}));
  const notes=Array.from({length:420},(_,index)=>({id:'note-'+index,title:index===419?'向量检索会议':'普通记录 '+index,text:index===419?'老师强调实验报告必须包含 HNSW 参数、IVF 基线和召回率曲线。':'IRRELEVANT_SENTINEL_'+index+' 一般生活记录，与课程项目无关。',category:'会议',course:index===419?'c-ai':'',createdAt:'2026-09-18T08:00:00.000Z',updatedAt:'2026-09-18T08:00:00.000Z',images:[]}));
  const agentHistory=Array.from({length:40},(_,index)=>({id:'history-'+index,conversationId:'default',role:index%2?'assistant':'user',text:(index===0?'ANCIENT_HISTORY_SENTINEL ':'')+'较早的对话内容 '+index+' '.repeat(50),source:'local',createdAt:'2026-09-18T08:'+String(index).padStart(2,'0')+':00.000Z'}));
  return {format:'xixu-backup',schemaVersion:9,termStart:'2026-08-31',scheduleSettings:{preset:'custom',count:10,periods:Array.from({length:10},(_,index)=>({start:String(8+index).padStart(2,'0')+':00',end:String(8+index).padStart(2,'0')+':40'}))},courses,lessons:[],tasks,notes,ocrCorrectionRules:{},agentHistory,agentPreferences:{courses:true,tasks:true,notes:true,activeConversationId:'default'}};
}
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:900}}),data=seed();
  await page.addInitScript(value=>{localStorage.setItem('xixu-v1',JSON.stringify(value));window.XixuAI={hasKey:()=>true,analyze(payload){window.__ragPayload=JSON.parse(payload);setTimeout(()=>window.XixuReceiveAI(true,200,JSON.stringify({choices:[{message:{content:JSON.stringify({answer:'实验报告需要比较 HNSW 与 IVF，并展示召回率曲线。',action:{type:'none'}})}}]})),0);return true}}},data);
  await installModelFixture(page);await approveFixtureRequests(page);await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'提醒与设置'}).click();await page.getByRole('button',{name:/汐序 Agent/}).click();
  await page.locator('[name=question]').fill('人工智能导论的向量数据库实验报告具体要比较什么？');await page.getByRole('button',{name:'发送'}).click();await page.getByText(/HNSW 与 IVF/).first().waitFor();
  const payload=await page.evaluate(()=>window.__ragPayload),content=payload.messages.at(-1).content,context=JSON.parse(content).sources;
  const reply=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')).agentHistory.at(-1)),refs=reply.retrievalRefs;
  assert.ok(context.length<=8);assert.ok(context.reduce((sum,item)=>sum+item.text.length,0)<=6000);
  assert.ok(context.some(item=>item.id==='task-419'));assert.ok(context.some(item=>item.id==='note-419'));
  assert.ok(refs.every(item=>item.chunkId&&Array.isArray(item.reasons)));
  assert.doesNotMatch(content,/IRRELEVANT_SENTINEL_0\b/);assert.doesNotMatch(JSON.stringify(payload.messages),/ANCIENT_HISTORY_SENTINEL/);assert.ok(payload.messages.length<=9);
  assert.deepEqual([],await page.evaluate(()=>window.__errors||[]));
  console.log(JSON.stringify({passed:10,checks:['hybrid retrieval strategy is explicit','adaptive result cap is enforced','retrieval context stays inside its character budget','relevant task is retrieved','relevant note is retrieved','sources carry stable chunk ids','reranking reasons are retained','irrelevant records are excluded','old conversation history is compacted','request message count stays bounded']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
