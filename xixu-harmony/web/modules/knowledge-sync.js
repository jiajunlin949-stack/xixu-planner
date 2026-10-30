  let knowledgeSyncDraft=null,knowledgeSyncBusy=false,knowledgeSyncCommitting=false,knowledgeSyncMessage='',knowledgeSyncGeneration=0;
  function cancelKnowledgeSync(){if(knowledgeSyncCommitting){notify('正在等待电脑确认提交，请稍等');return false}knowledgeSyncGeneration++;knowledgeSyncBusy=false;knowledgeSyncDraft=null;knowledgeSyncMessage='';return true}
  function knowledgeSyncProgress(text){knowledgeSyncMessage=text;const target=main.querySelector('#xixu-sync-progress');if(target)target.textContent=text}
  function knowledgeSyncHtml(){
    if(knowledgeMode()!=='extended')return '';
    if(knowledgeSyncBusy)return '<p id="xixu-sync-progress" class="tide-note" role="status">'+esc(knowledgeSyncMessage||'正在准备同步…')+'</p>';
    if(!knowledgeSyncDraft)return knowledgeSyncMessage?'<p class="tide-note" role="status">'+esc(knowledgeSyncMessage)+'</p>':'';
    return '<form id="xixu-knowledge-sync-confirm" class="tide-surface"><h3>核对后同步到个人电脑</h3><p>本机 '+knowledgeSyncDraft.count+' 条笔记；电脑当前设备分区 '+knowledgeSyncDraft.remote.notes+' 条。同步包含正文、来源时间、图片及导入原文件，原手机资料保持在本机。</p><label><input name="deletions" type="checkbox">同时移除电脑中本设备已在手机删除的笔记</label><p class="tide-note">默认只新增或更新。聊天资料请在电脑端另行导入。</p><button class="tide-primary" type="submit">确认同步备忘录</button><button class="tide-secondary" type="button" data-action="knowledge-sync-cancel">取消</button></form>';
  }
  root.addEventListener('click',async event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='knowledge-sync-cancel'){cancelKnowledgeSync();render(false);return}
    if(action!=='knowledge-sync-preview'||knowledgeSyncBusy)return;
    if(!knowledgeEnabled()){notify('请先启用电脑扩展并配对');return}
    const generation=++knowledgeSyncGeneration;knowledgeSyncBusy=true;knowledgeSyncDraft=null;knowledgeSyncMessage='正在检查电脑同步能力…';render(false);
    try{
      if(storageBlocked)throw Error('本机数据读取异常，未发起同步');
      const health=await knowledgeCall('health');if(health.notes_sync_version!==1)throw Error('请升级电脑配套服务，当前连接仅支持查询');
      const remote=await knowledgeCall('sync-status');if(generation!==knowledgeSyncGeneration)return;
      knowledgeSyncDraft={count:notes.length,remote};knowledgeSyncMessage='';
    }catch(error){if(generation===knowledgeSyncGeneration)knowledgeSyncMessage=error.message}
    finally{if(generation===knowledgeSyncGeneration){knowledgeSyncBusy=false;render(false)}}
  });
  root.addEventListener('submit',async event=>{
    if(event.target.id!=='xixu-knowledge-sync-confirm')return;event.preventDefault();if(knowledgeSyncBusy||!knowledgeSyncDraft||!knowledgeEnabled())return;
    const allow_deletions=new FormData(event.target).get('deletions')==='on',generation=++knowledgeSyncGeneration,draft=knowledgeSyncDraft;
    let committing=false;knowledgeSyncBusy=true;knowledgeSyncMessage='正在核对本机原件…';render(false);
    const active=()=>{if(generation!==knowledgeSyncGeneration||!knowledgeEnabled())throw Error('同步已取消，尚未提交的暂存不计入电脑笔记')};
    try{
      if(storageBlocked)throw Error('本机数据读取异常，未发起同步');
      if(notes.length!==draft.count)throw Error('本机笔记条数已变化，请重新核对');
      const copy=JSON.parse(JSON.stringify(notes));checkData(snapshot(),false);
      const {session}=await knowledgeCall('sync-begin',{count:copy.length,revision:draft.remote.revision,allow_deletions});active();
      const sentAssets=new Set();
      for(let index=0;index<copy.length;index++){
        active();const note=copy[index],assets=new Map();
        if(note.archive){assets.set(note.archive.originalHash,{size:note.archive.fileBytes,walk:consume=>archiveWalk(note.archive.originalHash,consume)});for(const image of note.archive.images)assets.set(image.hash,{size:image.bytes,walk:consume=>archiveWalk(image.hash,consume)})}
        for(const image of note.images||[]){const match=/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image.dataUrl||'');if(!match)throw Error('有图片编码无法核对，未提交快照');const bytes=archiveUnbase64(match[1]),hash=await archiveSha(bytes);assets.set(hash,{size:bytes.length,walk:consume=>archiveDigestSource(archiveBytesSource(bytes),consume)});image.hash=hash;image.bytes=bytes.length;delete image.dataUrl}
        for(const [hash,asset] of assets){
          active();if(sentAssets.has(hash))continue;const checked=await asset.walk();if(checked.hash!==hash||checked.bytes!==asset.size)throw Error('原件哈希或大小不一致，未提交快照');
          await asset.walk(async(bytes,position)=>{for(let at=0;at<bytes.length;at+=128*1024){active();knowledgeSyncProgress('同步第 '+(index+1)+' / '+copy.length+' 条笔记的原件…');await knowledgeCall('sync-asset',{session,hash,offset:position+at,total:asset.size,data:archiveBase64(bytes.subarray(at,at+128*1024))});await archiveYield()}});
          sentAssets.add(hash);
        }
        const bytes=new TextEncoder().encode(JSON.stringify(note)),parts=Math.max(1,Math.ceil(bytes.length/(128*1024)));
        for(let part=0;part<parts;part++){active();await knowledgeCall('sync-note',{session,note_id:note.id,part,parts,data:archiveBase64(bytes.subarray(part*128*1024,(part+1)*128*1024))});await archiveYield()}
        knowledgeSyncProgress('已暂存 '+(index+1)+' / '+copy.length+' 条，尚未提交…');
      }
      active();committing=true;knowledgeSyncCommitting=true;knowledgeSyncMessage='正在提交并等待电脑确认…';render(false);
      const result=await knowledgeCall('sync-commit',{session});if(generation!==knowledgeSyncGeneration)return;
      knowledgeSyncDraft=null;knowledgeSyncMessage='同步完成：'+result.notes+' 条笔记，更新 '+result.changed+' 条，移除 '+result.removed+' 条。原件已核对；电脑会继续整理检索索引。';
    }catch(error){if(generation===knowledgeSyncGeneration){knowledgeSyncDraft=null;knowledgeSyncMessage=(committing?'电脑提交结果尚未确认，请核对电脑状态。':'同步未提交，手机资料仍保留。')+error.message}}
    finally{knowledgeSyncCommitting=false;if(generation===knowledgeSyncGeneration){knowledgeSyncBusy=false;render(false)}}
  });
