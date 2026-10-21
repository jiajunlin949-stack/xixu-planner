const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!/^[\w.-]+$/.test(name))return res.writeHead(404).end();const file=path.join(raw,name);if(!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
 const p=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const names=['高等数学','大学英语','计算机基础','深度学习','大学物理','线性代数','概率论','体育','艺术鉴赏','数据结构','程序设计','数字电路'];
 const courses=names.map((name,i)=>({id:'import-'+i,name,short:name,mark:name[0],image:null}));
 const lessons=courses.map((c,i)=>({course:c.id,day:i%6,block:Math.floor(i/6),room:'教学楼 '+(201+i),weeks:[1,2,3,4,5],rule:'1-5周'}));
 const seed={format:'xixu-backup',schemaVersion:9,termStart:'2026-08-31',courses,lessons,tasks:[],notes:[],scratchEntries:[],agentHistory:[]};
 await p.clock.install({time:new Date('2026-09-21T10:00:00+08:00')});
 await p.addInitScript(value=>localStorage.setItem('xixu-v1',JSON.stringify(value)),seed);
 await p.goto('http://127.0.0.1:'+server.address().port);
 await p.locator('#tide-nav [data-page=timetable]').tap();await p.waitForTimeout(400);
 const colors=()=>p.locator('button.tide-grid-cell[data-action=lesson]').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.querySelector('strong').textContent,getComputedStyle(el).backgroundImage])));
 const first=await colors();assert.equal(Object.keys(first).length,12);assert.equal(new Set(Object.values(first)).size,12);
 await p.locator('[data-action=next-week]').tap();assert.deepEqual(await colors(),first);
 await p.locator('[data-action=previous-week]').tap();assert.deepEqual(await colors(),first);
 await p.screenshot({path:'work/course-colors-mobile.png',fullPage:false});
 // Use the browser's touch input pipeline (not synthetic pointer dispatch), so
 // pan-y arbitration, pointer capture and touch cancellation are exercised.
 const input=await p.context().newCDPSession(p);
 const touch=(type,x,y)=>input.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
 const gesture=async(from,to,y=300,cancel=false)=>{
   await touch('touchStart',from,y);
   for(let i=1;i<=8;i++){await touch('touchMove',from+(to-from)*i/8,y+2);await p.waitForTimeout(18)}
   await touch(cancel?'touchCancel':'touchEnd');await p.waitForTimeout(350);
 };
 const clean=async()=>{assert.equal(await p.locator('.xixu-adjacent-view').count(),0);assert.equal(await p.locator('#tide-main>.tide-view').evaluate(el=>getComputedStyle(el).transform),'none');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)};
 const selected=()=>p.locator('#tide-nav [aria-current]').getAttribute('data-page');
 await gesture(325,80);assert.equal(await selected(),'notes');await clean();
 await gesture(65,310);assert.equal(await selected(),'timetable');await clean();
 await gesture(300,185,300,true);assert.equal(await selected(),'timetable');await clean();
 // A short, deliberate drag must spring back with no residual animation.
 await touch('touchStart',250,300);await touch('touchMove',225,302);await p.waitForTimeout(300);await touch('touchEnd');await p.waitForTimeout(350);await clean();assert.equal(await selected(),'timetable');
 // Scroll the tall timetable, then ensure the incoming page has the same
 // viewport position during the drag and after committing it.
 await p.evaluate(()=>window.scrollTo(0,250));await p.waitForTimeout(50);
 await touch('touchStart',325,320);await touch('touchMove',160,322);await p.waitForTimeout(50);
 const previewTop=await p.locator('.xixu-adjacent-view').evaluate(el=>el.getBoundingClientRect().top);
 await touch('touchMove',65,322);await touch('touchEnd');await p.waitForTimeout(350);
 assert.equal(await selected(),'notes');await clean();
 const finalTop=await p.locator('#tide-main>.tide-view').evaluate(el=>el.getBoundingClientRect().top);assert.ok(Math.abs(previewTop-finalTop)<2,`vertical jump: ${previewTop} -> ${finalTop}`);
 await gesture(65,310);assert.equal(await selected(),'timetable');await clean();
 // Vertical touch scrolling must not turn the page.
 await touch('touchStart',180,500);await touch('touchMove',184,350);await touch('touchEnd');await p.waitForTimeout(350);assert.equal(await selected(),'timetable');await clean();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({distinctCourseColors:12,stableAcrossWeeks:true,nativeTouchPipeline:true,cancelAndSpringBack:true,scrolledPageAlignment:true,verticalScrollSafe:true,realHarmonyDeviceTested:false}));
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
