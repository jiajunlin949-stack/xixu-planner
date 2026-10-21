const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const XLSX=require('../xixu-harmony/web/vendor/xlsx.full.min.js');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:1000}});
  await page.addInitScript(()=>{window.__backStates=[];window.__reminderPayload='';window.XixuBack={setCanGoBack(value){window.__backStates.push(Boolean(value));return true}};window.XixuReminder={status(){return '{"enabled":true,"count":0}'},sync(value){window.__reminderPayload=value;return true}}});
  await page.goto('http://127.0.0.1:'+server.address().port);
  const weekly=await page.evaluate(()=>JSON.parse(window.__reminderPayload).tasks.find(item=>item.type==='weekly-wrap'));
  assert.equal(weekly,undefined);


  await page.getByRole('button',{name:'计划日期'}).click();
  assert.equal(await page.locator('.xixu-control-layer').count(),1);
  assert.equal(await page.evaluate(()=>window.__backStates.at(-1)),true);
  assert.equal(await page.evaluate(()=>window.XixuHandleSystemBack()),true);
  await page.locator('.xixu-control-layer').waitFor({state:'detached'});
  assert.equal(await page.locator('.xixu-control-layer').count(),0);
  assert.equal(await page.evaluate(()=>window.__backStates.at(-1)),false);

  const rows=[
    ['学生个人课表','','','','','','',''],
    ['学年学期：2026-2027-1','','','','','','',''],
    ['', '星期一','星期二','星期三','星期四','星期五','星期六','星期日'],
    ['第1 2节\n(01,02)\n08:30-09:55','', '', '', '\n数据可视化技术\n杨老师\n1-18([周])[01-02节]\nC-5-344\n','\n软件工程\n周老师\n1-18([周])[01-02节]\nC-5-237\n','',''],
    ['第3 4节\n(03,04)\n10:15-11:40','','','\n计算机网络\n(线上线下混合)\n刘老师\n1,9,13,18([周])[03-04-05节]\nC-5-369\n','','','',''],
    ['第5节\n(05)\n11:45-12:25','','','\n计算机网络\n(线上线下混合)\n刘老师\n1,9,13,18([周])[03-04-05节]\nC-5-369\n','','','',''],
    ['', '：项目与劳动实践Ⅱ 张老师 1-18周;','','','','','','']
  ];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'Sheet1');
  const buffer=Buffer.from(XLSX.write(book,{type:'buffer',bookType:'xls'}));
  await page.getByRole('button',{name:'课表',exact:true}).click();
  await page.locator('[data-action="import"]').click();
  await page.locator('#xixu-import').setInputFiles({name:'学生个人课表.xls',mimeType:'application/vnd.ms-excel',buffer});
  await page.getByRole('button',{name:'更新课表'}).waitFor();
  assert.match(await page.locator('#xixu-import-review').innerText(),/读取|课表/);
  assert.match(await page.locator('#xixu-import-review').innerText(),/找到\s*3\s*门课[\s\S]*3\s*个课块/);
  await page.getByRole('button',{name:'更新课表'}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(saved.courses.length,3);
  assert.equal(saved.lessons.length,3);
  const network=saved.lessons.find(item=>saved.courses.find(course=>course.id===item.course)?.name==='计算机网络');
  assert.deepEqual(network.spans,[1,6]);
  assert.equal(network.period,'3–5');
  const longRows=[['课程名称','星期','节次','周次','上课地点'],['数据库原理','周一','1-2节','1-16周','A101'],['软件测试','Friday','6-7','2-18双周','B202']];
  const longBook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(longBook,XLSX.utils.aoa_to_sheet(longRows),'课程表');const longBuffer=Buffer.from(XLSX.write(longBook,{type:'buffer',bookType:'xlsx'}));
  await page.locator('[data-action="import"]').click();await page.locator('#xixu-import').setInputFiles({name:'long-table.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:longBuffer});try{await page.getByRole('button',{name:'更新课表'}).waitFor({timeout:5000})}catch(error){console.error('Long-table import UI:',await page.locator('#tide-main').innerText());throw error}assert.match(await page.locator('#xixu-import-review').innerText(),/2[\s\S]*(课程|门)[\s\S]*2[\s\S]*(课块|课程)/);await page.getByRole('button',{name:'更新课表'}).click();
  const longSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1'))),softwareTesting=longSaved.lessons.find(item=>longSaved.courses.find(course=>course.id===item.course)?.name==='软件测试');assert.equal(softwareTesting.day,4);assert.deepEqual(softwareTesting.weeks,[2,4,6,8,10,12,14,16,18]);
  const realFile=process.env.XIXU_REAL_XLS_SAMPLE||'';
  if(fs.existsSync(realFile)){
    await page.locator('[data-action="import"]').click();
    await page.locator('#xixu-import').setInputFiles(realFile);
    await page.getByRole('button',{name:'更新课表'}).waitFor();
    assert.match(await page.locator('#xixu-import-review').innerText(),/9[\s\S]*(课程|门)[\s\S]*15[\s\S]*(安排|课程)/);
    await page.getByRole('button',{name:'更新课表'}).click();
    const realSaved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
    assert.equal(realSaved.courses.length,11);assert.equal(realSaved.lessons.length,15);
  }
  const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),dayBefore=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),after=new Date(Date.parse(today+'T12:00:00Z')+5*86400000).toISOString().slice(0,10);
  await page.evaluate(({dayBefore,after})=>{const state=JSON.parse(localStorage.getItem('xixu-v1'));state.tasks=[{id:'defer-1',type:'homework',title:'顺延测试',course:'',date:after,time:'23:00',plan:'',repeat:'none',reminders:[],note:'',done:false,estimateMinutes:60,sessions:[{id:'session-1',date:dayBefore,time:'09:00',minutes:60,done:false}]}];localStorage.setItem('xixu-v1',JSON.stringify(state))},{dayBefore,after});
  await page.reload();
  const deferred=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')).tasks[0].sessions[0]);
  assert.ok(deferred.date>=today);assert.equal(deferred.deferredFrom.date,dayBefore);
  console.log(JSON.stringify({passed:fs.existsSync(realFile)?6:5,checks:['Removed weekly wrap is absent from system reminder scheduling','System back closes the active date picker before exiting','Legacy .xls timetable imports courses, weeks, rooms and merged periods','Long-table Chinese/English weekday spreadsheet imports with odd/even weeks',...(fs.existsSync(realFile)?['The supplied Shenzhen Technology University timetable imports 9 courses and 15 schedules without footer fragments']:[]),'An unfinished past study session is moved to the next free slot']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
