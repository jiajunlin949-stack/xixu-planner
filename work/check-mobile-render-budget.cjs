const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile');
const server=http.createServer((req,res)=>{const file=path.join(raw,req.url==='/'?'index.html':req.url.slice(1));if(!file.startsWith(raw+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))});
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForTimeout(500);
  const result=await page.evaluate(()=>{
    const style=s=>getComputedStyle(document.querySelector(s));
    return {mobile:document.querySelector('#tide-planner').classList.contains('xixu-mobile-material'),attached:document.querySelectorAll('[data-hyalite-attached="true"]').length,nav:style('#tide-nav').backdropFilter,add:style('.tide-add').backdropFilter,layer:style('.tide-view').willChange,cmaps:Object.keys(globalThis.XixuPdfCMaps||{})};
  });
  assert.equal(result.mobile,true);assert.equal(result.attached,0);assert.match(result.nav,/blur\(8px\)/);assert.equal(result.add,'none');assert.equal(result.layer,'auto');assert.equal(result.cmaps.length,2);
  for(const tab of ['agenda','timetable','notes','today']){await page.locator('#tide-nav [data-page='+tab+']').click();await page.waitForTimeout(350)}
  assert.equal(await page.locator('[data-hyalite-attached="true"]').count(),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:8,material:result},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
