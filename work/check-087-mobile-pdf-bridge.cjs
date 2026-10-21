const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
const line=(value,x,y,w=120,h=20)=>({value,cornerPoints:[{x:x-w/2,y:y-h/2},{x:x+w/2,y:y-h/2},{x:x+w/2,y:y+h/2},{x:x-w/2,y:y+h/2}]});
const state={format:'xixu-backup',schemaVersion:9,termStart:'2026-08-31',scheduleSettings:{preset:'sztu',count:14,periods:[['08:30','09:10'],['09:15','09:55'],['10:15','10:55'],['11:00','11:40'],['11:45','12:25'],['14:00','14:40'],['14:45','15:25'],['15:45','16:25'],['16:30','17:10'],['17:15','17:55'],['19:00','19:40'],['19:40','20:20'],['20:30','21:10'],['21:10','21:50']].map(([start,end])=>({start,end}))},courses:[],lessons:[],tasks:[],notes:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true}};
const scans=[
  {width:1000,height:700,value:'',blocks:['一','二','三','四','五','六','日'].map((day,index)=>({value:'星期'+day,lines:[line('星期'+day,180+123*index,60,55)]})).concat([{value:'数据可视化技术* (1-2节)1-16周/校区:深圳/场地:C-5-344机房/教师:张老师',lines:[line('数据可视化技术* (1-2节)1-16周/校区:深圳/场地:C-5-344机房/教师:张老师',180,180,150)]}])},
  {width:1000,height:700,value:'',blocks:[{value:'深度学习方法与应用* (6-7节)2-16周(双)/校区:深圳/场地:C-5-349机房/教师:王老师',lines:[line('深度学习方法与应用* (6-7节)2-16周(双)/校区:深圳/场地:C-5-349机房/教师:王老师',303,250,150)]},{value:'周末研讨* (5-6节)1-16周/校区:深圳/场地:钟海楼06002/教师:陈老师',lines:[line('周末研讨* (5-6节)1-16周/校区:深圳/场地:钟海楼06002/教师:陈老师',918,360,150)]}]},
  {width:1000,height:700,value:'',blocks:[]}
];
const pdf=path.resolve('work/fixtures/three-page-schedule.pdf'),pdfBytes=fs.readFileSync(pdf),chunks=[];
for(let offset=0;offset<pdfBytes.length;offset+=4096)chunks.push(pdfBytes.subarray(offset,offset+4096).toString('base64'));
let browser;
(async()=>{
  assert.ok(pdfBytes.length>8,'PDF fixture is required; run node work/create-ci-fixtures.cjs');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(({state,scans,chunks,size})=>{
    localStorage.setItem('xixu-v1',JSON.stringify(state));
    window.__mobilePdf={arrayBufferCalls:0,beginCalls:0,finishCalls:0,bytesRead:0,chunkIndex:0,pages:[],truncate:false};
    File.prototype.arrayBuffer=function(){window.__mobilePdf.arrayBufferCalls++;return Promise.reject(Error('ArkWeb content URI is unavailable'))};
    window.XixuFile={
      begin(index){if(index!==0)throw Error('bad index');window.__mobilePdf.beginCalls++;window.__mobilePdf.bytesRead=0;window.__mobilePdf.chunkIndex=0;return JSON.stringify({size,name:'schedule.pdf'})},
      readChunk(length){const limit=window.__mobilePdf.truncate?Math.max(0,chunks.length-1):chunks.length,index=window.__mobilePdf.chunkIndex;if(index>=limit)return '';const encoded=chunks[index],count=atob(encoded).length;if(count>length)throw Error('chunk exceeds request');window.__mobilePdf.chunkIndex++;window.__mobilePdf.bytesRead+=count;return encoded},
      finish(){window.__mobilePdf.finishCalls++;return true}
    };
    window.XixuOCR={recognizeDocumentPage(data,pageNumber){const page=Number(pageNumber);window.__mobilePdf.pages.push(page);setTimeout(()=>window.XixuReceivePdfOCR(true,JSON.stringify(scans[page-1]),pageNumber),0);return data.startsWith('data:image/')}};
  },{state,scans,chunks,size:pdfBytes.length});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#tide-nav [data-page=timetable]').click();await page.locator('[data-action=import]').click();
  await page.locator('#xixu-import').setInputFiles(pdf);try{await page.locator('#xixu-import-review [data-action=confirm-timetable]').waitFor({timeout:30000})}catch(error){console.error('MOBILE PDF REVIEW:',await page.locator('#xixu-import-review').innerText());throw error}
  const review=await page.locator('#xixu-import-review').innerText();assert.match(review,/PDF 已识别/);assert.match(review,/数据可视化技术/);assert.match(review,/深度学习方法与应用/);assert.match(review,/周末研讨/);
  const bridgeState=await page.evaluate(()=>window.__mobilePdf);assert.equal(bridgeState.arrayBufferCalls,0);assert.equal(bridgeState.beginCalls,1);assert.equal(bridgeState.finishCalls,1);assert.equal(bridgeState.bytesRead,pdfBytes.length);assert.deepEqual(bridgeState.pages,[1,2,3]);
  await page.locator('#xixu-import-review [data-action=confirm-timetable]').click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1'))),courseById=new Map(saved.courses.map(item=>[item.id,item]));
  assert.ok(saved.lessons.some(item=>courseById.get(item.course)?.name==='数据可视化技术'&&item.room==='C-5-344机房'&&item.weeks.length===16));assert.ok(saved.lessons.some(item=>courseById.get(item.course)?.name==='深度学习方法与应用'&&item.weeks.join(',')==='2,4,6,8,10,12,14,16'));assert.ok(saved.lessons.some(item=>courseById.get(item.course)?.name==='周末研讨'&&item.day===6&&item.room==='钟海楼06002'));
  await page.locator('[data-action=import]').click();await page.evaluate(()=>{window.__mobilePdf.truncate=true});await page.locator('#xixu-import').setInputFiles({name:'truncated.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n')});
  await page.waitForFunction(()=>document.querySelector('#xixu-import-review')?.textContent.includes('PDF 读取失败'));assert.match(await page.locator('#xixu-import-review').innerText(),/PDF 读取失败：文件在 .* 字节处提前结束/);assert.equal(await page.evaluate(()=>window.__mobilePdf.arrayBufferCalls),0);
  const native=fs.readFileSync('xixu-harmony/entry/src/main/ets/pages/Index.ets','utf8');assert.match(native,/class SelectedFileBridge/);assert.match(native,/registerJavaScriptProxy\(this\.files, 'XixuFile'/);assert.match(native,/this\.files\.setSelection\(uris\)/);assert.match(native,/256 \* 1024/);
  const parser=fs.readFileSync('xixu-harmony/web/modules/course-ocr.js','utf8'),html=fs.readFileSync(path.join(raw,'index.html'),'utf8');assert.match(parser,/cMapUrl:'cmaps\/',cMapPacked:true/);assert.match(html,/connect-src 'self' resource:/);for(const name of ['Adobe-GB1-UCS2.bcmap','UniGB-UCS2-H.bcmap'])assert.ok(fs.statSync(path.join(raw,'cmaps',name)).size>30000,name);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:21,checks:['native bridge path selected','File.arrayBuffer bypassed','native selection opened once','native bridge closed after import','all PDF bytes transferred','three PDF pages opened','three PDF pages sent to OCR','PDF review produced','course name retained','full classroom retained','teaching weeks retained','even-week rule retained','Sunday course retained','truncated bridge read reports PDF read failure','native bridge is registered','bridge is limited to picker selection','PDF parser requests packaged CMaps','CSP permits only local CMap reads','required Chinese CMaps are packaged','CMap assets are non-empty','no browser runtime errors']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
