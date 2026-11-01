  // Workbench presentation and user commands; execution stays in the runtime.
  let assistantWorkViewAll=false,assistantWorkPageIndex=0;
  const assistantRuntimeLabels={queued:'等待处理',running:'正在处理',awaiting_send:'等待发送核对',awaiting_answer:'需要你补充',review:'等待确认',waiting:'等待新线索',completed:'已完成',failed:'处理失败',interrupted:'处理中断',blocked:'需要你处理',stopped:'已停止',revoked:'来源已停用',dismissed:'已收起',superseded:'已有新版本'};
  function assistantPaginateWork(rows,pageIndex=0,pageSize=20){
    const size=Number.isSafeInteger(pageSize)&&pageSize>0&&pageSize<=60?pageSize:20;
    const total=rows.length,pages=Math.max(1,Math.ceil(total/size));
    const requested=Number(pageIndex),page=Number.isSafeInteger(requested)?Math.min(pages-1,Math.max(0,requested)):0;
    const offset=page*size;
    return {items:rows.slice(offset,offset+size),page,pages,total,from:total?offset+1:0,to:Math.min(total,offset+size)};
  }
  function assistantWorkPanel(all=assistantWorkViewAll,pageIndex=assistantWorkPageIndex){
    if(all!==assistantWorkViewAll)pageIndex=0;assistantWorkViewAll=all;
    const state=assistantEngine.state(),rows=state.tickets.filter(item=>all||ASSISTANT_ENGINE_ATTENTION.has(item.status)).slice().reverse();
    const pagination=assistantPaginateWork(rows,pageIndex);assistantWorkPageIndex=pagination.page;
    const cards=pagination.items.map(work=>{
      const message=work.userId&&agentHistory.find(item=>item.id===work.userId),title=message?.text||work.result?.answer||assistantTicketSource(work)+'整理';
      let actions=work.conversationId?'<button class="tide-secondary" data-action="assistant-open-work" data-id="'+esc(work.id)+'">回到对话</button>':work.status==='review'?'<button class="tide-primary" data-action="assistant-work-sources" data-id="'+esc(work.id)+'">核对'+(work.mandate.source==='clock'?'来信':'事项')+'</button>':'';
      if(['failed','interrupted','blocked'].includes(work.status))actions+='<button class="tide-primary" data-action="assistant-retry-work" data-id="'+esc(work.id)+'">继续处理</button>';
      actions+=ASSISTANT_ENGINE_LIVE.has(work.status)?'<button class="tide-secondary" data-action="assistant-stop-work" data-id="'+esc(work.id)+'">停止</button>':'<button class="tide-secondary" data-action="assistant-dismiss-work" data-id="'+esc(work.id)+'">收起</button>';
      actions+='<button class="tide-link" data-action="assistant-work-detail" data-id="'+esc(work.id)+'">过程与来源</button>';
      return '<article class="xixu-work-card"><div><strong>'+esc(title.slice(0,100))+'</strong><span>'+esc(assistantRuntimeLabels[work.status])+'</span></div><p>'+esc(assistantTicketSource(work))+' · '+esc(new Date(work.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}))+'</p><div class="tide-detail-actions">'+actions+'</div></article>';
    }).join('');
    const navigation='<nav class="xixu-work-pagination" aria-label="任务分页"><button class="tide-secondary" data-action="assistant-work-page" data-page="'+(pagination.page-1)+'" '+(pagination.page===0?'disabled':'')+'>较新一页</button><span aria-live="polite">'+(pagination.page+1)+' / '+pagination.pages+' · 共 '+pagination.total+' 项</span><button class="tide-secondary" data-action="assistant-work-page" data-page="'+(pagination.page+1)+'" '+(pagination.page+1>=pagination.pages?'disabled':'')+'>更早一页</button></nav>';
    return '<div class="xixu-work-controls"><button class="tide-secondary" data-action="assistant-work" data-all="'+(!all)+'">'+(all?'只看需要处理':'查看全部任务')+'</button><button class="tide-secondary" data-action="assistant-work-policy">工作方式</button></div>'+(state.policy.paused?'<p role="status">自动接续已暂停；已开始的请求仍可停止。</p>':'')+(cards||'<p>目前没有需要你处理的任务。</p>')+navigation;
  }
  function assistantWorkSettingsHtml(){const count=assistantEngine.state().tickets.filter(item=>ASSISTANT_ENGINE_ATTENTION.has(item.status)).length;return count?'<div class="xixu-setting-actions"><button data-action="assistant-work">'+icon('circle-alert')+'<span>'+count+' 项需要你处理</span>'+icon('chevron-right')+'</button></div>':''}
  function assistantWorkPolicyHtml(){const p=assistantEngine.state().policy;return '<form id="xixu-work-policy" class="tide-form">'+[['paused','暂停自动接续'],['cloud','允许申请发送到电脑或模型（每次仍需核对）'],['materials','检查本机新增或更新的导入资料'],['clock','按已开启的时间信箱规则检查来信']].map(([key,label])=>'<label class="xixu-check-line"><input type="checkbox" name="'+key+'" '+(p[key]?'checked':'')+'>'+label+'</label>').join('')+'<label class="tide-field">同时处理<select name="concurrency"><option value="1" '+(p.concurrency===1?'selected':'')+'>1 项（更省资源）</option><option value="2" '+(p.concurrency===2?'selected':'')+'>2 项</option></select></label><p>只处理你在汐序里提交或导入的资料。应用关闭后不会常驻运行；重新打开时保留任务记录。</p><button class="tide-primary">保存工作方式</button></form>'}
  function assistantWorkDetail(work){
    const state=assistantEngine.state(),refs=work.inputs.map(ref=>'<li>'+esc(ref.source)+' · '+esc(ref.id)+'<button class="tide-link" data-action="assistant-work-evidence" data-ticket="'+esc(work.id)+'" data-source="'+esc(ref.source)+'" data-ref="'+esc(ref.id)+'">查看原文</button></li>').join('');
    const candidates=state.threads.filter(item=>item.id!==work.threadId&&!work.subscriptions.some(sub=>sub.threadId===item.id)).slice(-30);
    return '<p>'+esc(assistantRuntimeLabels[work.status])+' · '+esc(assistantTicketSource(work))+'</p><p>授权版本 '+work.mandate.policyRevision+'；当前设置版本 '+state.policy.revision+'。授权范围：本机读取与建议'+(work.mandate.scope.includes('request_cloud')?'、申请发送核对':'')+'。</p><h3>原始输入</h3><ul>'+refs+'</ul><h3>执行记录</h3><ol>'+work.assignments.map(item=>'<li>'+esc(item.stage)+' · '+esc(item.status)+' · '+esc(item.startedAt)+'</li>').join('')+'</ol><h3>关联的上下文</h3><p>关联资料只作证据，不会授予执行权限。</p><ul>'+work.subscriptions.map(item=>'<li>'+esc(state.threads.find(thread=>thread.id===item.threadId)?.sourceId||item.threadId)+' · '+(item.mode==='origin'?'原始来源':'参考资料')+'</li>').join('')+'</ul>'+(candidates.length?'<form id="xixu-work-attach" data-id="'+esc(work.id)+'"><label>关联其他本机来源<select name="thread">'+candidates.map(item=>'<option value="'+esc(item.id)+'">'+esc(item.source+' · '+item.sourceId)+'</option>').join('')+'</select></label><button class="tide-secondary">关联参考</button></form>':'');
  }
  function assistantRefreshWorkbench(){if(assistantSheet?.kind==='work')assistantShowSheet('助手工作台',assistantWorkPanel(),'work')}
  function assistantResetWorkView(){assistantWorkPageIndex=0}
  const assistantRuntimeBeforeSettings=renderSettings;
  renderSettings=function(){return assistantRuntimeBeforeSettings()+'<div class="xixu-setting-actions"><button data-action="assistant-work" data-all="true">'+icon('layers')+'<span>助手工作台</span>'+icon('chevron-right')+'</button></div>'};
  const assistantRuntimeBeforeToday=renderToday;
  renderToday=function(){return assistantRuntimeBeforeToday()+assistantWorkSettingsHtml()};
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]'),action=button?.dataset.action;
    if(!action||!['assistant-work','assistant-work-page','assistant-open-work','assistant-dismiss-work','assistant-retry-work','assistant-stop-work','assistant-work-policy','assistant-work-detail','assistant-work-sources','assistant-work-evidence','assistant-evidence-conversation','assistant-evidence-detail'].includes(action))return;
    event.preventDefault();event.stopImmediatePropagation();
    try{
      const work=assistantEngine.state().tickets.find(item=>item.id===button.dataset.id);
      if(action==='assistant-work')assistantShowSheet('助手工作台',assistantWorkPanel(button.dataset.all==='true',0),'work');
      else if(action==='assistant-work-page')assistantShowSheet('助手工作台',assistantWorkPanel(assistantWorkViewAll,button.dataset.page),'work');
      else if(action==='assistant-work-policy')assistantShowSheet('助手工作方式',assistantWorkPolicyHtml(),'work-policy');
      else if(action==='assistant-evidence-conversation'){const message=agentHistory.find(item=>item.id===button.dataset.id);if(!message)throw Error('原消息已移除');assistantShowSheet('对话原文','<pre class="xixu-work-evidence">'+esc(message.text)+'</pre>','work-evidence')}
      else if(action==='assistant-evidence-detail'){const messageElement=button.closest('[data-message-id]'),message=messageElement&&agentHistory.find(item=>item.id===messageElement.dataset.messageId);const ref=messageElement?message?.retrievalRefs?.find(item=>item.id===button.dataset.id):agentDraft?.refs?.find(item=>item.id===button.dataset.id);if(!ref)throw Error('来源片段已不存在');assistantShowSheet('本次查询的依据','<pre class="xixu-work-evidence">'+esc(ref.text)+'</pre>','work-evidence')}
      else if(action==='assistant-work-evidence'){
        const item=assistantEngine.state().tickets.find(item=>item.id===button.dataset.ticket),ref=item?.inputs.find(value=>value.id===button.dataset.ref&&value.source===button.dataset.source);if(!ref)throw Error('引用不存在');
        const text=ref.source==='conversation'?agentHistory.find(message=>message.id===ref.id)?.text:assistantSourceRecords().find(record=>record.id===ref.id)?.text;
        if(text===undefined)throw Error('原文已移除');assistantShowSheet('原始记录','<pre class="xixu-work-evidence">'+esc(text)+'</pre><p>这里展示本机当前原文。引用时的内容指纹：'+esc(ref.version)+'；旧版本是否仍可恢复，取决于原资料与历史备份。</p>','work-evidence');
      }else if(!work)throw Error('任务已不存在');
      else if(action==='assistant-open-work'){
        if(!agentHistory.some(item=>item.id===work.userId))throw Error('原消息已移除');assistantCloseSheet();switchAgentConversation(work.conversationId);if(work.result&&agentHistory.some(item=>item.id===work.resultMessageId)&&['review','awaiting_answer'].includes(work.status)){agentDraft=assistantClone(work.result);agentConversationResults.set(work.conversationId,agentDraft)}openPanel({kind:'agent'});requestAnimationFrame(()=>main.querySelector('[data-message-id=\"'+work.userId.replace(/[^A-Za-z0-9_-]/g,'')+'\"]')?.scrollIntoView({block:'center'}));setTimeout(assistantDrainApprovals,0);
      }else if(action==='assistant-work-detail')assistantShowSheet('任务过程与来源',assistantWorkDetail(work),'work-detail');
      else if(action==='assistant-work-sources'){assistantEngine.control(work.id,'dismiss');work.mandate.source==='clock'?assistantShowMailbox():assistantShowCommitments()}
      else if(action==='assistant-retry-work'){assistantEngine.control(work.id,'retry');assistantCloseSheet();assistantQueuePass();assistantRuntimeRefresh()}
      else if(action==='assistant-stop-work'){assistantEngine.control(work.id,'stop');assistantBackgroundJobs.delete(work.id);assistantCancelTransport(agentRequests.get(work.conversationId));assistantQueuePass();assistantRuntimeRefresh()}
      else if(action==='assistant-dismiss-work'){assistantEngine.control(work.id,'dismiss');assistantRuntimeRefresh()}
    }catch(error){notify(error.message)}
  },true);
  root.addEventListener('submit',event=>{
    const form=event.target;if(!['xixu-work-policy','xixu-work-attach'].includes(form.id))return;event.preventDefault();event.stopImmediatePropagation();const data=new FormData(form);
    try{
      if(form.id==='xixu-work-policy'){
        assistantEngine.policy({...Object.fromEntries(['paused','cloud','materials','clock'].map(key=>[key,data.has(key)])),concurrency:Number(data.get('concurrency'))});
        for(const request of [...agentRequests.values()])if(!assistantEngine.allowed(assistantEngine.state().tickets.find(item=>item.id===request.workId)))assistantCancelTransport(request);
        assistantCloseSheet();assistantDrainRemote();assistantQueuePass();assistantRuntimeRefresh();if(assistantEngine.state().policy.materials)assistantIntakeMaterials(assistantSourceRecords()).catch(error=>notify(error.message));
      }else{assistantEngine.attach(form.dataset.id,String(data.get('thread')));assistantShowSheet('任务过程与来源',assistantWorkDetail(assistantEngine.state().tickets.find(item=>item.id===form.dataset.id)),'work-detail')}
    }catch(error){notify(error.message)}
  },true);
