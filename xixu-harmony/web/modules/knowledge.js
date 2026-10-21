  const knowledgePending=new Map();
  let knowledgeSequence=0,knowledgeMessage='';
  function knowledgeStatus(){try{return JSON.parse(window.XixuKnowledge?.status?.()||'{}')}catch(_){return {paired:false}}}
  function knowledgeCall(operation,payload={}){
    return new Promise((resolve,reject)=>{
      const id='knowledge_'+Date.now()+'_'+(++knowledgeSequence);
      const timer=setTimeout(()=>{knowledgePending.delete(id);reject(Error('电脑连接超时，请检查电脑是否仍在运行。'))},operation==='chat'?135000:45000);
      knowledgePending.set(id,{resolve,reject,timer});
      try{if(!window.XixuKnowledge?.call?.(id,operation,JSON.stringify(payload)))throw Error('电脑知识库接口尚未就绪，请更新汐序。')}
      catch(error){clearTimeout(timer);knowledgePending.delete(id);reject(error)}
    });
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
  async function knowledgeAnswer(query,refs,conversationId){
    if(!knowledgeStatus().paired)return null;
    let room=4800;const local=[];
    for(const ref of refs.slice(0,2)){const text='汐序本机资料：'+ref.title+'\n'+String(ref.text||'');const clipped=text.slice(0,Math.min(1200,room));if(clipped){local.push(clipped);room-=clipped.length}}
    let result;
    try{result=await knowledgeCall('chat',{query,conversation_id:'xixu-'+conversationId,local_context:local})}
    catch(error){
      if(!String(error.message).includes('模型尚未就绪'))throw error;
      const found=await knowledgeCall('search',{query,limit:6});
      result={answer:found.results?.length?'从电脑找到了 '+found.results.length+' 个资料片段。电脑模型尚未就绪，可以展开来源查看原文。':'电脑知识库暂未找到相关片段。',answer_generated:false,sources:found.results||[]};
    }
    const remote=knowledgeReferences(result.sources);
    return {answer:String(result.answer||'电脑没有返回回答。')+(result.answer_generated?'':'\n（本次未调用回答模型）'),
      refs:[...remote,...refs.slice(0,Math.max(0,6-remote.length))],action:{type:'none'},source:'computer'};
  }
  function knowledgeSettingsHtml(){
    const status=knowledgeStatus();
    return '<div class="tide-section"><h2>电脑知识库</h2></div><div class="tide-surface"><p>'+esc(status.paired?'已配对：'+status.server:'尚未配对电脑')+'</p><p>在电脑知识库中生成连接信息，复制到这里。电脑与手机需要在可互通的网络中。</p>'+(knowledgeMessage?'<p role="status">'+esc(knowledgeMessage)+'</p>':'')+'<form id="xixu-knowledge-pair" class="tide-form"><label class="tide-field">电脑连接信息<textarea name="bundle" required maxlength="12000" rows="4" placeholder="粘贴电脑生成的完整连接信息"></textarea></label><button class="tide-primary tide-full">配对电脑</button></form>'+(status.paired?'<button class="tide-secondary tide-full" data-action="knowledge-test">测试电脑连接</button><button class="tide-delete tide-full" data-action="knowledge-disconnect">断开电脑连接</button>':'')+'<p>配对后，问答会把本次选中的手机资料发送到电脑；电脑配置模型后，会把相关片段发送给该模型。电脑关机时会提示连接失败，再尝试手机原有助手。</p></div>';
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
    if(action==='knowledge-test'){
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
