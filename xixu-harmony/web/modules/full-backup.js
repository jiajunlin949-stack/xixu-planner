  const COMPLETE_BACKUP_MAX=2*1024*1024*1024-1,COMPLETE_WEB_MAX=64*1024*1024;
  const completeBackupPending=new Map();let completeBackupBusy=false,completeBackupCandidate=null;
  window.XixuReceiveBackup=(id,ok,body)=>{const pending=completeBackupPending.get(id);if(!pending)return;completeBackupPending.delete(id);clearTimeout(pending.timer);ok?pending.resolve(body):pending.reject(Error(body||'备份未完成'))};
  function completeNativeCall(method,...args){return new Promise((resolve,reject)=>{const id='backup_'+uid().replace(/[^A-Za-z0-9_-]/g,''),timer=setTimeout(()=>{completeBackupPending.delete(id);reject(Error('文件操作超时，原资料保留'))},600000);completeBackupPending.set(id,{resolve,reject,timer});try{if(!window.XixuBackup?.[method]?.(id,...args))throw Error('备份文件接口尚未就绪')}catch(error){clearTimeout(timer);completeBackupPending.delete(id);reject(error)}})}
  function completeArchiveManifest(data){
    const assets=new Map(),records=[...data.notes];
    for(const change of data.agentPreferences?.intelligence?.journal||[])for(const delta of change.deltas||[])if(delta.collection==='notes'){if(delta.before)records.push(delta.before);if(delta.after)records.push(delta.after)}
    const add=(hash,bytes)=>{if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isInteger(bytes)||bytes<1||bytes>ARCHIVE_FILE_LIMIT)throw Error('归档原件清单无效');if(assets.has(hash)&&assets.get(hash)!==bytes)throw Error('同一原件的大小记录不一致');assets.set(hash,bytes)};
    for(const note of records)if(note.archive){add(note.archive.originalHash,note.archive.fileBytes);for(const image of note.archive.images||[])add(image.hash,image.bytes)}
    return [...assets].map(([hash,bytes])=>({hash,bytes}));
  }
  async function completeBackupExport(){
    if(completeBackupBusy){notify('文件处理中，请稍候');return}completeBackupBusy=true;const native=Boolean(window.XixuBackup),parts=[];let position=0;
    try{
      const data=assistantClone(snapshot()),planner=new TextEncoder().encode(JSON.stringify(data)),assets=completeArchiveManifest(data),manifest={format:'xixu-complete-backup',version:1,createdAt:new Date().toISOString(),plannerHash:await archiveSha(planner),plannerBytes:planner.length,assets,includesConnectionCredentials:false};
      if(planner.length>40*1024*1024||assets.length>20000||assets.reduce((sum,item)=>sum+item.bytes,planner.length)>COMPLETE_BACKUP_MAX-8*1024*1024)throw Error('完整备份超过本次容量，未截断导出');
      if(native&&!window.XixuBackup.beginWrite())throw Error('无法建立本机备份文件');
      const write=async bytes=>{if(position+bytes.length>(native?COMPLETE_BACKUP_MAX:COMPLETE_WEB_MAX))throw Error(native?'备份超出容量':'网页预览支持 64 MiB 完整备份；更大资料请在手机 App 导出');for(let offset=0;offset<bytes.length;offset+=131072){const part=bytes.subarray(offset,offset+131072);if(native){if(!window.XixuBackup.writeChunk(archiveBase64(part)))throw Error('备份文件写入不完整')}else parts.push(part.slice());position+=part.length;await archiveYield()}};
      const central=[];
      const entry=async(name,bytes)=>{
        const encoded=new TextEncoder().encode(name),crc=await documentCrc(bytes),offset=position,header=new Uint8Array(30+encoded.length),view=new DataView(header.buffer);view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint16(12,0x21,true);view.setUint32(14,crc,true);view.setUint32(18,bytes.length,true);view.setUint32(22,bytes.length,true);view.setUint16(26,encoded.length,true);header.set(encoded,30);await write(header);await write(bytes);central.push({name:encoded,crc,bytes:bytes.length,offset});
      };
      await entry('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));await entry('planner.json',planner);
      for(const asset of assets){const value=await archiveRead(asset.hash);const bytes=value instanceof Uint8Array?value:new Uint8Array(value);if(bytes.length!==asset.bytes||await archiveSha(bytes)!==asset.hash)throw Error('有原件缺失或校验失败，未输出不完整备份');await entry('assets/'+asset.hash,bytes)}
      const directoryOffset=position;
      for(const item of central){const header=new Uint8Array(46+item.name.length),view=new DataView(header.buffer);view.setUint32(0,0x02014b50,true);view.setUint16(4,20,true);view.setUint16(6,20,true);view.setUint16(8,0x800,true);view.setUint16(14,0x21,true);view.setUint32(16,item.crc,true);view.setUint32(20,item.bytes,true);view.setUint32(24,item.bytes,true);view.setUint16(28,item.name.length,true);view.setUint32(42,item.offset,true);header.set(item.name,46);await write(header)}
      const directoryBytes=position-directoryOffset,end=new Uint8Array(22),endView=new DataView(end.buffer);endView.setUint32(0,0x06054b50,true);endView.setUint16(8,central.length,true);endView.setUint16(10,central.length,true);endView.setUint32(12,directoryBytes,true);endView.setUint32(16,directoryOffset,true);await write(end);
      if(native)notify(await completeNativeCall('save',position));
      else{const blob=new Blob(parts,{type:'application/zip'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='xixu-complete-'+DEMO_DAY+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);notify('完整备份已交给浏览器下载，请确认文件已保存')}
    }catch(error){notify(error.message||'完整备份未完成，原资料仍保留')}
    finally{window.XixuBackup?.close?.();completeBackupBusy=false}
  }
  const completeCanonical=assistantCanonical;
  async function completeBackupRead(reader,size){
    if(size<22||size>COMPLETE_BACKUP_MAX)throw Error('备份大小不受支持');
    const tailSize=Math.min(65557,size),tail=await reader(size-tailSize,tailSize),tailView=new DataView(tail.buffer,tail.byteOffset,tail.byteLength);let eocd=-1;
    for(let index=tail.length-22;index>=0;index--)if(tailView.getUint32(index,true)===0x06054b50&&index+22+tailView.getUint16(index+20,true)===tail.length){eocd=index;break}
    if(eocd<0||tailView.getUint16(eocd+4,true)||tailView.getUint16(eocd+6,true))throw Error('不是汐序的完整备份，或文件已损坏');
    const count=tailView.getUint16(eocd+10,true),directoryBytes=tailView.getUint32(eocd+12,true),directoryOffset=tailView.getUint32(eocd+16,true);
    if(count<2||count>20002||tailView.getUint16(eocd+8,true)!==count||directoryBytes>4*1024*1024||directoryOffset+directoryBytes!==size-tailSize+eocd)throw Error('备份目录不完整或使用了不支持的 ZIP64');
    const directory=await reader(directoryOffset,directoryBytes),view=new DataView(directory.buffer,directory.byteOffset,directory.byteLength),entries=new Map(),decoder=new TextDecoder('utf-8',{fatal:true});let cursor=0;
    for(let index=0;index<count;index++){
      if(cursor+46>directory.length||view.getUint32(cursor,true)!==0x02014b50)throw Error('备份目录损坏');
      const flags=view.getUint16(cursor+8,true),method=view.getUint16(cursor+10,true),packed=view.getUint32(cursor+20,true),bytes=view.getUint32(cursor+24,true),length=view.getUint16(cursor+28,true),extra=view.getUint16(cursor+30,true),comment=view.getUint16(cursor+32,true),offset=view.getUint32(cursor+42,true),crc=view.getUint32(cursor+16,true),end=cursor+46+length+extra+comment;
      if(end>directory.length||flags&~0x800||method!==0||packed!==bytes||view.getUint16(cursor+34,true)||offset>=directoryOffset)throw Error('只支持汐序导出的未加密完整备份');
      const name=decoder.decode(directory.subarray(cursor+46,cursor+46+length));
      if(!/^(?:manifest\.json|planner\.json|assets\/[a-f0-9]{64})$/.test(name)||entries.has(name)||bytes>(name==='planner.json'?40*1024*1024:name==='manifest.json'?4*1024*1024:ARCHIVE_FILE_LIMIT))throw Error('备份包含未知、重复或超限的文件');
      entries.set(name,{name,bytes,offset,crc});cursor=end;
    }
    if(cursor!==directory.length)throw Error('备份目录尾部不一致');
    const ranges=[];
    const read=async name=>{
      const item=entries.get(name);if(!item)throw Error('备份缺少 '+name);
      const header=await reader(item.offset,30),local=new DataView(header.buffer,header.byteOffset,30),nameBytes=local.getUint16(26,true),extra=local.getUint16(28,true),start=item.offset+30+nameBytes+extra;
      if(local.getUint32(0,true)!==0x04034b50||local.getUint16(6,true)&~0x800||local.getUint16(8,true)!==0||local.getUint32(14,true)!==item.crc||local.getUint32(18,true)!==item.bytes||local.getUint32(22,true)!==item.bytes||start+item.bytes>directoryOffset||decoder.decode(await reader(item.offset+30,nameBytes))!==name)throw Error('备份文件头与目录不一致');
      if(ranges.some(range=>item.offset<range.end&&start+item.bytes>range.start))throw Error('备份条目范围重叠');ranges.push({start:item.offset,end:start+item.bytes});
      const bytes=await reader(start,item.bytes);if(await documentCrc(bytes)!==item.crc)throw Error('备份内容校验失败');return bytes;
    };
    const manifest=JSON.parse(decoder.decode(await read('manifest.json')));
    if(manifest.format!=='xixu-complete-backup'||manifest.version!==1||!Array.isArray(manifest.assets)||manifest.assets.length!==entries.size-2||!/^[a-f0-9]{64}$/.test(manifest.plannerHash))throw Error('完整备份清单无效');
    const planner=await read('planner.json');if(planner.length!==manifest.plannerBytes||await archiveSha(planner)!==manifest.plannerHash)throw Error('备忘录和日程快照校验失败');
    const original=JSON.parse(decoder.decode(planner)),data=checkData(original,false);
    if(JSON.stringify(completeCanonical(original))!==JSON.stringify(completeCanonical(data)))throw Error('这个备份需要数据转换。为避免改变原内容，本次没有覆盖；请保留文件。');
    const expected=completeArchiveManifest(data),expectedMap=new Map(expected.map(item=>[item.hash,item.bytes])),seen=new Set();
    if(expected.length!==manifest.assets.length)throw Error('原件清单与日程数据不一致');
    for(const asset of manifest.assets){if(seen.has(asset.hash)||expectedMap.get(asset.hash)!==asset.bytes)throw Error('原件清单不一致');seen.add(asset.hash);const bytes=await read('assets/'+asset.hash);if(bytes.length!==asset.bytes||await archiveSha(bytes)!==asset.hash)throw Error('原始图片或文档校验失败');await archiveStore(bytes,asset.hash);await archiveYield()}
    return {data,manifest};
  }
  async function completeBackupImport(file=null){
    if(completeBackupBusy||agentPending||noteImportBusy||ocrPending){notify('请先结束当前处理，再恢复备份');return}completeBackupBusy=true;completeBackupCandidate=null;const base=JSON.stringify(snapshot());
    try{
      let size,reader;
      if(window.XixuBackup){const info=JSON.parse(await completeNativeCall('choose'));size=info.size;reader=async(offset,length)=>{if(!length)return new Uint8Array();const result=new Uint8Array(length);for(let position=0;position<length;position+=131072){const count=Math.min(131072,length-position),bytes=archiveUnbase64(window.XixuBackup.readRange(offset+position,count));if(bytes.length!==count)throw Error('备份文件读取不完整');result.set(bytes,position);await archiveYield()}return result}}
      else{if(!file)throw Error('请选择完整备份 ZIP');size=file.size;if(size>COMPLETE_WEB_MAX)throw Error('网页预览恢复限 64 MiB，请使用手机 App');reader=async(offset,length)=>new Uint8Array(await file.slice(offset,offset+length).arrayBuffer())}
      const candidate=await completeBackupRead(reader,size);completeBackupCandidate={...candidate,base};
      assistantShowSheet('核对完整恢复','<p>文件已核对文字、原件和图片校验值。确认后将替换当前这台设备的日程数据；密钥、电脑配对信息不会导入。</p><ul><li>'+candidate.data.notes.length+' 条备忘录</li><li>'+candidate.data.tasks.length+' 个事项</li><li>'+candidate.data.lessons.length+' 项排课</li><li>'+candidate.data.scratchEntries.length+' 条碎片</li><li>'+candidate.manifest.assets.length+' 份独立原件或图片</li></ul><p>对话、时间信箱、变更记录和来源时间也在该快照内。建议先导出当前完整备份。</p><button class="tide-primary tide-full" data-action="complete-backup-commit">确认替换本机数据</button>','backup');
    }catch(error){notify(error.message||'完整恢复未完成，当前资料未覆盖')}
    finally{window.XixuBackup?.close?.();completeBackupBusy=false}
  }
  function completeBackupCommit(){
    const candidate=completeBackupCandidate;if(!candidate)throw Error('恢复预览已失效');if(JSON.stringify(snapshot())!==candidate.base)throw Error('预览后本机资料发生了变化，请重新核对备份');
    const data=candidate.data,raw=JSON.stringify(data);storageWrite(raw);assistantMiningGeneration++;assistantMiningQueue.clear();assistantPlan=null; // Atomic native store replacement happens before in-memory publication.
    courses.splice(0,courses.length,...data.courses);lessons.splice(0,lessons.length,...data.lessons);tasks=data.tasks;notes=data.notes;scratchEntries=data.scratchEntries;agentHistory=data.agentHistory;agentPreferences=data.agentPreferences;ocrCorrectionRules=data.ocrCorrectionRules;scheduleSettings=data.scheduleSettings;TERM_MONDAY=data.termStart;lastSaved=raw;storageBlocked=false;saveError.hidden=true;agentConversationResults.clear();agentConversationScroll.clear();agentVisibleMessages.clear();agentDraft=null;agentInputDraft=String(agentPreferences.conversationDrafts?.[activeConversationId()]||'');assistantSavedSources=new Map(assistantSourceRecords().map(item=>[item.id,{at:item.at,text:item.text}]));assistantSavedDone=new Map(tasks.map(item=>[item.id,Boolean(item.done)]));completeBackupCandidate=null;assistantCloseSheet();syncReminders();render(false);notify('完整备份已恢复，来源时间保留');
  }
  const settingsBeforeCompleteBackup=renderSettings;
  renderSettings=function(){return settingsBeforeCompleteBackup()+'<div class="tide-section"><h2>完整数据备份</h2></div><div class="xixu-setting-actions"><button data-action="complete-backup-export">'+icon('archive')+'<span>导出完整备份（含图片与原件）</span>'+icon('chevron-right')+'</button><button data-action="complete-backup-import">'+icon('archive-restore')+'<span>恢复完整备份</span>'+icon('chevron-right')+'</button></div><p class="tide-note">旧 JSON 导出不含独立原件；完整备份使用 ZIP，包含文字、图片、源文件和来源时间。备份含私人资料，请自行妥善保存。</p><input type="file" id="xixu-complete-backup-file" accept=".zip,application/zip" hidden>'};
  root.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action==='complete-backup-export')completeBackupExport();else if(action==='complete-backup-import'){if(window.XixuBackup)completeBackupImport();else root.querySelector('#xixu-complete-backup-file')?.click()}else if(action==='complete-backup-commit'){try{completeBackupCommit()}catch(error){notify(error.message||'未恢复，原数据保留')}}},true);
  root.addEventListener('change',event=>{if(event.target.id==='xixu-complete-backup-file'&&event.target.files?.[0])completeBackupImport(event.target.files[0])});
