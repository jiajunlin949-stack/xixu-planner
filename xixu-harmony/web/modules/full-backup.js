  const COMPLETE_PLANNER_BYTES=40*1024*1024*3; // UTF-8 bound for the existing 40 MiB JSON character store.
  const completeBackupPending=new Map();let completeBackupBusy=false,completeBackupCandidate=null;
  window.XixuReceiveBackup=(id,ok,body)=>{const pending=completeBackupPending.get(id);if(!pending)return;completeBackupPending.delete(id);clearTimeout(pending.timer);ok?pending.resolve(body):pending.reject(Error(body||'备份未完成'))};
  function completeNativeCall(method,...args){return new Promise((resolve,reject)=>{const id='backup_'+uid().replace(/[^A-Za-z0-9_-]/g,''),timer=setTimeout(()=>{completeBackupPending.delete(id);reject(Error('文件操作超时，原资料保留'))},method==='save'?3600000:600000);completeBackupPending.set(id,{resolve,reject,timer});try{if(!window.XixuBackup?.[method]?.(id,...args))throw Error('备份文件接口尚未就绪')}catch(error){clearTimeout(timer);completeBackupPending.delete(id);reject(error)}})}
  function completeArchiveManifest(data){
    const assets=new Map(),records=[...data.notes];
    for(const change of data.agentPreferences?.intelligence?.journal||[])for(const delta of change.deltas||[])if(delta.collection==='notes'){if(delta.before)records.push(delta.before);if(delta.after)records.push(delta.after)}
    const add=(hash,bytes)=>{if(!/^[a-f0-9]{64}$/.test(hash)||!Number.isInteger(bytes)||bytes<1||bytes>ARCHIVE_FILE_LIMIT)throw Error('归档原件清单无效');if(assets.has(hash)&&assets.get(hash)!==bytes)throw Error('同一原件的大小记录不一致');assets.set(hash,bytes)};
    for(const note of records)if(note.archive){add(note.archive.originalHash,note.archive.fileBytes);for(const image of note.archive.images||[])add(image.hash,image.bytes)}
    for(const point of data.agentPreferences?.intelligence?.checkpoints?.items||[]){add(point.hash,point.bytes);for(const asset of point.assets||[])add(asset.hash,asset.bytes)}
    return [...assets].map(([hash,bytes])=>({hash,bytes}));
  }
  async function completeBackupOutput(){
    if(window.XixuBackup){if(!window.XixuBackup.beginWrite())throw Error('无法建立本机备份文件');return {write:async bytes=>{for(let at=0;at<bytes.length;at+=131072){if(!window.XixuBackup.writeChunk(archiveBase64(bytes.subarray(at,at+131072))))throw Error('备份写入不完整');await archiveYield()}},finish:async size=>notify(await completeNativeCall('save',size)),abort:async()=>window.XixuBackup.close()}}
    if(window.showSaveFilePicker){
      const handle=await window.showSaveFilePicker({suggestedName:'xixu-complete-'+DEMO_DAY+'.zip',types:[{description:'汐序完整备份',accept:{'application/zip':['.zip']}}]}),writer=await handle.createWritable();
      return {write:bytes=>writer.write(bytes),finish:async()=>{await writer.close();notify('完整备份已写入所选文件')},abort:()=>writer.abort().catch(()=>{})};
    }
    let directory=null,name='',writer=null,handle=null;const parts=[];
    if(navigator.storage?.getDirectory){directory=await navigator.storage.getDirectory();name='xixu-backup-'+uid()+'.pending';handle=await directory.getFileHandle(name,{create:true});writer=await handle.createWritable()}
    const cleanup=async()=>{if(directory&&name)await directory.removeEntry(name).catch(()=>{})};
    return {write:async bytes=>{if(writer)await writer.write(bytes);else parts.push(bytes.slice());await archiveYield()},finish:async()=>{if(writer)await writer.close();const blob=handle?await handle.getFile():new Blob(parts,{type:'application/zip'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='xixu-complete-'+DEMO_DAY+'.zip';link.click();setTimeout(()=>{URL.revokeObjectURL(url);cleanup()},60000);notify('完整备份已交给浏览器保存，请确认下载完成')},abort:async()=>{if(writer)await writer.abort().catch(()=>{});await cleanup()}};
  }
  async function completeBackupExport(){
    if(completeBackupBusy){notify('文件处理中，请稍候');return}completeBackupBusy=true;let output=null,finished=false;
    try{
      // Request a browser destination while this call still has user activation.
      output=await completeBackupOutput();
      const data=assistantClone(snapshot()),planner=new TextEncoder().encode(JSON.stringify(data)),assets=completeArchiveManifest(data),manifest={format:'xixu-complete-backup',version:1,createdAt:new Date().toISOString(),plannerHash:await archiveSha(planner),plannerBytes:planner.length,assets,includesConnectionCredentials:false};
      const zip=new BackupZipWriter(bytes=>output.write(bytes)),entryBytes=async(name,bytes)=>zip.entry(name,bytes.length,await documentCrc(bytes),write=>write(bytes));
      await entryBytes('manifest.json',new TextEncoder().encode(JSON.stringify(manifest)));await entryBytes('planner.json',planner);
      for(const asset of assets){const checked=await archiveWalk(asset.hash);if(checked.bytes!==asset.bytes)throw Error('原件大小与清单不符');await zip.entry('assets/'+asset.hash,checked.bytes,checked.crc,write=>archiveWalk(asset.hash,write));await archiveYield()}
      const size=await zip.close();await output.finish(size);finished=true;
    }catch(error){notify(error.name==='AbortError'?'已取消备份，原资料保留':error.message||'完整备份未完成，原资料仍保留')}
    finally{if(!finished&&output)await output.abort().catch(()=>{});window.XixuBackup?.close?.();completeBackupBusy=false}
  }
  const completeCanonical=assistantCanonical;
  async function completeBackupRead(reader,size){
    const entries=await backupZipDirectory(reader,size),decoder=new TextDecoder('utf-8',{fatal:true});
    const small=async(name,maximum)=>{
      const entry=entries.get(name);if(!entry||entry.size>maximum)throw Error('备份缺少必要清单，或元数据超出当前工作内存');
      const bytes=new Uint8Array(entry.size);await backupVerifyEntry(entry,async(part,offset)=>bytes.set(part,offset));return bytes;
    };
    const manifest=JSON.parse(decoder.decode(await small('manifest.json',DOCUMENT_WORKING_BYTES)));
    if(manifest.format!=='xixu-complete-backup'||manifest.version!==1||!Array.isArray(manifest.assets)||manifest.assets.length!==entries.size-2||!/^[a-f0-9]{64}$/.test(manifest.plannerHash))throw Error('完整备份清单无效');
    const planner=await small('planner.json',COMPLETE_PLANNER_BYTES);if(planner.length!==manifest.plannerBytes||await archiveSha(planner)!==manifest.plannerHash)throw Error('日程快照校验失败');
    const original=JSON.parse(decoder.decode(planner)),data=checkData(original,false);
    if(JSON.stringify(completeCanonical(original))!==JSON.stringify(completeCanonical(data)))throw Error('备份需要数据转换，本次未覆盖。请保留文件。');
    const expected=completeArchiveManifest(data),expectedMap=new Map(expected.map(item=>[item.hash,item.bytes])),seen=new Set();
    if(expected.length!==manifest.assets.length)throw Error('原件清单与日程数据不一致');
    for(const asset of manifest.assets){
      const entry=entries.get('assets/'+asset.hash);if(seen.has(asset.hash)||expectedMap.get(asset.hash)!==asset.bytes||!entry||entry.size!==asset.bytes)throw Error('原件清单不一致');seen.add(asset.hash);
      const verified=await backupVerifyEntry(entry);if(verified.hash!==asset.hash)throw Error('原件 SHA-256 校验失败');await archiveStoreSource(entry,asset.hash);await archiveYield();
    }
    await checkpointVerifyIndex(data);
    return {data,manifest};
  }
  async function completeBackupImport(file=null){
    if(completeBackupBusy||agentPending||noteImportBusy||ocrPending){notify('请先结束当前处理，再恢复备份');return}completeBackupBusy=true;completeBackupCandidate=null;const base=JSON.stringify(snapshot());
    try{
      let size,reader;
      if(window.XixuBackup){const info=JSON.parse(await completeNativeCall('choose'));size=info.size;reader=async(offset,length)=>{if(!length)return new Uint8Array();const result=new Uint8Array(length);for(let position=0;position<length;position+=131072){const count=Math.min(131072,length-position),bytes=archiveUnbase64(window.XixuBackup.readRange(offset+position,count));if(bytes.length!==count)throw Error('备份文件读取不完整');result.set(bytes,position);await archiveYield()}return result}}
      else{if(!file)throw Error('请选择完整备份 ZIP');size=file.size;reader=async(offset,length)=>new Uint8Array(await file.slice(offset,offset+length).arrayBuffer())}
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
  renderSettings=function(){return settingsBeforeCompleteBackup()+'<div class="tide-section"><h2>完整数据备份</h2></div><div class="xixu-setting-actions"><button data-action="checkpoint-list">'+icon('history')+'<span>按日期查看历史快照</span>'+icon('chevron-right')+'</button><button data-action="complete-backup-export">'+icon('archive')+'<span>导出完整备份（含图片与原件）</span>'+icon('chevron-right')+'</button><button data-action="complete-backup-import">'+icon('archive-restore')+'<span>恢复完整备份</span>'+icon('chevron-right')+'</button></div><p class="tide-note">完整备份支持分块读写与 ZIP64，容量随设备存储与浏览器文件能力变化。旧 JSON 只保留索引；跨设备请使用完整 ZIP，携带图片、源文件和来源时间。备份含私人资料，请自行妥善保存。</p><input type="file" id="xixu-complete-backup-file" accept=".zip,application/zip" hidden>'};
  root.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(action==='complete-backup-export')completeBackupExport();else if(action==='complete-backup-import'){if(window.XixuBackup)completeBackupImport();else root.querySelector('#xixu-complete-backup-file')?.click()}else if(action==='complete-backup-commit'){try{completeBackupCommit()}catch(error){notify(error.message||'未恢复，原数据保留')}}},true);
  root.addEventListener('change',event=>{if(event.target.id==='xixu-complete-backup-file'&&event.target.files?.[0])completeBackupImport(event.target.files[0])});
