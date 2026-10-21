const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'text/plain');res.end(fs.readFileSync(file));});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.addInitScript(()=>localStorage.setItem('xixu-v1',JSON.stringify({format:'xixu-backup',schemaVersion:8,termStart:'2026-08-31',courses:[],lessons:[],tasks:[],notes:[],ocrCorrectionRules:{},agentHistory:[],agentPreferences:{courses:true,tasks:true,notes:true}})));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('button',{name:'提醒与设置'}).click();
  const settingsText=await page.locator('#tide-main').innerText();assert.match(settingsText,/笔记文件[\s\S]*导入笔记文件/);assert.ok(!/在华为备忘录中多选|从华为备忘录导入/.test(settingsText));
  assert.equal(await page.getByRole('button',{name:'查看华为备忘录导入指南'}).count(),0);
  await page.screenshot({path:'work/note-import-entry-help.png',fullPage:true});
  const input=page.locator('#xixu-note-import-files');
  await input.setInputFiles([
    {name:'旅行清单.txt',mimeType:'text/plain',buffer:Buffer.from('旅行清单\n查看 https://example.com/path。')},
    {name:'申请进度.html',mimeType:'text/html',buffer:Buffer.from('<html><head><title>申请进度</title></head><body><h1>申请进度</h1><p>材料已提交，<a href="https://example.org/status">查询状态</a></p></body></html>')},
    {name:'旅行清单.txt',mimeType:'text/plain',buffer:Buffer.from('旅行清单\n查看 https://example.com/path。')},
    {name:'手写记录.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR42mNk+M9Qz0AEYBxVSFUAAM0ABf4B6cQAAAAASUVORK5CYII=','base64')}
  ]);
  await page.locator('#xixu-note-import-review').waitFor();
  await page.screenshot({path:'work/note-import-preview.png',fullPage:true});
  const preview=await page.locator('#tide-main').innerText();
  assert.match(preview,/3 条待导入/);assert.match(preview,/1 条重复/);assert.match(preview,/手写记录[\s\S]*1 张图片/);
  assert.equal(await page.locator('#xixu-note-import-review input:checked').count(),3);
  await page.locator('#xixu-note-import-review button[type="submit"]').click();
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
  assert.equal(state.notes.length,3);assert.ok(state.notes.every(note=>note.course===''&&note.category==='笔记'));assert.equal(state.notes.find(note=>note.title==='手写记录').images.length,1);
  await page.getByText('旅行清单',{exact:true}).click();
  await page.screenshot({path:'work/note-link-preview.png',fullPage:true});
  assert.match(await page.locator('#tide-main').innerText(),/网页链接[\s\S]*example\.com\/path/);
  assert.equal(await page.locator('[data-action="open-note-link"]').getAttribute('data-url'),'https://example.com/path');
  console.log(JSON.stringify({passed:11,checks:['Import entry is under top-right settings','Misleading Huawei batch-share claim is absent','Obsolete migration help button is absent','Multiple note files are accepted','TXT and HTML are parsed','Note images are accepted','Image-only notes are preserved','Preview appears before writing','Duplicate notes are skipped','Imported notes remain unlinked to courses','HTTP links are detected without trailing punctuation']},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
