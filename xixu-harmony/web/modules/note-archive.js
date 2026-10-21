  // Imported originals live outside the planner JSON. Rendering never inserts
  // user HTML: only escaped text, explicit breaks and verified raster images.
  const ARCHIVE_FILE_LIMIT=20*1024*1024;
  let archiveDraft=[],archiveError='',archiveHelp=false,archiveBusy=false,archiveProgress='',archiveToken=0,archiveQueue=Promise.resolve(),archiveDatabase=null;
  const archiveUrls=new Map();
  const archiveYield=()=>new Promise(resolve=>setTimeout(resolve,0));
  const archiveHashPattern=/^[a-f0-9]{64}$/;
  function noteImageCount(note){return (note.images?.length||0)+(note.archive?.images?.length||0)}
  function archiveBase64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary)}
  function archiveUnbase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes}
  async function archiveSha(bytes){
    if(globalThis.crypto?.subtle){try{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')}catch(_){}}
    // SHA-256 fallback for resource:// contexts without WebCrypto. Work yields
    // every 256 KiB rather than blocking the mobile UI on a large original.
    const k=new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]),words=new Uint32Array(64),rotate=(v,n)=>(v>>>n)|(v<<(32-n));
    const blocks=Math.ceil((bytes.length+9)/64),tail=new Uint8Array(128);tail.set(bytes.subarray(Math.floor(bytes.length/64)*64));tail[bytes.length%64]=128;
    const tailLength=bytes.length%64<56?64:128,tailView=new DataView(tail.buffer);tailView.setUint32(tailLength-8,Math.floor(bytes.length/0x20000000));tailView.setUint32(tailLength-4,(bytes.length*8)>>>0);
    for(let block=0;block<blocks;block++){
      const offset=block*64,view=offset+64<=bytes.length?new DataView(bytes.buffer,bytes.byteOffset+offset,64):new DataView(tail.buffer,(block-Math.floor(bytes.length/64))*64,64);
      for(let j=0;j<16;j++)words[j]=view.getUint32(j*4);
      for(let j=16;j<64;j++){const x=words[j-15],y=words[j-2];words[j]=(words[j-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[j-7]+(rotate(y,17)^rotate(y,19)^(y>>>10)))>>>0}
      let [a,b,c,d,e,f,g,h]=state;
      for(let j=0;j<64;j++){const t1=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[j]+words[j])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}
      [a,b,c,d,e,f,g,h].forEach((value,index)=>{state[index]=(state[index]+value)>>>0});if(block&&block%4096===0)await archiveYield();
    }
    return [...state].map(value=>value.toString(16).padStart(8,'0')).join('');
  }
  function archiveSerial(job){const next=archiveQueue.then(job);archiveQueue=next.catch(()=>{});return next}
  function archiveDb(){
    if(archiveDatabase)return archiveDatabase;
    archiveDatabase=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(Error('本环境不支持原件存储，请使用更新后的安装版'));return}
      const request=indexedDB.open('xixu-note-archive-v1',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('assets');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('无法打开原件存储'));request.onblocked=()=>reject(Error('原件存储被另一个页面占用，请关闭旧页面'));
    });return archiveDatabase;
  }
  async function archiveRead(key){
    if(!archiveHashPattern.test(key))throw Error('原件编号无效');
    const bytes=await archiveSerial(async()=>{
      if(window.XixuArchive){
        const size=Number(window.XixuArchive.beginRead(key));if(!Number.isInteger(size)||size<1||size>ARCHIVE_FILE_LIMIT)throw Error('原件大小无效');
        const target=new Uint8Array(size);let offset=0;
        try{while(offset<size){const chunk=archiveUnbase64(window.XixuArchive.readChunk(256*1024));if(!chunk.length||offset+chunk.length>size)throw Error('原件读取不完整');target.set(chunk,offset);offset+=chunk.length;await archiveYield()}return target}finally{window.XixuArchive.close()}
      }
      if(window.XixuStore)throw Error('此安装包尚未接入图文原件存储，请先更新应用');
      const db=await archiveDb(),blob=await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readonly'),request=tx.objectStore('assets').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(Error('原件读取失败'))});
      if(!(blob instanceof Blob))throw Error('本机缺少图文原件，请重新导入保存的原始 HTML');
      return new Uint8Array(await blob.arrayBuffer());
    });
    if(await archiveSha(bytes)!==key)throw Error('原件校验不一致，已停止展示；请保留文件并重新导入');return bytes;
  }
  async function archiveStore(bytes,key){
    if(!archiveHashPattern.test(key)||!bytes.length||bytes.length>ARCHIVE_FILE_LIMIT||await archiveSha(bytes)!==key)throw Error('原件校验失败');
    await archiveSerial(async()=>{
      if(window.XixuArchive){
        try{if(window.XixuArchive.beginWrite(key,bytes.length)){for(let offset=0;offset<bytes.length;offset+=256*1024){if(!window.XixuArchive.writeChunk(archiveBase64(bytes.subarray(offset,offset+256*1024))))throw Error('原件写入失败');await archiveYield()}if(!window.XixuArchive.finishWrite())throw Error('原件未完整保存')}}finally{window.XixuArchive.close()}return;
      }
      if(window.XixuStore)throw Error('此安装包尚未接入图文原件存储，请先更新应用');
      const db=await archiveDb();await new Promise((resolve,reject)=>{const tx=db.transaction('assets','readwrite'),store=tx.objectStore('assets'),existing=store.get(key);existing.onsuccess=()=>{if(existing.result===undefined)store.add(new Blob([bytes]),key)};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(Error('原件没有保存，请检查本机可用空间'))});
    });
    const saved=await archiveRead(key);if(saved.length!==bytes.length)throw Error('原件保存后字节数不一致');
  }
  async function verifyNoteArchiveSources(list){
    for(const note of list||[]){if(!note.archive)continue;try{await archiveRead(note.archive.originalHash);for(const image of note.archive.images)await archiveRead(image.hash)}catch(_){throw Error('备份中的图文原件未在本机完整就绪。请先重新导入原始 HTML，再恢复索引；现有资料未替换。')}}
  }
  async function archiveSelectedBytes(file,index,selection){
    if(window.XixuFile){
      const info=JSON.parse(window.XixuFile.begin(index));if(selection.id!==undefined&&info.selectionId!==selection.id)throw Error('文件选择已变化，请重新选择');if(info.selectionId!==undefined)selection.id=info.selectionId;
      const size=Number(info.size);if(!Number.isInteger(size)||size<1||size>ARCHIVE_FILE_LIMIT)throw Error('单个 HTML 必须小于等于 20 MiB');
      const bytes=new Uint8Array(size);let offset=0;
      while(offset<size){const chunk=archiveUnbase64(window.XixuFile.readChunk(256*1024));if(!chunk.length||offset+chunk.length>size)throw Error('文件读取不完整，未导入');bytes.set(chunk,offset);offset+=chunk.length;await archiveYield()}return bytes;
    }
    if(!file.size||file.size>ARCHIVE_FILE_LIMIT)throw Error('单个 HTML 必须小于等于 20 MiB');return new Uint8Array(await file.arrayBuffer());
  }
  async function parseArchiveHtml(bytes,fileName){
    let raw;
    try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch(_){throw Error('文件不是可读取的 UTF-8 HTML。修改 hdoc 的扩展名不会转换内容，请从华为备忘录重新导出')}
    if(!/^\s*(?:<!doctype\s+html\b|<!--|<[a-z][a-z0-9-]*\b)/i.test(raw.replace(/^\uFEFF/,'')))throw Error('文件内容不是支持的 HTML，未导入；请勿只修改扩展名');
    const template=document.createElement('template');template.innerHTML=raw;
    const fragment=template.content;
    if(fragment.querySelector('script,iframe,object,embed,svg,math,audio,video,form'))throw Error('文件含不支持的主动内容或附件，已停止；请保留原件');
    if(fragment.querySelector('link'))throw Error('文件引用外部资源，暂不支持，请保留 HTML 和资源目录');
    const images=[],layout=[],plain=[],blockTags=new Set(['DIV','P','LI','H1','H2','H3','H4','H5','H6','PRE','BLOCKQUOTE','TR']);
    const walk=async node=>{
      if(node.nodeType===3){layout.push({kind:'text',text:node.nodeValue});plain.push(node.nodeValue);return}
      if(node.nodeType!==1||['STYLE','TITLE','META','NOSCRIPT','HEAD','TEMPLATE'].includes(node.tagName))return;
      if(node.tagName==='INPUT'){if(node.getAttribute('type')?.toLowerCase()!=='checkbox')throw Error('文件含不支持的输入控件，已停止；请保留原件');const checked=node.hasAttribute('checked');layout.push({kind:'checkbox',checked});plain.push(checked?'☑':'☐');return}
      if(node.tagName==='IMG'){
        const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(node.getAttribute('src')||'');if(!match)throw Error('有图片未内嵌或格式不支持，未导入；请保留全部原件');
        const encoded=match[2].replace(/\s/g,''),picture=archiveUnbase64(encoded);if(archiveBase64(picture)!==encoded||!picture.length||picture.length>ARCHIVE_FILE_LIMIT)throw Error('图片字节无效，已停止');
        const mime=match[1].toLowerCase(),magic=mime==='image/jpeg'?picture[0]===255&&picture[1]===216&&picture[2]===255:mime==='image/png'?archiveBase64(picture.subarray(0,8))==='iVBORw0KGgo=':String.fromCharCode(...picture.subarray(0,4))==='RIFF'&&String.fromCharCode(...picture.subarray(8,12))==='WEBP';
        if(!magic)throw Error('图片类型与文件字节不符，已停止');const hash=await archiveSha(picture),width=Number(node.getAttribute('width')),height=Number(node.getAttribute('height')),ratio=Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width<=100000&&height<=100000?{width,height}:{};images.push({hash,mime,bytes:picture.length,...ratio,originalBytes:picture});layout.push({kind:'image',index:images.length-1});return;
      }
      if(node.tagName==='BR'){layout.push({kind:'break'});plain.push('\n');return}
      const block=blockTags.has(node.tagName);if(block)layout.push({kind:'open'});
      for(const child of node.childNodes)await walk(child);
      if(block){layout.push({kind:'close'});plain.push('\n')}
    };
    for(const child of fragment.childNodes)await walk(child);
    const text=plain.join('');if(!text.trim()&&!images.length)throw Error('没有找到正文或图片');if(text.length>50000||layout.length>10000||images.length>500)throw Error('内容超出本次支持范围，未裁剪或导入，请保留原件');
    const name=String(fileName||'').split(/[\\/]/).at(-1),title=name.replace(/\.html?$/i,'');if(!title)throw Error('原文件名缺失，请核对后重试');
    return {title,text,images,layout,originalHash:await archiveSha(bytes),textHash:await archiveSha(new TextEncoder().encode(text)),fileName:name,fileBytes:bytes.length};
  }
  async function prepareArchiveImport(fileList){
    if(archiveBusy)return;const files=Array.from(fileList||[]),token=++archiveToken,selection={};archiveDraft=[];archiveError='';archiveHelp=false;
    if(!files.length)return;if(files.length>500){notify('一次最多选择 500 个 HTML 文件');return}
    const hdocCount=files.filter(file=>/\.hdoc$/i.test(file.name)).length;
    if(hdocCount){archiveHelp=true;archiveError='本批包含 '+hdocCount+' 个 hdoc 原件，尚不能可靠解读其正文和图片。本批全部停止，没有新增或替换任何笔记，也没有读取或上传文件内容';openPanel({kind:'archive-import'});return}
    if(files.some(file=>! /\.html?$/i.test(file.name))){notify('请选择华为导出的 HTML 文件；hdoc 尚不能解读');return}
    archiveBusy=true;openPanel({kind:'archive-import'});
    try{
      if(storageBlocked)throw Error('本机资料读取异常，已停止导入以免覆盖资料');
      if(window.XixuStore&&!window.XixuArchive)throw Error('请先安装支持图文原件存储的新版本');
      if(window.XixuArchive?.status&&window.XixuArchive.status()!=='ready')throw Error('本机原件目录不可用，请检查存储空间后重试');
      if(!window.XixuStore&&navigator.storage?.estimate){const capacity=await navigator.storage.estimate(),required=files.reduce((sum,file)=>sum+file.size*2,0);if(capacity.quota&&capacity.quota-(capacity.usage||0)<required+16*1024*1024)throw Error('可用存储不足，未导入或压缩内容');}
      for(let index=0;index<files.length;index++){
        if(token!==archiveToken)return;archiveProgress='正在核对 '+(index+1)+' / '+files.length;render(false);
        const bytes=await archiveSelectedBytes(files[index],index,selection),parsed=await parseArchiveHtml(bytes,files[index].name);
        if(token!==archiveToken)return;
        await archiveStore(bytes,parsed.originalHash);
        for(const image of parsed.images){await archiveStore(image.originalBytes,image.hash);delete image.originalBytes}
        archiveDraft.push({...parsed,alreadyImported:notes.some(note=>note.archive?.originalHash===parsed.originalHash&&note.archive?.fileName===parsed.fileName)});
        await archiveYield();
      }
    }catch(error){archiveError=String(error.message||'图文文件核对失败');archiveDraft=[]}
    finally{if(window.XixuFile&&selection.id!==undefined)window.XixuFile.finish(selection.id);if(token===archiveToken){archiveBusy=false;archiveProgress='';if(panel?.kind==='archive-import')render(false)}}
  }
  function renderArchiveImport(){
    const input='<input id="xixu-archive-files" type="file" multiple accept=".html,.htm,.hdoc,text/html" hidden>';
    if(archiveHelp)return top('从华为备忘录迁移')+(archiveError?'<p class="tide-note warm" role="alert">'+esc(archiveError)+'</p>':'')+archiveExportHelp()+input;
    if(archiveBusy)return top('核对图文原件')+'<p role="status">'+esc(archiveProgress||'准备原件存储…')+'</p><div class="tide-note">仅在本机核对并暂存原件，确认后才加入笔记。可以返回取消；不会修改华为备忘录。</div>'+input;
    if(archiveError)return top('图文导入未完成')+'<div class="tide-note warm" role="alert">'+esc(archiveError)+'。没有新增或替换任何笔记，已读取的原件暂存仍保留。</div><button class="tide-primary" data-action="archive-pick">重新选择 HTML</button>'+input;
    return top('核对华为图文')+'<div class="xixu-import-summary"><strong>'+archiveDraft.length+' 条 · '+archiveDraft.reduce((sum,item)=>sum+item.images.length,0)+' 张图片</strong></div><div class="tide-note">保留导出 HTML 及其中的图片字节和顺序，不再压缩。源编辑时间未提供，显示未知；不能保证华为导出前没有处理图片。相同正文不会自动合并。请先核对条数与图片数量。</div><form id="xixu-archive-review" class="xixu-note-import-list">'+archiveDraft.map((item,index)=>'<label><input type="checkbox" name="archiveImport" value="'+index+'" '+(item.alreadyImported?'':'checked')+'><span><strong>'+esc(item.title)+'</strong><small>'+item.images.length+' 张图片 · '+(item.fileBytes/1048576).toFixed(2)+' MiB · '+(item.alreadyImported?'同名原件已导入，可选择再保留一份':'原件保存后哈希核对通过')+'</small></span></label>').join('')+'<div class="tide-detail-actions"><button type="button" class="tide-secondary" data-action="archive-pick">重新选择</button><button class="tide-primary" type="submit" '+(!archiveDraft.length?'disabled':'')+'>确认导入图文</button></div></form>'+input;
  }
  function archiveExportHelp(){
    return '<h2>只有 hdoc？先区分两个入口</h2><ol><li>在华为备忘录中<strong>打开一条备忘</strong>，不要停在多选列表。</li><li>找<strong>更多 → 导出</strong>，查看是否有 HTML。<strong>分享为备忘 → 另存为</strong>得到的通常是 hdoc，两者不是同一条路径。</li><li>若有 HTML，先导出一条带图片的备忘，在这里核对文字、图片数量和顺序；通过后再继续迁移。</li></ol><p class="tide-note">如果单条的“更多 → 导出”里确实也只有 hdoc，请保留所有原件，并提供这一层菜单截图（正文可遮住）。不同系统和内容的选项可能不同，不需要反复改扩展名或使用不明在线转换器。</p><p class="tide-note warm">当前 hdoc 不能直接转为可阅读、可检索的笔记。PDF/截图或 OCR 不能当作全量无损替代；未给出的原编辑时间也不会补造。迁移核对前不要删除华为备忘录或原文件。</p><p><a href="https://consumer.huawei.com/cn/support/content/zh-cn16070761/" target="_blank" rel="noopener noreferrer">查看华为官方导出说明</a></p><button class="tide-primary tide-full" data-action="archive-pick">选择导出文件并核对</button>';
  }
  function archiveLayoutHtml(archive){
    return archive.layout.map(item=>item.kind==='text'?esc(item.text):item.kind==='break'?'<br>':item.kind==='open'?'<div>':item.kind==='close'?'</div>':item.kind==='checkbox'?'<input type="checkbox" disabled aria-label="原件中的核对项" '+(item.checked?'checked':'')+'>':item.kind==='image'?'<img data-archive-hash="'+archive.images[item.index].hash+'" data-archive-mime="'+archive.images[item.index].mime+'" '+(archive.images[item.index].width?'style="aspect-ratio:'+archive.images[item.index].width+'/'+archive.images[item.index].height+';width:100%" ':'')+'alt="导入图片 '+(item.index+1)+'" loading="lazy">':'').join('');
  }
  const memoryWithoutArchive=renderMemory;
  renderMemory=function(id){
    const note=notes.find(item=>item.id===id);if(!note?.archive||panel?.editArchive)return memoryWithoutArchive(id);
    const archive=note.archive;
    const addedImages=normalizeAttachments(note.images);
    return top(note.title)+'<div class="xixu-note-timestamps">'+noteTimestampHtml(note)+noteTimestampHtml(note,'imported')+'</div><div class="tide-note">保留 '+archive.images.length+' 张导出图片与原始 HTML。原图在华为导出前是否处理尚未验证。</div><article class="xixu-archive-content" data-note-id="'+esc(id)+'">'+(note.archiveEdited?'<div class="xixu-archive-edited">'+esc(note.text)+'</div><details><summary>查看导入时的图文</summary>'+archiveLayoutHtml(archive)+'</details>':archiveLayoutHtml(archive))+(addedImages.length?'<h3>新增图片</h3>'+addedImages.map(image=>'<img src="'+esc(image.dataUrl)+'" alt="'+esc(image.name)+'" loading="lazy">').join(''):'')+'</article><p class="xixu-archive-status" role="status"></p><div class="tide-detail-actions"><button class="tide-secondary" data-action="archive-edit" data-id="'+esc(id)+'">编辑文字副本</button><button class="tide-secondary" data-action="archive-export" data-id="'+esc(id)+'">导出原始 HTML</button></div><button class="tide-delete" data-action="delete-memory" data-id="'+esc(id)+'">删除这条笔记</button>';
  };
  async function hydrateNoteArchive(){
    const article=main.querySelector('.xixu-archive-content');
    if(!article){for(const url of archiveUrls.values())URL.revokeObjectURL(url);archiveUrls.clear();return}
    const needed=new Set([...article.querySelectorAll('[data-archive-hash]')].map(image=>image.dataset.archiveHash));
    for(const [key,url] of archiveUrls){if(!needed.has(key)){URL.revokeObjectURL(url);archiveUrls.delete(key)}}
    try{
      const note=notes.find(item=>item.id===article.dataset.noteId);if(note?.archive)await archiveRead(note.archive.originalHash);
      for(const image of article.querySelectorAll('[data-archive-hash]')){
        if(!article.isConnected)return;const key=image.dataset.archiveHash;
        if(!archiveUrls.has(key)){const bytes=await archiveRead(key);if(!article.isConnected)return;archiveUrls.set(key,URL.createObjectURL(new Blob([bytes],{type:image.dataset.archiveMime})))}
        if(image.isConnected){image.addEventListener('error',()=>{if(article.isConnected)main.querySelector('.xixu-archive-status').textContent='有图片无法显示，原件字节仍保留，请核对导出文件'},{once:true});image.src=archiveUrls.get(key);}
      }
      if(article.isConnected)main.querySelector('.xixu-archive-status').textContent='图片字节校验通过';
    }catch(error){if(article.isConnected)main.querySelector('.xixu-archive-status').textContent=error.message}
  }
  const settingsWithoutArchive=renderSettings;
  renderSettings=function(){
    let html=settingsWithoutArchive()+'<div class="tide-section"><h2>华为图文迁移</h2></div><button class="tide-secondary tide-full" data-action="archive-pick">'+icon('folder-input')+'导入华为 HTML 图文</button><button class="tide-secondary tide-full" data-action="archive-help">只能导出 hdoc？</button><input id="xixu-archive-files" type="file" multiple accept=".html,.htm,.hdoc,text/html" hidden><div class="tide-note">可迁移 HTML 图文；hdoc 仅提供格式提示，尚不能解读。一次最多选择 500 条 HTML，单条最大 20 MiB。原件独立保存，未确认完整的格式会停止，不会压缩或裁剪资料。</div>';
    if(notes.some(note=>note.archive)){html=html.replace('导出全部数据','导出索引与其他数据').replace('可以随时导出独立备份，包含课表、事项、碎片、笔记、图片和考核方式。不会包含 DeepSeek API Key。','JSON 保存索引与其他资料，不包含独立存储的图文原件，也不包含 API Key。');html+='<div class="tide-note warm">图文原件独立保存在本机，不随 JSON 索引备份或云索引同步。请保留华为导出的全部 HTML，或在每条笔记中导出原始 HTML；跨设备恢复须同时携带这些原件。不要仅备份 JSON 后卸载应用。</div>'}
    return html;
  };
  window.XixuReceiveArchiveExport=(ok,message)=>notify(message|| (ok?'原件已导出':'原件导出未完成'));
  root.addEventListener('change',event=>{if(event.target.id==='xixu-archive-files'){event.stopImmediatePropagation();prepareArchiveImport(event.target.files);event.target.value=''}},true);
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
    if(archiveBusy&&['back','nav'].includes(action)){archiveToken++;archiveBusy=false;archiveDraft=[];return}
    if(!['archive-pick','archive-help','archive-edit','archive-export'].includes(action))return;event.preventDefault();event.stopImmediatePropagation();
    if(action==='archive-help'){archiveHelp=true;archiveDraft=[];archiveError='';openPanel({kind:'archive-import'});return}
    if(action==='archive-pick'){main.querySelector('#xixu-archive-files')?.click();return}
    const note=notes.find(item=>item.id===button.dataset.id);if(!note?.archive)return;
    if(action==='archive-edit'){openPanel({kind:'memory',id:note.id,editArchive:true});return}
    try{
      await archiveRead(note.archive.originalHash);
      if(window.XixuArchive){if(!window.XixuArchive.exportFile(note.archive.originalHash,note.archive.fileName))throw Error('没有取得原件导出权限')}
      else{const bytes=await archiveRead(note.archive.originalHash),url=URL.createObjectURL(new Blob([bytes],{type:'text/html'})),link=document.createElement('a');link.href=url;link.download=note.archive.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
    }catch(error){notify(error.message)}
  },true);
  root.addEventListener('submit',async event=>{
    if(event.target.id!=='xixu-archive-review')return;event.preventDefault();event.stopImmediatePropagation();if(archiveBusy)return;
    const selected=new Set(new FormData(event.target).getAll('archiveImport').map(Number)),chosen=archiveDraft.filter((_,index)=>selected.has(index));if(!chosen.length){notify('请至少选择一条图文');return}
    archiveBusy=true;const token=++archiveToken,submit=event.target.querySelector('[type="submit"]');submit.disabled=true;
    try{
      if(storageBlocked)throw Error('本机资料读取异常，未写入');
      for(const item of chosen){await archiveRead(item.originalHash);for(const image of item.images)await archiveRead(image.hash)}
      if(token!==archiveToken)throw Error('已取消确认，本次没有新增笔记');
      const now=new Date().toISOString(),added=chosen.map(item=>({id:uid(),title:item.title,text:item.text,category:'笔记',course:'',images:[],createdAt:'',updatedAt:'',importedAt:now,archive:{version:1,originalHash:item.originalHash,fileName:item.fileName,fileBytes:item.fileBytes,textHash:item.textHash,images:item.images,layout:item.layout}}));
      const oldNotes=notes,oldSaved=lastSaved;notes=[...notes,...added];
      try{const value=JSON.stringify(checkData(snapshot(),false));storageWrite(value);lastSaved=value;saveError.hidden=true}catch(error){notes=oldNotes;lastSaved=oldSaved;throw Error('笔记索引未保存，原有资料未替换；请检查本机容量')}
      archiveDraft=[];panel=null;previousPanel=null;page='notes';archiveBusy=false;render(false);notify('已导入 '+added.length+' 条图文；源编辑时间未知');
    }catch(error){archiveBusy=false;notify(error.message);if(submit.isConnected)submit.disabled=false}
  },true);
