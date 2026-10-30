  // Document projections are for reading/search. The exact input bytes remain
  // in the content-addressed archive and are exported without re-encoding.
  const DOCUMENT_FORMATS=['txt','md','markdown','csv','html','htm','json','docx','pdf','png','jpg','jpeg','webp','hdoc','doc'];
  const NOTE_IMPORT_ACCEPT='.txt,.md,.markdown,.csv,.html,.htm,.json,.docx,.pdf,.png,.jpg,.jpeg,.webp,.hdoc,.doc';
  let noteImportBusy=false,noteImportGeneration=0;
  const DOCUMENT_WORKING_BYTES=64*1024*1024,DOCUMENT_IMAGE_BUDGET=64*1024*1024;
  let documentImportProgress='';
  function documentMime(name){
    const ext=String(name).split('.').pop().toLowerCase();
    return ({hdoc:'application/octet-stream',doc:'application/msword',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',html:'text/html',htm:'text/html',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',json:'application/json'})[ext]||'text/plain';
  }
  function documentText(bytes){
    let text;
    try{text=new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(bytes)}
    catch(_){try{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes)}catch(_){throw Error('无法完整读取文字编码，请另存为 UTF-8；原文件未修改')}}
    if(text.includes('\0'))throw Error('文件含二进制内容，不能当作文字导入');return text;
  }
  function documentXml(bytes){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('文档 XML 含不支持的实体声明');
    const xml=new DOMParser().parseFromString(text,'application/xml');
    if(xml.getElementsByTagName('parsererror').length)throw Error('文档 XML 已损坏');return xml;
  }
  async function documentCrc(bytes){
    const table=new Uint32Array(256);for(let value=0;value<256;value++){let crc=value;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);table[value]=crc}
    let crc=0xffffffff;for(let index=0;index<bytes.length;index++){crc=(crc>>>8)^table[(crc^bytes[index])&255];if(index&&index%262144===0)await archiveYield()}return (crc^0xffffffff)>>>0;
  }
  function documentZipEntries(bytes){
    if(!globalThis.fflate)throw Error('DOCX 读取组件未加载，请重新打开汐序');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
    for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break}
    if(end<0||view.getUint16(end+4,true)||view.getUint16(end+6,true))throw Error('DOCX 不是受支持的完整 ZIP 文档');
    const count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),size=view.getUint32(end+12,true);
    if(!count||count>2000||offset+size>end)throw Error('DOCX 条目数量或目录范围无效');
    let cursor=offset,total=0;const names=new Set(),expected=new Map();
    for(let index=0;index<count;index++){
      if(cursor+46>offset+size||view.getUint32(cursor,true)!==0x02014b50)throw Error('DOCX 目录不完整');
      const flags=view.getUint16(cursor+8,true),packed=view.getUint32(cursor+20,true),unpacked=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true);
      if(cursor+46+length+extra+comment>offset+size||flags&1||unpacked===0xffffffff||packed===0xffffffff)throw Error('暂不支持加密、ZIP64 或损坏的 DOCX');
      const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(cursor+46,cursor+46+length));
      if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||names.has(name))throw Error('DOCX 中存在重复或不安全的文件路径');
      names.add(name);expected.set(name,{bytes:unpacked,crc:view.getUint32(cursor+16,true)});total+=unpacked;
      if(total>64*1024*1024||unpacked>ARCHIVE_FILE_LIMIT||unpacked>Math.max(packed,1)*1000)throw Error('DOCX 解压内容过大，未裁剪或导入');
      cursor+=46+length+extra+comment;
    }
    if(cursor!==offset+size)throw Error('DOCX 目录长度不一致');
    return new Promise((resolve,reject)=>fflate.unzip(bytes,(error,result)=>{
      if(error){reject(Error('DOCX 解压失败'));return}
      (async()=>{if(Object.keys(result).length!==expected.size)throw Error('DOCX 条目清单不一致');for(const [name,info] of expected){const content=result[name];if(!content||content.length!==info.bytes||await documentCrc(content)!==info.crc)throw Error('DOCX 内容校验失败，未导入')}return result})().then(resolve,reject);
    }));
  }
  async function documentPicture(bytes,mime){
    if(!['image/png','image/jpeg','image/webp'].includes(mime)||!bytes.length||bytes.length>ARCHIVE_FILE_LIMIT)throw Error('文档图片格式或大小不支持，未丢弃图片继续导入');
    const magic=mime==='image/png'?archiveBase64(bytes.subarray(0,8))==='iVBORw0KGgo=':mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
    if(!magic)throw Error('图片类型与原始字节不一致');
    return {hash:await archiveSha(bytes),mime,bytes:bytes.length,originalBytes:bytes};
  }
  async function documentDocx(bytes){
    const entries=await documentZipEntries(bytes),main=entries['word/document.xml'];
    if(!main||!entries['[Content_Types].xml'])throw Error('未找到 DOCX 正文');
    if(entries['word/vbaProject.bin'])throw Error('不支持含宏的文档');
    const xml=documentXml(main),relationships=new Map(),warnings=[],images=[],layout=[],plain=[];
    if(entries['word/_rels/document.xml.rels'])for(const rel of documentXml(entries['word/_rels/document.xml.rels']).getElementsByTagName('Relationship'))relationships.set(rel.getAttribute('Id'),{target:rel.getAttribute('Target')||'',external:rel.getAttribute('TargetMode')==='External'});
    const walk=async node=>{
      if(node.nodeType!==1)return;const kind=node.localName;
      if(['object','altChunk','pict'].includes(kind))throw Error('DOCX 含暂不支持的嵌入对象或旧式图片，请保留原文件');
      if(kind==='t'){const text=node.textContent||'';layout.push({kind:'text',text});plain.push(text);return}
      if(kind==='tab'){layout.push({kind:'text',text:'\t'});plain.push('\t');return}
      if(kind==='br'||kind==='cr'){layout.push({kind:'break'});plain.push('\n');return}
      if(kind==='blip'){
        const id=node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed'),rel=relationships.get(id);
        if(!rel||rel.external)throw Error('DOCX 图片不是完整内嵌原件，未下载外部图片');
        let target=rel.target.replace(/^\//,'');if(!rel.target.startsWith('/'))target='word/'+target;
        const parts=[];for(const part of target.split('/')){if(part==='..'){if(!parts.length)throw Error('DOCX 图片路径无效');parts.pop()}else if(part&&part!=='.')parts.push(part)}
        target=parts.join('/');const data=entries[target];if(!data)throw Error('DOCX 图片缺失，未导入');
        const picture=await documentPicture(data,documentMime(target));images.push(picture);layout.push({kind:'image',index:images.length-1});return;
      }
      if(kind==='p')layout.push({kind:'open'});
      for(const child of node.childNodes)await walk(child);
      if(kind==='p'){layout.push({kind:'close'});plain.push('\n')}
      if(kind==='tc'){layout.push({kind:'text',text:'\t'});plain.push('\t')}
    };
    await walk(xml.documentElement);
    if(Object.keys(entries).some(name=>/^word\/(header|footer|footnotes|endnotes|comments)/.test(name)))warnings.push('正文视图不展开页眉、页脚、脚注或批注；这些内容仍完整保留在原始 DOCX 中。');
    if(xml.getElementsByTagNameNS('*','ins').length||xml.getElementsByTagNameNS('*','del').length)warnings.push('此文档含修订，提取视图不等同 Word 的修订显示；请核对原件。');
    const result={text:plain.join(''),images,layout,warnings};
    if(entries['docProps/core.xml']){const core=documentXml(entries['docProps/core.xml']);for(const [key,tag] of [['createdAt','created'],['updatedAt','modified']]){const value=core.getElementsByTagNameNS('*',tag)[0]?.textContent;if(value&&Number.isFinite(Date.parse(value))&&/(?:Z|[+-]\d\d:\d\d)$/.test(value))result[key]=new Date(value).toISOString()}}
    return result;
  }
  async function documentPdf(bytes){
    if(!globalThis.pdfjsLib?.getDocument)throw Error('PDF 读取组件未就绪');
    if(String.fromCharCode(...bytes.subarray(0,5))!=='%PDF-')throw Error('文件不是完整的 PDF');
    let pdf;const generation=noteImportGeneration,images=[],layout=[],plain=[],unread=[],warnings=['保留原始 PDF 和逐页图像。文字层与 OCR 是检索副本，可以对照页面核对。'];
    try{
      pdf=await pdfjsLib.getDocument({data:bytes.slice(),cMapUrl:'cmaps/',cMapPacked:true,isEvalSupported:false}).promise;
      if(!pdf.numPages)throw Error('PDF 没有可读取的页面');
      for(let index=1;index<=pdf.numPages;index++){
        if(generation!==noteImportGeneration)throw Error('已取消文档导入');
        documentImportProgress='正在处理 PDF 第 '+index+' / '+pdf.numPages+' 页';if(panel?.kind==='note-import')render(false);
        const page=await pdf.getPage(index),content=await page.getTextContent();let text=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
        const base=page.getViewport({scale:1}),scale=Math.min(1.75,Math.sqrt(2000000/(base.width*base.height))),viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        try{
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
          if(text.replace(/\s/g,'').length<20&&window.XixuOCR?.recognizeDocumentPage){
            try{const scan=await recognizePdfPage(window.XixuOCR,canvas.toDataURL('image/png'),index);if(String(scan.value||'').trim())text=String(scan.value)}catch(_){unread.push(index)}
          }
          if(!text.trim()&&!unread.includes(index))unread.push(index);
          plain.push(text);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PDF 页面预览失败');
          const data=new Uint8Array(await blob.arrayBuffer()),picture=await documentPicture(data,'image/png');
          // Store a page before processing the next one; do not retain all rasters in RAM.
          await archiveStore(data,picture.hash);delete picture.originalBytes;
          images.push({...picture,width:canvas.width,height:canvas.height});layout.push({kind:'text',text:'第 '+index+' 页'},{kind:'break'},{kind:'image',index:images.length-1},{kind:'break'});
        }finally{canvas.width=0;canvas.height=0;page.cleanup()}
        await archiveYield();
      }
      if(unread.length)warnings.push('第 '+unread.slice(0,20).join('、')+(unread.length>20?' 等 '+unread.length+' 页':' 页')+'尚未获得可靠文字；原件和页面仍保留。手机 App 可使用本机 OCR，识别文字请对照页面核对。');
      return {text:plain.join('\n\n'),images,layout,warnings};
    }catch(error){throw Error(error.name==='PasswordException'?'加密 PDF 以原件归档；解锁后可重新提取文字':error.message||'PDF 读取失败')}finally{documentImportProgress='';await pdf?.destroy()}
  }
  async function documentOriginalOnly(source,fileName,reason){
    const saved=await archiveStoreSource(source),format=String(fileName).split('.').pop().toLowerCase();
    return {title:titleFromFile(fileName,''),text:'',images:[],archive:{version:2,format:DOCUMENT_FORMATS.includes(format)?format:'bin',fileName,fileBytes:saved.bytes,originalHash:saved.hash,textHash:await archiveSha(new Uint8Array()),images:[],layout:[],projectionStatus:'original-only',warnings:[String(reason).slice(0,480)+'。已完整归档原文件，可核对哈希并原样导出；正文和内嵌图片尚未展开。']}};
  }
  function documentTextParts(text){
    const parts=[];for(let offset=0;offset<text.length;){let end=Math.min(text.length,offset+50000);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;parts.push(text.slice(offset,end));offset=end}return parts.length?parts:[''];
  }
  async function parseArchiveDocument(bytes,fileName){
    const format=String(fileName).split('.').pop().toLowerCase();
    if(!DOCUMENT_FORMATS.includes(format))throw Error(format==='hdoc'?'hdoc 仍未可靠解码，请保留原件':'此文档格式尚不支持，请保留原件');
    let parsed;
    if(format==='html'||format==='htm')parsed=await parseArchiveHtml(bytes,fileName);
    else if(format==='docx')parsed=await documentDocx(bytes);
    else if(format==='pdf')parsed=await documentPdf(bytes);
    else if(['png','jpg','jpeg','webp'].includes(format))parsed={text:'',images:[await documentPicture(bytes,documentMime(fileName))],layout:[{kind:'image',index:0}]};
    else{const text=documentText(bytes);parsed={text,images:[],layout:[{kind:'text',text}]}}
    if((!parsed.text.trim()&&!parsed.images.length)||parsed.layout.length>10000||parsed.images.length>500||format!=='pdf'&&parsed.images.reduce((sum,picture)=>sum+picture.bytes,0)>DOCUMENT_IMAGE_BUDGET)throw Error('内容为空或超出文档导入范围，未压缩、裁剪或导入');
    return {...parsed,title:parsed.title||titleFromFile(fileName,parsed.text),fileName,format,warnings:parsed.warnings||[],fileBytes:bytes.length,originalHash:await archiveSha(bytes),textHash:await archiveSha(new TextEncoder().encode(parsed.text))};
  }
  async function archiveDocumentProjection(parsed,bytes){
    await archiveStore(bytes,parsed.originalHash);for(const image of parsed.images){if(image.originalBytes){await archiveStore(image.originalBytes,image.hash);delete image.originalBytes}}
    return {version:2,originalHash:parsed.originalHash,fileName:parsed.fileName,fileBytes:parsed.fileBytes,textHash:parsed.textHash,images:parsed.images,layout:parsed.layout,format:parsed.format,warnings:parsed.warnings||[]};
  }
  const settingsBeforeDocumentImport=renderSettings;
  renderSettings=function(){let html=settingsBeforeDocumentImport().replace(/accept="\.txt,[^"]*"/g,'accept="'+NOTE_IMPORT_ACCEPT+'"');if(notes.some(note=>note.archive?.version===2))html=html.replace('请保留华为导出的全部 HTML，或在每条笔记中导出原始 HTML；','请保留全部源文档，或在每条笔记中导出原文件；');return html};
  root.addEventListener('click',event=>{if(noteImportBusy&&['back','nav'].includes(event.target.closest('[data-action]')?.dataset.action)){noteImportGeneration++;noteImportBusy=false;noteImportDraft=[]}},true);
