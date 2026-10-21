const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
let browser;const sizes=[[320,720],[360,800],[390,844],[432,960],[480,1040],[720,1080]],checks=[];
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  for(const [width,height] of sizes){
    const page=await browser.newPage({viewport:{width,height}});await page.goto('http://127.0.0.1:'+server.address().port);
    const noOverflow=async label=>{const result=await page.evaluate(()=>({page:document.documentElement.scrollWidth,body:document.body.scrollWidth,viewport:innerWidth,nav:(()=>{const r=document.querySelector('#tide-nav').getBoundingClientRect();return {left:r.left,right:r.right}})()}));assert.ok(result.page<=result.viewport+1&&result.body<=result.viewport+1,label+' horizontal overflow '+JSON.stringify(result));assert.ok(result.nav.left>=-1&&result.nav.right<=result.viewport+1,label+' nav outside viewport '+JSON.stringify(result))};
    await noOverflow('today '+width);await page.locator('#tide-nav').getByRole('button',{name:'日程',exact:true}).click();await noOverflow('agenda '+width);await page.locator('#tide-nav').getByRole('button',{name:'课表',exact:true}).click();await noOverflow('timetable '+width);await page.getByRole('button',{name:'计划周'}).click();await noOverflow('plan '+width);await page.locator('#tide-nav').getByRole('button',{name:'备忘录',exact:true}).click();await noOverflow('notes '+width);await page.getByRole('button',{name:/让汐序查找并整理笔记/}).click();await noOverflow('secretary '+width);
    if(width===320||width===390||width===720)await page.screenshot({path:'work/responsive-'+width+'.png',fullPage:true});await page.close();checks.push(width+'x'+height);
  }
  fs.writeFileSync('work/responsive-checks.json',JSON.stringify({sizes:checks,errors:[]},null,2));console.log(JSON.stringify({passed:checks.length,sizes:checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
