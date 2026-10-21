const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http'),vm=require('node:vm');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),checks=[];
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!/^[\w.-]+$/.test(name)){res.writeHead(404).end();return}const file=path.join(raw,name);if(!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file))});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9kAAAAASUVORK5CYII=','base64');
const html='<html><head><title>notepad</title><meta charset="utf-8"></head><body><div>  第一行\n第二行😀  <br></div><input type="checkbox" checked><br>'+Array.from({length:7},()=>'<img src="data:image/png;base64,'+image.toString('base64')+'"><br>').join('')+'<div>末尾  </div></body></html>';
const seed={format:'xixu-backup',schemaVersion:10,termStart:'2026-08-31',courses:[],lessons:[],tasks:[],notes:[{id:'existing',title:'既有资料',text:'不得替换',createdAt:'',updatedAt:'',images:[]}],scratchEntries:[],agentHistory:[]};
const state=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('xixu-v1')));
const check=(label,value)=>{assert.ok(value,label);checks.push(label)};
async function openPicker(p){await p.getByRole('button',{name:'提醒与设置'}).click();await p.getByRole('button',{name:'导入华为 HTML 图文'}).click()}
async function preview(p,files){await p.locator('#xixu-archive-files').setInputFiles(files);try{await p.locator('#xixu-archive-review').waitFor({timeout:30000})}catch(error){throw Error('Archive preview failed: '+(await p.locator('[role="alert"]').allTextContents()).join(' | '))}}
let browser;
(async()=>{
  // Exercise the resource:// SHA fallback against trusted independent vectors.
  const source=fs.readFileSync('xixu-harmony/web/modules/note-archive.js','utf8'),start=source.indexOf('  async function archiveSha('),end=source.indexOf('  function archiveSerial(',start),sha=vm.runInNewContext(source.slice(start,end)+'\narchiveSha',{globalThis:{crypto:null},Uint32Array,Uint8Array,DataView,archiveYield:()=>Promise.resolve()});
  for(const data of [Buffer.alloc(0),Buffer.from('abc'),Buffer.alloc(64,97),crypto.randomBytes(400000)])check('fallback SHA-256 matches independent vector '+data.length,await sha(data)===hash(data));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch(launchOptions);const url='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:390,height:844}}),p=await context.newPage(),errors=[],remote=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))remote.push(r.url())});
  await p.addInitScript(value=>{if(!localStorage.getItem('xixu-v1'))localStorage.setItem('xixu-v1',JSON.stringify(value))},seed);
  await p.goto(url);await openPicker(p);
  await p.locator('#xixu-archive-files').setInputFiles([{name:'原始备忘.HDOC',mimeType:'application/octet-stream',buffer:Buffer.from([142,220,101,154])},{name:'可读.html',mimeType:'text/html',buffer:Buffer.from(html)}]);
  await p.getByRole('alert').filter({hasText:'1 个 hdoc'}).waitFor();
  check('mixed hdoc batch stops before adding notes or staging originals',(await state(p)).notes.length===1&&await p.evaluate(()=>indexedDB.databases().then(list=>!list.some(db=>db.name==='xixu-note-archive-v1'))));
  check('hdoc guidance distinguishes export from native share and never claims decoding',(await p.locator('#tide-main').innerText()).includes('更多 → 导出')&&(await p.locator('#tide-main').innerText()).includes('尚不能可靠解读'));
  check('hdoc guide is readable at 390px without overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await p.screenshot({path:'work/huawei-hdoc-guide-390.png',fullPage:true});
  await p.getByRole('button',{name:'选择导出文件并核对'}).click();await p.locator('#xixu-archive-files').setInputFiles({name:'只是改名.html',mimeType:'text/html',buffer:Buffer.from([142,220,101,154])});await p.getByRole('alert').filter({hasText:'修改 hdoc 的扩展名不会转换内容'}).waitFor();
  check('renaming binary hdoc cannot create a readable imported note',(await state(p)).notes.length===1);
  await p.getByRole('button',{name:'重新选择 HTML'}).click();
  const name='不截断的完整测试标题'.repeat(12)+'.html';await preview(p,[{name,mimeType:'text/html',buffer:Buffer.from(html)}]);
  check('preview reports all seven images without six-image truncation',(await p.locator('#tide-main').innerText()).includes('7 张图片'));
  check('preview does not add or replace existing notes',(await state(p)).notes.length===1);
  await p.getByRole('button',{name:'确认导入图文'}).click();await p.locator('.xixu-note-card').filter({hasText:name.slice(0,-5)}).waitFor();
  let saved=await state(p),note=saved.notes.find(n=>n.archive);
  check('original filename is used instead of generic HTML title',note.title===name.slice(0,-5));
  check('source timestamps stay unknown and import time is separate',note.createdAt===''&&note.updatedAt===''&&Boolean(note.importedAt));
  check('original HTML hash is retained',note.archive.originalHash===hash(Buffer.from(html)));
  check('all image bytes have original hashes and order',note.archive.images.length===7&&note.archive.images.every(x=>x.hash===hash(image))&&note.archive.layout.filter(x=>x.kind==='image').every((x,i)=>x.index===i));
  check('source text whitespace and Unicode survive parsing',note.text.includes('  第一行\n第二行😀  ')&&note.text.includes('末尾  '));
  check('checklist state is preserved without an active input form',note.text.includes('☑')&&note.archive.layout.some(x=>x.kind==='checkbox'&&x.checked===true));
  check('originals are not embedded in the planner JSON',JSON.stringify(saved).length<20000&&!JSON.stringify(saved).includes(image.toString('base64')));
  await p.locator('.xixu-note-card[data-id="'+note.id+'"]').click();await p.getByText('图片字节校验通过',{exact:true}).waitFor();
  check('seven original pictures render in order',await p.locator('.xixu-archive-content img').count()===7);
  check('390px archive reading has no horizontal overflow',await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const downloading=p.waitForEvent('download');await p.getByRole('button',{name:'导出原始 HTML'}).click();const download=await downloading;check('exported original is byte-for-byte identical',hash(fs.readFileSync(await download.path()))===hash(Buffer.from(html)));
  await p.reload();await p.locator('#tide-nav [data-page="notes"]').click();await p.locator('.xixu-note-card[data-id="'+note.id+'"]').click();await p.getByText('图片字节校验通过',{exact:true}).waitFor();check('reload preserves external originals and note index',(await state(p)).notes.length===2);
  await p.getByRole('button',{name:'编辑文字副本'}).click();await p.locator('[name="noteText"]').fill(note.text+'\n编辑副本');await p.getByRole('button',{name:'保存',exact:true}).click();note=(await state(p)).notes.find(n=>n.id===note.id);check('editing changes only a copy and retains the original archive',note.archiveEdited&&note.archive.originalHash===hash(Buffer.from(html))&&Boolean(note.updatedAt));
  await p.locator('.xixu-note-card[data-id="'+note.id+'"]').click();check('edited copy and original view remain distinct',(await p.locator('.xixu-archive-content').innerText()).includes('编辑副本')&&await p.getByText('查看导入时的图文',{exact:true}).count()===1);
  await p.getByRole('button',{name:'返回',exact:true}).click();await openPicker(p);await p.locator('#xixu-archive-files').setInputFiles({name:'拒绝主动内容.html',mimeType:'text/html',buffer:Buffer.from('<script>window.__bad=true</script><p>正文</p>')});await p.getByRole('alert').filter({hasText:'主动内容'}).waitFor();check('active content is rejected without executing or importing',(await state(p)).notes.length===2&&!await p.evaluate(()=>window.__bad));
  await p.getByRole('button',{name:'重新选择 HTML'}).click();await p.locator('#xixu-archive-files').setInputFiles({name:'拒绝外部图.html',mimeType:'text/html',buffer:Buffer.from('<p>正文</p><img src="https://private.invalid/photo.jpg">')});await p.getByRole('alert').filter({hasText:'图片未内嵌'}).waitFor();check('external images are rejected and never fetched',remote.length===0&&(await state(p)).notes.length===2);
  await p.getByRole('button',{name:'重新选择 HTML'}).click();await preview(p,Array.from({length:74},(_,i)=>({name:'批量原件'+i+'.html',mimeType:'text/html',buffer:Buffer.from('<div>同文不合并  </div>')})));await p.getByRole('button',{name:'确认导入图文'}).click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('xixu-v1')).notes.length===76);
  check('74 source files import individually even with identical text',(await state(p)).notes.filter(n=>n.title.startsWith('批量原件')).length===74);
  check('existing notes and edits are not replaced',(await state(p)).notes.find(n=>n.id==='existing').text==='不得替换'&&(await state(p)).notes.find(n=>n.id===note.id).text.endsWith('编辑副本'));
  await p.getByRole('button',{name:'提醒与设置'}).click();check('index-only backup is clearly distinguished',await p.getByRole('button',{name:'导出索引与其他数据'}).count()===1&&(await p.locator('#tide-main').innerText()).includes('不要仅备份 JSON 后卸载应用'));
  const restore=await browser.newContext(),other=await restore.newPage();await other.addInitScript(value=>localStorage.setItem('xixu-v1',JSON.stringify(value)),seed);await other.goto(url);await other.getByRole('button',{name:'提醒与设置'}).click();await other.locator('#xixu-backup-import').setInputFiles({name:'索引.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await state(p)))});await other.getByText(/请先重新导入原始 HTML/).waitFor();check('restoring an index without its originals is rejected before replacing data',(await state(other)).notes.length===1);await restore.close();
  check('archive flow has no browser runtime errors',errors.length===0);await p.screenshot({path:'work/huawei-html-archive-390.png',fullPage:true});await context.close();
  // Real content-URI bridge fixture: browser File.arrayBuffer is forbidden.
  const native=await browser.newContext(),n=await native.newPage();await n.addInitScript(value=>{
    localStorage.setItem('xixu-v1',JSON.stringify(value.seed));window.__archiveBlobs={};window.__selectedBytes=atob(value.file);window.__filePosition=0;window.__finish=0;window.__writeFail=false;
    window.XixuStore={read:()=>localStorage.getItem('xixu-v1'),save:text=>{localStorage.setItem('xixu-v1',text);return true}};
    window.XixuFile={begin:()=>{window.__filePosition=0;return JSON.stringify({size:window.__selectedBytes.length,selectionId:1})},readChunk:size=>{const chunk=window.__selectedBytes.slice(window.__filePosition,window.__filePosition+size);window.__filePosition+=chunk.length;return btoa(chunk)},finish:()=>{window.__finish++;return true}};
    window.XixuArchive={beginWrite:(key,size)=>{window.__key=key;window.__binary='';return !window.__archiveBlobs[key]},writeChunk:chunk=>{if(window.__writeFail)return false;window.__binary+=atob(chunk);return true},finishWrite:()=>{window.__archiveBlobs[window.__key]=window.__binary;return true},beginRead:key=>{if(!window.__archiveBlobs[key])throw Error('missing');window.__binary=window.__archiveBlobs[key];window.__readPosition=0;return window.__binary.length},readChunk:size=>{const chunk=window.__binary.slice(window.__readPosition,window.__readPosition+size);window.__readPosition+=chunk.length;return btoa(chunk)},close:()=>true};
    File.prototype.arrayBuffer=()=>{throw Error('Must use native file bridge')};
  },{seed,file:Buffer.from(html).toString('base64')});await n.goto(url);await openPicker(n);await preview(n,[{name:'原生图文.html',mimeType:'text/html',buffer:Buffer.from(html)}]);check('native import bypasses unreliable File.arrayBuffer',await n.evaluate(()=>window.__finish)===1);await n.getByRole('button',{name:'确认导入图文'}).click();await n.waitForFunction(()=>JSON.parse(localStorage.getItem('xixu-v1')).notes.length===2);check('native asset bridge persists the same exact source bytes',await n.evaluate(expected=>Object.values(window.__archiveBlobs).includes(atob(expected)),Buffer.from(html).toString('base64')));
  await n.evaluate(encoded=>{window.__writeFail=true;window.__selectedBytes=atob(encoded)},Buffer.from('<div>未完成写入不得新增</div>').toString('base64'));await openPicker(n);await n.locator('#xixu-archive-files').setInputFiles({name:'失败.html',mimeType:'text/html',buffer:Buffer.from('<div>未完成写入不得新增</div>')});await n.getByRole('alert').filter({hasText:'原件写入失败'}).waitFor();check('native write failure leaves the existing library intact',(await state(n)).notes.length===2);await native.close();
  if(process.argv[2]){
    const bytes=fs.readFileSync(process.argv[2]),sampleContext=await browser.newContext(),s=await sampleContext.newPage();await s.goto(url);await openPicker(s);await preview(s,[{name:path.basename(process.argv[2]),mimeType:'text/html',buffer:bytes}]);await s.getByRole('button',{name:'确认导入图文'}).click();await s.waitForFunction(()=>JSON.parse(localStorage.getItem('xixu-v1')).notes.some(n=>n.archive));const imported=(await state(s)).notes.find(n=>n.archive);check('user sample retains four embedded image references',imported.archive.images.length===4);check('user sample original hash matches the provided file',imported.archive.originalHash===hash(bytes));await s.locator('.xixu-note-card[data-id="'+imported.id+'"]').click();await s.getByText('图片字节校验通过',{exact:true}).waitFor();
    for(const picture of await s.locator('.xixu-archive-content img').all()){await picture.scrollIntoViewIfNeeded();await picture.evaluate(image=>new Promise((resolve,reject)=>{if(image.complete&&image.naturalWidth>0){resolve();return}image.addEventListener('load',resolve,{once:true});image.addEventListener('error',()=>reject(Error('Sample picture could not decode')),{once:true})}))}
    check('all four sample pictures decode when scrolled into view',await s.locator('.xixu-archive-content img').evaluateAll(images=>images.every(image=>image.naturalWidth>0)));
    const d=s.waitForEvent('download');await s.getByRole('button',{name:'导出原始 HTML'}).click();check('user sample round-trips unchanged through isolated import and export',hash(fs.readFileSync(await(await d).path()))===hash(bytes));await sampleContext.close();
  }
  console.log(JSON.stringify({passed:checks.length,environment:'Isolated browser and native bridge fixtures; not a HarmonyOS device test',checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
