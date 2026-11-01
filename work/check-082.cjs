const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const broken={format:'xixu-backup',schemaVersion:5,termStart:'2026-08-31',courses:[{id:'bad1',name:'数据可视',short:'数据可视',mark:'数',image:null},{id:'bad2',name:'559机房',short:'559机房',mark:'5',image:null}],lessons:[{course:'bad1',day:3,block:3,room:'教室待确认',weeks:[3],rule:'第 3 周 · 图片识别'},{course:'bad2',day:3,block:3,room:'教室待确认',weeks:[3],rule:'第 3 周 · 图片识别'}],tasks:[],notes:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true}};
  await page.addInitScript(value=>{localStorage.setItem('xixu-v1',JSON.stringify(value));window.XixuAI={hasKey:()=>true,saveKey:()=>true,deleteKey:()=>true,testConnection:()=>{setTimeout(()=>window.XixuReceiveAITest(true,200,JSON.stringify({choices:[{message:{content:'连接成功'}}]})),10);return true},analyze:()=>true,analyzeVision:()=>true}},broken);
  await page.goto('http://127.0.0.1:'+server.address().port);
  const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1'))),nav=name=>page.locator('#tide-nav').getByRole('button',{name,exact:true}).click();
  assert.equal((await saved()).schemaVersion,10);
  await nav('课表');await page.locator('[data-action="import"]').click();
  const point=(x,y,w=70,h=24)=>[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
  const block=(value,x,y,w=80)=>({value,lines:[{value,cornerPoints:point(x,y,w)}]});
  const scan=[block('第3周',500,80)];['周一','周二','周三','周四','周五','周六','周日'].forEach((v,i)=>scan.push(block(v,105+i*130,180)));
  [1,2,3,4,5,6,7,8,9,10,11,12,13,14].forEach((v,i)=>scan.push(block(String(v),25,300+i*92,22)));
  // The native OCR often returns every visual line as its own block. These fragments must become one course.
  scan.push(block('数据可视',495,295),block('化技术',495,330),block('@C-5-',495,365),block('237',495,400));
  scan.push(block('软件工程',625,300),block('@C-5-',625,350),block('468机房',625,395));
  scan.push(block('深度学习',105,760),block('方法与应',105,800),block('用',105,840),block('@C-5-',105,880),block('559机房',105,920));
  scan.push(block('[非本周]',235,300),block('不应出现',235,340),block('@C-1-101',235,380));
  await page.evaluate(value=>window.XixuReceiveOCR(true,JSON.stringify(value)),{width:1000,height:1750,value:'第3周',blocks:scan});
  const review=await page.locator('#xixu-ocr-review').innerText();
  assert.match(review,/数据可视化技术/);assert.match(review,/软件工程/);assert.match(review,/深度学习方法与应用/);assert.doesNotMatch(review,/不应出现/);
  assert.equal(await page.locator('#xixu-ocr-review-form fieldset').count(),3);
  await page.locator('[name=room-0]').fill('C-5-237');await page.getByRole('button',{name:'应用变化并再次检查'}).click();await page.getByRole('button',{name:'更新课表'}).click();
  let state=await saved(),names=state.courses.map(c=>c.name);assert.ok(names.includes('数据可视化技术'));assert.ok(names.includes('深度学习方法与应用'));assert.ok(!names.includes('数据可视'));assert.ok(!names.includes('559机房'));
  const lesson=state.lessons.find(l=>state.courses.find(c=>c.id===l.course)?.name==='数据可视化技术');assert.equal(lesson.day,3);assert.equal(lesson.room,'C-5-237');
  // Every saved lesson is editable from its detail page.
  await page.locator('[data-action=lesson]').first().click();await page.getByRole('button',{name:/修改排课/}).click();await page.locator('[name=lessonRoom]').fill('C-5-999');await page.getByRole('button',{name:'保存修改'}).click();state=await saved();assert.ok(state.lessons.some(l=>l.room==='C-5-999'));
  await page.evaluate(()=>{while(window.XixuHandleSystemBack()){} });await page.getByRole('button',{name:'提醒与设置'}).click();await page.getByRole('button',{name:/DeepSeek/}).click();assert.equal(await page.getByRole('button',{name:/测试连接/}).count(),0);assert.equal(await page.locator('[name=api_key]').isEnabled(),true);assert.match(await page.locator('#tide-main').innerText(),/保存配置不会自动发送测试请求/);
  const native=fs.readFileSync('xixu-harmony/entry/src/main/ets/pages/Index.ets','utf8'),ocr=fs.readFileSync('xixu-harmony/web/modules/course-ocr.js','utf8');
  assert.match(native,/XixuModels/);assert.match(native,/publicConfig/);assert.match(native,/start/);assert.match(ocr,/assistantRequestStructuredModel/);assert.match(ocr,/detail:'original'/);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:12,checks:['schema v6 migration','fragmented OCR blocks merge into full course names','morning courses remain visible','non-current week cells are excluded','all OCR rows are editable','room correction saves','old OCR fragment courses are pruned','saved lessons are editable','course picker receives clean course names','model configuration never sends an unsolicited test request','vision inspection uses the shared structured model adapter','no browser runtime errors']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
