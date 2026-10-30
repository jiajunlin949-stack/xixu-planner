  // A checkpoint is a complete local business snapshot, with immutable asset
  // references. It deliberately excludes its own index to avoid recursive copies.
  let checkpointBusy=false,checkpointMessage='';
  function checkpointState(){const state=assistantState();if(!state.checkpoints)state.checkpoints={version:1,items:[]};return state.checkpoints}
  function checkpointCounts(data){return ['courses','lessons','tasks','notes','scratchEntries','agentHistory'].map(key=>({key,count:data[key]?.length||0}))}
  function checkpointData(){const data=assistantClone(snapshot());if(data.agentPreferences?.intelligence)delete data.agentPreferences.intelligence.checkpoints;return data}
  async function checkpointCapture(label='手动快照',daily=false){
    if(checkpointBusy||storageBlocked||completeBackupBusy||noteImportBusy)return null;
    const index=checkpointState(),owner=agentPreferences,day=localDay();if(daily&&index.items.some(item=>item.day===day&&item.daily))return null;
    checkpointBusy=true;
    try{
      const data=checkpointData(),bytes=new TextEncoder().encode(JSON.stringify(data)),hash=await archiveSha(bytes),assets=completeArchiveManifest(data),at=new Date().toISOString();
      await archiveStore(bytes,hash);if(agentPreferences!==owner)return null;
      const item={id:uid(),day,at,label,daily,hash,bytes:bytes.length,assets,counts:checkpointCounts(data)};index.items.push(item);
      if(persist()===false){index.items.pop();throw Error('历史索引未保存，当前资料保留')}
      checkpointMessage='';return item;
    }finally{checkpointBusy=false}
  }
  async function checkpointRead(item){
    if(item.bytes>COMPLETE_PLANNER_BYTES)throw Error('快照元数据超出当前资料存储范围');
    const bytes=await archiveRead(item.hash);if(bytes.length!==item.bytes)throw Error('历史快照大小不符');
    const original=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),data=checkData(original,false);
    if(assistantStable(original)!==assistantStable(data))throw Error('这个快照需要格式迁移，未自动覆盖');
    const assets=completeArchiveManifest(data),expected=new Map((item.assets||[]).map(asset=>[asset.hash,asset.bytes]));
    if(expected.size!==assets.length||assets.some(asset=>expected.get(asset.hash)!==asset.bytes))throw Error('历史快照与原件清单不一致');
    return data;
  }
  async function checkpointVerifyIndex(data){
    for(const item of data.agentPreferences?.intelligence?.checkpoints?.items||[])await checkpointRead(item);
  }
  function checkpointList(day=''){
    const items=checkpointState().items.filter(item=>!day||item.day===day).slice().reverse();
    assistantShowSheet('历史快照',(checkpointMessage?'<p role="status">'+esc(checkpointMessage)+'</p>':'')+'<p>每天首次使用时保留一份本机快照，也可以手动保存。选择实际存在的日期和时刻恢复课表、事项、备忘录、碎片、对话及助手记录。原件不会因恢复而删除。</p><form id="xixu-checkpoint-filter" class="tide-form"><label class="tide-field">查看日期<input type="date" name="day" value="'+esc(day)+'"></label><button class="tide-secondary">按日期查找</button></form><button class="tide-secondary" data-action="checkpoint-create">保存当前快照</button>'+items.map(item=>'<article class="xixu-journal-row"><strong>'+esc(item.label)+'</strong><time>'+esc(new Date(item.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+'</time><p>'+item.counts.map(value=>esc(({courses:'课程',lessons:'排课',tasks:'事项',notes:'备忘录',scratchEntries:'碎片',agentHistory:'消息'})[value.key])+' '+value.count).join(' · ')+'</p><button class="tide-secondary" data-action="checkpoint-preview" data-id="'+esc(item.id)+'">核对这一时刻</button></article>').join('')+(items.length?'':'<p>这个日期尚无快照。不能恢复安装此功能前未记录的时刻。</p>'),'checkpoints');
  }
  async function checkpointPreview(id){
    if(agentPending||noteImportBusy||completeBackupBusy||checkpointBusy)throw Error('请先结束当前处理');
    const item=checkpointState().items.find(entry=>entry.id===id);if(!item)throw Error('快照已不存在');
    const base=JSON.stringify(snapshot()),data=await checkpointRead(item);
    for(const asset of item.assets){const checked=await archiveWalk(asset.hash);if(checked.bytes!==asset.bytes)throw Error('有历史原件缺失，未恢复')}
    if(JSON.stringify(snapshot())!==base)throw Error('核对期间资料已变化，请重新选择');
    const current=checkpointCounts(snapshot()),target=checkpointCounts(data);completeBackupCandidate={data,base,checkpointId:id};
    assistantShowSheet('核对历史恢复','<p>目标：'+esc(new Date(item.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+'。保存前会再留一份当前快照，方便返回。</p><ul>'+target.map((value,index)=>'<li>'+esc(({courses:'课程',lessons:'排课',tasks:'事项',notes:'备忘录',scratchEntries:'碎片',agentHistory:'对话消息'})[value.key])+'：'+current[index].count+' → '+value.count+'</li>').join('')+'</ul><p>这是完整业务快照恢复，包含当时的助手状态。模型密钥和电脑配对不在快照内。</p><button class="tide-primary tide-full" data-action="checkpoint-restore">确认恢复这个时刻</button>','checkpoint-preview');
  }
  async function checkpointRestore(){
    const candidate=completeBackupCandidate;if(!candidate?.checkpointId||JSON.stringify(snapshot())!==candidate.base)throw Error('恢复预览已失效，请重新核对');
    const unchanged=assistantStable(checkpointData()),before=await checkpointCapture('历史恢复前的快照');if(assistantStable(checkpointData())!==unchanged)throw Error('保留快照期间资料已变化，请重新核对');if(!before)throw Error('未能保留恢复前快照，本次没有替换');
    // Keep the full index, including the snapshot just captured, across restore.
    if(!candidate.data.agentPreferences.intelligence)throw Error('目标快照缺少助手状态');
    candidate.data.agentPreferences.intelligence.checkpoints=assistantClone(checkpointState());candidate.base=JSON.stringify(snapshot());
    completeBackupCommit();notify('已恢复所选历史快照；恢复前状态仍可在历史中查看');
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]'),action=button?.dataset.action;
    if(action==='checkpoint-list')checkpointList();
    else if(action==='checkpoint-create')checkpointCapture().then(item=>{if(item){checkpointList();notify('当前快照已保存')}}).catch(error=>notify(error.message));
    else if(action==='checkpoint-preview')checkpointPreview(button.dataset.id).catch(error=>notify(error.message));
    else if(action==='checkpoint-restore')checkpointRestore().catch(error=>notify(error.message));
  });
  root.addEventListener('submit',event=>{if(event.target.id!=='xixu-checkpoint-filter')return;event.preventDefault();checkpointList(String(new FormData(event.target).get('day')||''))});
  const checkpointTick=()=>{if(!document.hidden)checkpointCapture('每日首次使用快照',true).catch(()=>{checkpointMessage='最近一次每日快照未能保存，请检查可用存储；当前资料仍保留。'})};
  setTimeout(checkpointTick,0);setInterval(checkpointTick,60000);
