const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const XLSX=require('../xixu-harmony/web/vendor/xlsx.full.min.js'),source=path.resolve('work/generated-course-import.xlsx');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file))});
let browser;
(async()=>{
  const rows=[['课程名称','星期','节次','周次','教室'],['数据可视化技术','周四','1-2','1-16','C-5-344'],['软件工程','周五','1-2','1-16','C-5-237'],['计算机网络','周一','3-4','1-16','C-1-110 实验室'],['深度学习方法与应用','周一','6-7','1-16','C-5-349'],['人工智能导论','周四','6-7','1-16','C-5-348'],['数据挖掘','周五','6-7','1-16','C-5-243'],['编码技术标准化与应用','周三','8-9','1-16','C-5-344'],['漫游欧洲：文化与生活','周二','11-12','1-16','C-5-105'],['生活中的社会学','周三','13-14','1-16','C-1-107']];const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(rows),'课表');fs.writeFileSync(source,XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}));
  assert.ok(fs.existsSync(source));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#tide-nav [data-page=timetable]').click();await page.locator('[data-action=import]').click();await page.locator('#xixu-import').setInputFiles(source);await page.locator('[data-action=confirm-timetable]').click();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1'))),names=state.courses.map(item=>item.name),rooms=state.lessons.map(item=>item.room);
  for(const name of ['数据可视化技术','软件工程','计算机网络','深度学习方法与应用','人工智能导论','数据挖掘','编码技术标准化与应用','漫游欧洲：文化与生活','生活中的社会学'])assert.ok(names.includes(name),name);
  assert.equal(names.length,9);assert.ok(!names.some(name=>/QC-5-|ac-\d|机房$/.test(name)));assert.ok(rooms.includes('C-5-344'));assert.ok(rooms.includes('C-5-349'));assert.ok(rooms.some(value=>/^C-1-110\s*实验室$/.test(value)));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:15,courses:names,roomSamples:rooms.filter((value,index,list)=>list.indexOf(value)===index).slice(0,8)},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
