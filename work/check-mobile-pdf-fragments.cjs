const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const src=fs.readFileSync('xixu-harmony/web/modules/course-ocr.js','utf8');
const bounds=src.slice(src.indexOf('  function ocrBounds('),src.indexOf('  function parseOcrTimetable('));
const parser=src.slice(src.indexOf('  function pdfWeeks('),src.indexOf('  async function pdfTextScan('));
const ctx=vm.createContext({DATA_SCHEMA_VERSION:10,TERM_MONDAY:'2026-08-31',looksLikeClassroomName:()=>false,periodBlockIndex:p=>Math.floor((p-1)/2),periodEnd:p=>String(p),compactRange:a=>a.join(','),periodInfo:()=>({start:'08:30',end:'09:10'})});
vm.runInContext(bounds+parser+';globalThis.parse=parsePdfTimetable;',ctx);
const line=(value,x,y,w=20)=>({value,cornerPoints:[{x:x-w/2,y:y-5},{x:x+w/2,y:y-5},{x:x+w/2,y:y+5},{x:x-w/2,y:y+5}]});
const headers=['一','二','三','四','五','六','日'].map((d,i)=>line('星期'+d,180+i*123,30));
function scan(lines){return {width:1000,height:700,blocks:[...headers,...lines].map(l=>({value:l.value,lines:[l]}))}}
function lesson(lines){return ctx.parse([scan(lines)]).lessons[0]}
const normal=[line('高等数学',180,80),line('(1-2节)1-16周/校区:深圳/场地:C-5-344/教师:张',180,100)];
const expected=JSON.stringify(lesson(normal));
const fragmented=[line('高等',168,80),line('数学',191,80),line('（',153,100,5),line('1',161,100,5),line('－',169,100,5),line('2',177,100,5),line('节',185,100,5),line('）',193,100,5),line('1-16周',180,120),line('/校区:深圳/场地:C-5-344/教师:张',180,140)];
assert.equal(JSON.stringify(lesson(fragmented)),expected,'split glyphs and full-width punctuation must preserve the lesson');
assert.equal(JSON.stringify(lesson([normal[0],line('(1-',180,100),line('2节)1-16周/校区:深圳/场地:C-5-344/教师:张',180,115)])),expected,'wrapped period marker');
const sunday=fragmented.map(l=>({...l,cornerPoints:l.cornerPoints.map(p=>({...p,x:p.x+738}))}));
assert.equal(lesson(sunday).day,6,'Sunday column retained');
const two=ctx.parse([scan([...fragmented,...sunday])]);assert.equal(two.lessons.length,2,'adjacent columns never merge');
assert.throws(()=>ctx.parse([scan([line('请于1-16周联系老师',180,80)])]),'no invented lessons from arbitrary numbers');
console.log('5 PDF fragment regressions passed');
// Exercise the text-layer entry point with fragmented PDF.js items and no
// network/OCR service. Verify the packaged maps are byte-identical.
Object.assign(ctx,{Uint8Array,atob,icon:()=>'',icons:()=>{},waitForNativeBridge:()=>{throw Error('Unexpected OCR fallback')},window:{}});
vm.runInContext(fs.readFileSync('xixu-harmony/entry/src/main/resources/rawfile/pdf-cmaps.js','utf8'),ctx);
vm.runInContext(src.slice(src.indexOf('  async function pdfTextScan('),src.indexOf('  async function waitForNativeBridge('))+';globalThis.parseBytes=parsePdfTimetableBytes;',ctx);
let destroyed=0,documentOptions=null;
const documentStub={numPages:1,destroy:async()=>{destroyed++},getPage:async()=>({cleanup(){},getViewport:()=>({width:1000,height:700,scale:1,transform:[1,0,0,1,0,0]}),getTextContent:async()=>({items:[...headers,...fragmented].map(l=>({str:l.value,width:l.cornerPoints[1].x-l.cornerPoints[0].x,transform:[1,0,0,10,l.cornerPoints[0].x,l.cornerPoints[2].y]}))})})};
ctx.pdfjsLib={GlobalWorkerOptions:{},Util:{transform:(_,t)=>t},getDocument(options){documentOptions=options;return {promise:Promise.resolve(documentStub)}}};
(async()=>{
  const bytes=new Uint8Array(Buffer.from('%PDF-1.7\n'));
  const result=await ctx.parseBytes(bytes,{innerHTML:''});
  assert.equal(JSON.stringify(result.lessons[0]),expected);assert.equal(destroyed,1);
  // Keep test assertions outside the PDF loader promise: loader rejections
  // intentionally become a user-facing "could not open" error.
  assert.equal(documentOptions.useWorkerFetch,false);
  const reader=new documentOptions.CMapReaderFactory();
  for(const name of ['Adobe-GB1-UCS2','UniGB-UCS2-H']){
    const map=await reader.fetch({name});assert.equal(map.compressionType,1);
    assert.deepEqual(Buffer.from(map.cMapData),fs.readFileSync('xixu-harmony/web/vendor/cmaps/'+name+'.bcmap'));
  }
  await assert.rejects(()=>reader.fetch({name:'unpackaged-map'}),{code:'XIXU_PDF_CMAP_MISSING'});
  ctx.pdfjsLib.getDocument=()=>({promise:Promise.reject(Error('Invalid PDF structure'))});
  await assert.rejects(()=>ctx.parseBytes(bytes,{innerHTML:''}),/无法打开 PDF，文件可能损坏、受密码保护或不完整。/);
  assert.equal(destroyed,1,'a failed open must not destroy a document that was never created');
  console.log('Offline CMap bytes, missing-map error code, split text-layer import, single-lesson PDF, worker cleanup and failed-open diagnostics passed');
})().catch(error=>{console.error(error);process.exitCode=1});
