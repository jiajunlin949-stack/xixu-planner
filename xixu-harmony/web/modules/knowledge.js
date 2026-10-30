  const knowledgePending=new Map();
  let knowledgeSequence=0,knowledgeMessage='';
  function knowledgeStatus(){try{return JSON.parse(window.XixuKnowledge?.status?.()||'{}')}catch(_){return {paired:false}}}
  function knowledgeMode(){try{const saved=localStorage.getItem('xixu-knowledge-mode');if(['local','extended'].includes(saved))return saved}catch(_){}return knowledgeStatus().paired?'extended':'local'}
  function knowledgeEnabled(){return knowledgeMode()==='extended'&&knowledgeStatus().paired}
  function knowledgeCall(operation,payload={},context=null){
    return new Promise((resolve,reject)=>{
      const id='knowledge_'+Date.now()+'_'+(++knowledgeSequence);
      const timeout=['chat','chat-confirm'].includes(operation)?135000:45000;
      const timer=setTimeout(()=>cancelKnowledgeRequest(id,'电脑连接超时，请检查电脑是否仍在运行。'),timeout);
      knowledgePending.set(id,{resolve,reject,timer});
      if(context)context.knowledgeId=id;
      try{
        if(!window.XixuKnowledge?.call?.(id,operation,JSON.stringify(payload)))throw Error('电脑知识库接口尚未就绪，请更新汐序。');
      }catch(error){clearTimeout(timer);knowledgePending.delete(id);reject(error)}
    });
  }
  function cancelKnowledgeRequest(id,message='已停止'){
    const pending=knowledgePending.get(id);if(!pending)return false;
    clearTimeout(pending.timer);knowledgePending.delete(id);
    try{window.XixuKnowledge?.cancel?.(id)}catch(_){}
    pending.reject(Error(message));
    return true;
  }
  window.XixuReceiveKnowledge=(id,ok,body)=>{
    const request=knowledgePending.get(id);if(!request)return;
    clearTimeout(request.timer);knowledgePending.delete(id);
    if(!ok){request.reject(Error(String(body||'电脑未连接')));return}
    try{request.resolve(JSON.parse(body))}catch(_){request.reject(Error('电脑返回了无法识别的数据。'))}
  };
  function knowledgeReferences(sources){
    return (sources||[]).slice(0,6).map(source=>({
      id:[source.document_id,source.version,source.start,source.end].join(':'),
      documentId:'computer:'+source.document_id,chunkId:'computer:'+source.id,title:String(source.title||'电脑资料'),
      text:String(source.text||'').slice(0,900),recordType:'external',kind:'电脑资料',action:'knowledge-source',
      chunkStart:source.start,chunkEnd:source.end,sourceExcerpt:true,score:source.score||0,reasons:['电脑知识库检索']
    }));
  }
  function knowledgeSettingsHtml(){
    const status=knowledgeStatus();
    const local=knowledgeMode()==='local';
    return '<div class="tide-section"><h2>知识库模式</h2></div><div class="tide-surface"><div class="tide-detail-actions"><button class="'+(local?'tide-primary':'tide-secondary')+'" data-action="knowledge-mode-local" aria-pressed="'+local+'">本机备忘录</button><button class="'+(!local?'tide-primary':'tide-secondary')+'" data-action="knowledge-mode-extended" aria-pressed="'+(!local)+'">电脑扩展</button></div><p>'+ (local?'记录、导入和检索都可在手机本机完成，电脑关机也能使用。':'把个人电脑里已导入的聊天和工作资料一起用于查询，需要电脑在线。')+'</p>'+(knowledgeMessage?'<p role="status">'+esc(knowledgeMessage)+'</p>':'')+(local?'':'<p>'+esc(status.paired?'已配对：'+status.server:'尚未配对电脑')+'</p><form id="xixu-knowledge-pair" class="tide-form"><label class="tide-field">电脑连接信息<textarea name="bundle" required maxlength="12000" rows="4" placeholder="粘贴电脑生成的完整连接信息"></textarea></label><button class="tide-primary tide-full">配对电脑</button></form>'+(status.paired?'<button class="tide-secondary tide-full" data-action="knowledge-test">测试电脑连接</button><button class="tide-secondary tide-full" data-action="knowledge-sync-preview">同步备忘录与原件</button><button class="tide-delete tide-full" data-action="knowledge-disconnect">断开电脑连接</button>':'')+'<p>查询会发送本次选中的手机片段；完整笔记与原件只在你确认同步后发送到配对电脑。电脑配置回答模型后，相关片段会按设置发送给该模型。</p>')+'</div>'+(typeof knowledgeSyncHtml==='function'?knowledgeSyncHtml():'');
  }
  const settingsBeforeKnowledge=renderSettings;
  renderSettings=function(){return settingsBeforeKnowledge()+knowledgeSettingsHtml()};
  root.addEventListener('submit',async event=>{
    if(event.target.id!=='xixu-knowledge-pair')return;
    event.preventDefault();const raw=String(new FormData(event.target).get('bundle')||'');
    const button=event.target.querySelector('button');button.disabled=true;
    try{const bundle=JSON.parse(raw);await knowledgeCall('pair',bundle);knowledgeMessage='配对成功，设备凭据已存入手机安全存储。';render();notify('电脑知识库已配对')}
    catch(error){knowledgeMessage=error.message;notify(error.message);button.disabled=false}
  });
  root.addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]'),action=button?.dataset.action;
    if(action==='knowledge-mode-local'||action==='knowledge-mode-extended'){
      if(typeof cancelKnowledgeSync==='function'&&cancelKnowledgeSync()===false)return;
      try{localStorage.setItem('xixu-knowledge-mode',action==='knowledge-mode-local'?'local':'extended');knowledgeMessage='';render()}catch(_){notify('模式未能保存，请检查本机存储')}
    }else if(action==='knowledge-test'){
      try{const result=await knowledgeCall('health');knowledgeMessage='电脑可访问，已有 '+result.documents+' 份资料。'+(result.answer_model_configured?'电脑已保存模型密钥，是否可用以电脑连接测试为准。':'电脑尚未配置回答模型。')}
      catch(error){knowledgeMessage=error.message}render();
    }else if(action==='knowledge-disconnect'){
      window.XixuKnowledge?.disconnect?.();knowledgeMessage='已移除本机配对信息；电脑端也可撤销该设备。';render();
    }else if(action==='knowledge-source'){
      const [document_id,version,start,end]=String(button.dataset.id||'').split(':');
      try{const result=await knowledgeCall('excerpt',{document_id,version,start:Number(start),end:Number(end)});const dialog=document.createElement('dialog'),title=document.createElement('h3'),text=document.createElement('pre'),close=document.createElement('button');title.textContent=result.title||'电脑原文';text.textContent=result.text||'';text.style.whiteSpace='pre-wrap';close.textContent='关闭';close.onclick=()=>{dialog.close();dialog.remove()};dialog.append(title,text,close);root.append(dialog);dialog.showModal()}
      catch(error){notify(error.message)}
    }
  });
