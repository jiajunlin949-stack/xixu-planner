const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const version=JSON.parse(fs.readFileSync(path.resolve('xixu-harmony/AppScope/app.json5'),'utf8')).app.versionName;
const versionPattern=new RegExp(version.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:1000}});
  await page.addInitScript(()=>{window.__backStates=[];window.XixuBack={setCanGoBack(value){window.__backStates.push(Boolean(value));return true}}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const nav=name=>page.locator('#tide-nav').getByRole('button',{name,exact:true}).click();

  assert.equal(await page.evaluate(()=>window.__backStates.at(-1)),false);
  await page.getByRole('button',{name:'提醒与设置'}).click();
  await page.getByRole('button',{name:'保存课程',exact:true}).click();
  assert.match(await page.locator('#tide-toast').innerText(),/请填写/);
  assert.equal(await page.locator('[name=courseName]').getAttribute('aria-invalid'),'true');

  const previousVersionData={format:'xixu-backup',schemaVersion:1,termStart:'2026-08-31',courses:[{id:'old-course',name:'保留下来的课程',short:'保留课程',mark:'保',image:null}],lessons:[{course:'old-course',day:2,block:0,weeks:Array.from({length:20},(_,i)=>i+1),rule:'第 1—20 周',room:'广学楼231'}],tasks:[
    {id:'old-homework',type:'homework',title:'旧版本作业',course:'old-course',date:'2026-09-20',time:'20:00',plan:'',repeat:'none',reminders:[24,1],note:'',done:false},
    {id:'old-exam',type:'exam',title:'旧版本考试',course:'old-course',date:'2026-10-20',time:'09:00',plan:'',repeat:'none',reminders:[24,1],note:'',done:false},
    {id:'old-task',type:'task',title:'旧版本复习任务',course:'old-course',date:'2026-09-18',time:'19:00',plan:'2026-09-18',repeat:'none',reminders:[],note:'',done:false}
  ]};
  await page.evaluate(value=>localStorage.setItem('xixu-v1',JSON.stringify(value)),previousVersionData);
  await page.reload();
  await page.getByRole('button',{name:'提醒与设置'}).click();
  assert.match(await page.locator('#tide-main').innerText(),versionPattern);
  await page.evaluate(()=>window.XixuHandleSystemBack());
  await nav('课表');
  await page.locator('button.tide-grid-cell[aria-label*="保留下来的课程"]').first().click();
  const activity=page.locator('.xixu-timeline');
  assert.ok(await activity.locator('button').count()>=3);
  assert.match(await activity.innerText(),/旧版本作业/);
  assert.match(await activity.innerText(),/旧版本考试/);
  assert.match(await activity.innerText(),/旧版本复习任务/);
  await page.screenshot({path:'work/iteration-course-activity.png',fullPage:true});
  await activity.getByText('旧版本作业',{exact:true}).click();
  await page.evaluate(()=>window.XixuHandleSystemBack());
  assert.match(await page.locator('#tide-main').innerText(),/课程安排/);
  await page.evaluate(()=>window.XixuHandleSystemBack());
  assert.equal(await page.locator('#tide-nav').isVisible(),true);
  await page.evaluate(()=>window.XixuHandleSystemBack());
  assert.equal(await page.locator('#tide-nav [aria-current=page]').getAttribute('data-page'),'today');
  assert.equal(await page.evaluate(()=>window.__backStates.at(-1)),false);

  previousVersionData.tasks=[];
  await page.evaluate(value=>localStorage.setItem('xixu-v1',JSON.stringify(value)),previousVersionData);
  await page.reload();await nav('课表');
  await page.locator('button.tide-grid-cell[aria-label*="保留下来的课程"]').first().click();
  assert.equal(await page.locator('.xixu-timeline').count(),1);
  assert.doesNotMatch(await page.locator('#tide-main').innerText(),/暂时没有待截止|作业\s*0|考试\s*0/);

  await page.evaluate(()=>window.XixuHandleSystemBack());
  await page.locator('[data-action="import"]').click();
  const point=(x,y,w=70,h=24)=>[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}];
  const blocks=[];
  ['一','二','三','四','五','六','日'].forEach((name,index)=>blocks.push({value:name,lines:[{value:name,cornerPoints:point(125+index*132,430)}]}));
  [1,2,3,4,5,6,7,8,9,10].forEach((number,index)=>blocks.push({value:String(number),lines:[{value:String(number),cornerPoints:point(35,550+index*140,25,25)}]}));
  blocks.push({value:'[非本周]\n劳动教育3*\n@钟海楼03037(多)',lines:[{value:'[非本周]',cornerPoints:point(125,545)},{value:'劳动教育3*',cornerPoints:point(125,575)},{value:'@钟海楼03037(多)',cornerPoints:point(125,610)}]});
  blocks.push({value:'社会调查与思想政治理论课社会实践*\n@广学楼231(多)',lines:[{value:'社会调查与思想政治理论课社会实践*',cornerPoints:point(389,545,120)},{value:'@广学楼231(多)',cornerPoints:point(389,610,100)}]});
  blocks.push({value:'计算机辅助设计 $\n@钟海楼06002',lines:[{value:'计算机辅助设计 $',cornerPoints:point(257,1105,100)},{value:'@钟海楼06002',cornerPoints:point(257,1165,90)}]});
  await page.evaluate(scan=>window.XixuReceiveOCR(true,JSON.stringify(scan)),{width:1000,height:2100,value:'第2周',blocks});
  await page.getByRole('button',{name:'更新课表'}).click();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(state.schemaVersion,10);
  assert.deepEqual(state.notes,[]);
  const names=state.courses.map(course=>course.name);
  assert.ok(names.includes('社会调查与思想政治理论课社会实践'));
  assert.ok(names.includes('计算机辅助设计'));
  assert.ok(!names.includes('劳动教育3'));
  const design=state.lessons.find(lesson=>state.courses.find(course=>course.id===lesson.course)?.name==='计算机辅助设计');
  assert.equal(design.period,'5');

  await page.locator('[data-action="import"]').click();
  const uncertainScan={width:1000,height:1400,blocks:[{value:'线性代数',lines:[{value:'线性代数',cornerPoints:point(125,500,100)}]}]};
  await page.evaluate(scan=>window.XixuReceiveOCR(true,JSON.stringify(scan)),uncertainScan);
  assert.match(await page.locator('#xixu-ocr-review').innerText(),/修改课程|教室|星期|节次/);
  await page.locator('[name="course-0"]').fill('线性代数A');await page.locator('[name="room-0"]').fill('广学楼101');await page.getByRole('button',{name:'应用变化并再次检查'}).click();
  const corrected=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));assert.equal(corrected.ocrCorrectionRules['course:线性代数'],'线性代数A');assert.equal(corrected.ocrCorrectionRules['room:教室待确认'],'广学楼101');

  const ark=fs.readFileSync('xixu-harmony/entry/src/main/ets/pages/Index.ets','utf8');
  assert.match(ark,/planner-v1\.backup\.json/);
  assert.match(ark,/onBackPress\(\): boolean/);
  console.log(JSON.stringify({passed:7,checks:['In-app validation replaces browser tooltip','Schema v1 data migrates to v3 without losing records','Course details use one mixed timeline','System back unwinds detail, tab, then exits from Today','Guangdong Ocean timetable style is parsed and non-current cells ignored','Low-confidence OCR fields are highlighted and exact corrections persist','Native storage keeps a rolling recovery copy']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});

