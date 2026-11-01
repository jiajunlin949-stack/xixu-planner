  // Imported originals live outside the planner JSON. Rendering never inserts
  // user HTML: only escaped text, explicit breaks and verified raster images.
  let archiveQueue=Promise.resolve(),archiveDatabase=null;
  const archiveUrls=new Map();
  const archiveYield=()=>new Promise(resolve=>setTimeout(resolve,0));
  const archiveHashPattern=/^[a-f0-9]{64}$/;
  function noteImageCount(note){return (note.images?.length||0)+(note.archive?.images?.length||0)}
  function archiveBase64(bytes){let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));return btoa(binary)}
  function archiveUnbase64(value){const binary=atob(value),bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes}
  async function archiveSha(bytes){
    if(globalThis.crypto?.subtle&&bytes.length<=16*1024*1024){try{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('')}catch(_){}}
    const digest=new ArchiveDigest();for(let offset=0;offset<bytes.length;offset+=ARCHIVE_CHUNK_SIZE){digest.update(bytes.subarray(offset,offset+ARCHIVE_CHUNK_SIZE));await archiveYield()}return digest.finish().hash;
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
    const parts=[],result=await archiveWalk(key,async bytes=>parts.push(bytes.slice()));
    const output=new Uint8Array(result.bytes);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length}return output;
  }
  async function archiveStore(bytes,key){await archiveStoreSource(archiveBytesSource(bytes),key)}
  async function verifyNoteArchiveSources(list){
    for(const note of list||[]){if(!note.archive)continue;try{await archiveWalk(note.archive.originalHash);for(const image of note.archive.images)await archiveWalk(image.hash)}catch(_){throw Error('备份中的图文原件未在本机完整就绪。请先重新导入原始 HTML，再恢复索引；现有资料未替换。')}}
  }
  async function archiveSelectedBytes(file,index,selection){
    const source=await archiveSelectedSource(file,index,selection);
    if(!archiveValidSize(source.size)||source.size>DOCUMENT_WORKING_BYTES)throw Error('此文件请按原件方式归档，文字展开超出当前工作内存预算');
    const bytes=new Uint8Array(source.size);for(let offset=0;offset<source.size;offset+=ARCHIVE_CHUNK_SIZE){const length=Math.min(ARCHIVE_CHUNK_SIZE,source.size-offset),part=await source.read(offset,length);if(part.length!==length)throw Error('文件读取不完整');bytes.set(part,offset);await archiveYield()}return bytes;
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
  function prepareArchiveImport(fileList){return prepareNoteImport(fileList)}
  function renderArchiveImport(){return top('从华为备忘录迁移')+archiveExportHelp()+'<input id="xixu-archive-files" type="file" multiple accept=".html,.htm,.hdoc,text/html" hidden>'}
  function archiveExportHelp(){
    return '<h2>直接选择备忘录导出文件</h2><p>HTML 可展开图文并检索；hdoc 可逐字节归档、核对 SHA-256 并原样导出。hdoc 正文尚未解析时会明确显示“仅原件”，不将文件名当作已恢复的正文。</p><p>若手机支持“打开单条备忘 → 更多 → 导出 → HTML”，可为同一条备忘另导出 HTML，补充可阅读内容。原件与源时间分别保留；未知的创建或编辑时间不会补造。</p><button class="tide-primary tide-full" data-action="archive-pick">选择导出文件并核对</button>';
  }
  function archiveLayoutHtml(archive){
    return archive.layout.map(item=>item.kind==='text'?esc(item.text):item.kind==='break'?'<br>':item.kind==='open'?'<div>':item.kind==='close'?'</div>':item.kind==='checkbox'?'<input type="checkbox" disabled aria-label="原件中的核对项" '+(item.checked?'checked':'')+'>':item.kind==='image'?'<img data-archive-hash="'+archive.images[item.index].hash+'" data-archive-mime="'+archive.images[item.index].mime+'" '+(archive.images[item.index].width?'style="aspect-ratio:'+archive.images[item.index].width+'/'+archive.images[item.index].height+';width:100%" ':'')+'alt="导入图片 '+(item.index+1)+'" loading="lazy">':'').join('');
  }
  const memoryWithoutArchive=renderMemory;
  renderMemory=function(id){
    const note=notes.find(item=>item.id===id);if(!note?.archive||panel?.editArchive)return memoryWithoutArchive(id);
    const archive=note.archive;
    const addedImages=normalizeAttachments(note.images);
    const originalLabel=archive.version===2?'导出原文件':'导出原始 HTML',notice=archive.projectionStatus==='original-only'?'原文件已完整归档，正文与内嵌图片尚未展开，可核对哈希并原样导出。':archive.version===2?'保留原始 '+esc(archive.format.toUpperCase())+' 文件与 '+archive.images.length+' 张阅读图片。文字视图用于检索，原文档版式以原文件为准。':'保留 '+archive.images.length+' 张导出图片与原始 HTML。原图在华为导出前是否处理尚未验证。';
    return top(note.title)+'<div class="xixu-note-timestamps">'+noteTimestampHtml(note)+noteTimestampHtml(note,'imported')+'</div><div class="tide-note">'+notice+'</div>'+(archive.warnings||[]).map(text=>'<p class="tide-note">'+esc(text)+'</p>').join('')+'<article class="xixu-archive-content" data-note-id="'+esc(id)+'">'+(note.archiveEdited?'<div class="xixu-archive-edited">'+esc(note.text)+'</div><details><summary>查看导入时的图文</summary>'+archiveLayoutHtml(archive)+'</details>':archiveLayoutHtml(archive))+(addedImages.length?'<h3>新增图片</h3>'+addedImages.map(image=>'<img src="'+esc(image.dataUrl)+'" alt="'+esc(image.name)+'" loading="lazy">').join(''):'')+'</article>'+noteLinksHtml(note.text)+'<p class="xixu-archive-status" role="status"></p><div class="tide-detail-actions"><button class="tide-secondary" data-action="archive-edit" data-id="'+esc(id)+'">编辑文字副本</button><button class="tide-secondary" data-action="archive-export" data-id="'+esc(id)+'">'+originalLabel+'</button></div><button class="tide-delete" data-action="delete-memory" data-id="'+esc(id)+'">删除这条笔记</button>';
  };
  async function hydrateNoteArchive(){
    const article=main.querySelector('.xixu-archive-content');
    if(!article){for(const url of archiveUrls.values())URL.revokeObjectURL(url);archiveUrls.clear();return}
    const needed=new Set([...article.querySelectorAll('[data-archive-hash]')].map(image=>image.dataset.archiveHash));
    for(const [key,url] of archiveUrls){if(!needed.has(key)){URL.revokeObjectURL(url);archiveUrls.delete(key)}}
    try{
      const note=notes.find(item=>item.id===article.dataset.noteId);if(note?.archive)await archiveWalk(note.archive.originalHash);
      for(const image of article.querySelectorAll('[data-archive-hash]')){
        if(!article.isConnected)return;const key=image.dataset.archiveHash;
        if(!archiveUrls.has(key)){const bytes=await archiveRead(key);if(!article.isConnected)return;archiveUrls.set(key,URL.createObjectURL(new Blob([bytes],{type:image.dataset.archiveMime})))}
        if(image.isConnected){image.addEventListener('error',()=>{if(article.isConnected)main.querySelector('.xixu-archive-status').textContent='有图片无法显示，原件字节仍保留，请核对导出文件'},{once:true});image.src=archiveUrls.get(key);}
      }
      if(article.isConnected)main.querySelector('.xixu-archive-status').textContent='已核对所显示原件与图片的字节校验值';
    }catch(error){if(article.isConnected)main.querySelector('.xixu-archive-status').textContent=error.message}
  }
  const settingsWithoutArchive=renderSettings;
  renderSettings=function(){
    let html=settingsWithoutArchive()+'<div class="tide-section"><h2>华为图文迁移</h2></div><button class="tide-secondary tide-full" data-action="archive-pick">'+icon('folder-input')+'导入华为备忘录原件</button><button class="tide-secondary tide-full" data-action="archive-help">查看导入方式</button><input id="xixu-archive-files" type="file" multiple accept=".html,.htm,.hdoc,text/html" hidden><div class="tide-note">可展开 HTML 图文，或完整归档 hdoc。原件按块保存，文件容量受设备可用空间影响；展开失败会在核对页显示原件状态。</div>';
    if(notes.some(note=>note.archive)){html=html.replace('导出全部数据','导出索引与其他数据').replace('可以随时导出独立备份，包含课表、事项、碎片、笔记、图片和考核方式。不会包含 DeepSeek API Key。','JSON 保存索引与其他资料，不包含独立存储的图文原件，也不包含 API Key。');html+='<div class="tide-note warm">图文原件独立保存在本机，不随 JSON 索引备份或云索引同步。请保留华为导出的全部 HTML，或在每条笔记中导出原始 HTML；跨设备恢复须同时携带这些原件。不要仅备份 JSON 后卸载应用。</div>'}
    return html;
  };
  window.XixuReceiveArchiveExport=(ok,message)=>notify(message|| (ok?'原件已导出':'原件导出未完成'));
  root.addEventListener('change',event=>{if(event.target.id==='xixu-archive-files'){event.stopImmediatePropagation();prepareArchiveImport(event.target.files);event.target.value=''}},true);
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
    if(!['archive-pick','archive-help','archive-edit','archive-export'].includes(action))return;event.preventDefault();event.stopImmediatePropagation();
    if(action==='archive-help'){openPanel({kind:'archive-import'});return}
    if(action==='archive-pick'){main.querySelector('#xixu-archive-files')?.click();return}
    const note=notes.find(item=>item.id===button.dataset.id);if(!note?.archive)return;
    if(action==='archive-edit'){openPanel({kind:'memory',id:note.id,editArchive:true});return}
    try{
      await archiveWalk(note.archive.originalHash);
      if(window.XixuArchive){if(!window.XixuArchive.exportFile(note.archive.originalHash,note.archive.fileName))throw Error('没有取得原件导出权限')}
      else{const bytes=await archiveRead(note.archive.originalHash),url=URL.createObjectURL(new Blob([bytes],{type:documentMime(note.archive.fileName)})),link=document.createElement('a');link.href=url;link.download=note.archive.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
    }catch(error){notify(error.message)}
  },true);
