  // Local-first runtime adapter. Jobs run only while this application is alive;
  // no OS background service, shell worker, account watcher or cloud daemon.
  const assistantEngine=createAssistantEngine({
    read:()=>assistantState().orchestration,
    write:value=>{if(value===undefined)delete assistantState().orchestration;else assistantState().orchestration=value},
    save:()=>persist({scope:'assistant'})===true
  });
  assistantTools.set('recall_conversation',{name:'recall_conversation',description:'按关键词回查当前任务所属对话的较早原文，可指定上一页位置；不能读取未关联的其他对话',readOnly:true,requiresConfirmation:false,inputSchema:{type:'object',additionalProperties:false,required:['query'],properties:{query:{type:'string',minLength:1,maxLength:300},before_message_id:{type:'string',maxLength:128},limit:{type:'integer',minimum:1,maximum:5}}}});
  let assistantRuntimeOwner=null,assistantRuntimeReady=false,assistantPumpScheduled=false,assistantPumpBusy=false,assistantWatchdogAt=0,assistantRuntimeRefreshFrame=0;
  const assistantBackgroundJobs=new Map();
  function assistantRuntimeSave(){if(persist({scope:'assistant'})!==true)throw Error('这次修改未保存，请检查本机存储')}
  function assistantTaskContext(request,query){
    // Full original messages are the spill store. A task owns references, not a
    // second mutable copy of another conversation's session.
    const context=compactAgentConversation(request.history,2600,query);
    request.recallIds=context.recallIds;return context;
  }
  function assistantRecallConversation(request,{query,before_message_id='',limit=3}){
    if(!request||!assistantRequestLive(request))throw Error('没有可回查的当前任务');
    let history=request.history;
    if(before_message_id){const index=history.findIndex(item=>item.id===before_message_id);if(index<0)throw Error('回查位置不属于这段对话');history=history.slice(0,index)}
    const weights=ragTokenWeights(query),ranked=[];
    for(const item of history){
      const text=ragSafeText(item.text),lower=text.toLowerCase();let score=0,anchor=-1;
      weights.forEach((weight,token)=>{const at=lower.indexOf(token);if(at>=0){score+=weight;if(anchor<0||at<anchor)anchor=at}});
      if(score)ranked.push({item,text,score,anchor});
    }
    ranked.sort((a,b)=>b.score-a.score||String(b.item.createdAt||'').localeCompare(String(a.item.createdAt||'')));
    return ranked.slice(0,limit).map(({item,text,anchor})=>{let start=Math.max(0,anchor-100);if(start&&/[\uDC00-\uDFFF]/.test(text[start]))start--;let excerpt=text.slice(start,start+700);if(/[\uD800-\uDBFF]$/.test(excerpt))excerpt=excerpt.slice(0,-1);return {messageId:item.id,role:item.role,at:item.createdAt||'',normalizedStart:start,text:excerpt,partial:start>0||excerpt.length<text.length}});
  }
  function assistantMergeEvidence(refs,request){
    const work=assistantEngine.state().tickets.find(item=>item.id===request.workId),threads=assistantEngine.state().threads,extra=[];
    for(const subscription of work?.subscriptions||[]){
      if(subscription.mode!=='context')continue;
      const thread=threads.find(item=>item.id===subscription.threadId);if(!thread)continue;
      if(thread.source==='material'){
        const record=assistantSourceRecords().find(item=>item.id===thread.sourceId);if(!record)continue;
        extra.push({id:record.recordId,documentId:record.id,chunkId:record.id+':attached',title:record.title,text:String(record.text||'').slice(0,1600),baseVersion:assistantStable(record.id.startsWith('note:')?notes.find(item=>item.id===record.recordId):scratchEntries.find(item=>item.id===record.recordId)),recordType:record.id.startsWith('note:')?'note':'scratch',kind:'参考资料',action:record.action,sourceExcerpt:true});
      }else if(thread.source==='conversation'){
        // Explicitly attached conversations are evidence, never system/user
        // instructions. The privacy preview shows these as separate sources.
        const item=activeAgentHistory(thread.sourceId).at(-1);if(item)extra.push({id:item.id,documentId:'conversation:'+thread.sourceId,chunkId:item.id,title:'已关联的对话原文',text:String(item.text).slice(0,1200),recordType:'conversation',kind:'对话证据',action:'assistant-evidence-conversation',sourceExcerpt:true});
      }
    }
    const combined=[...extra,...refs],selected=[],keys=new Set();let chars=0;
    for(const ref of combined){const key=ref.chunkId||ref.id;if(keys.has(key)||chars>=6000||selected.length>=8)continue;keys.add(key);const text=String(ref.text||'').slice(0,6000-chars);chars+=text.length;selected.push({...ref,text,sourceExcerpt:ref.sourceExcerpt||text.length<String(ref.text||'').length})}
    return selected;
  }
  function assistantRequestLive(request){return Boolean(request&&!request.cancelled&&agentRequests.get(request.conversationId)===request&&request.owner===agentPreferences)}
  function assistantActiveRequest(){return agentRequests.get(activeConversationId())||null}
  function assistantAnyWorkBusy(){
    return Boolean(agentRequests.size||assistantBackgroundJobs.size||assistantSubmittingConversations.size||agentImagePending||assistantMiningBusy||assistantModelPending.size||assistantApprovalQueue.length||assistantPrivacy||assistantVisionApproval||assistantEngine.state().tickets.some(item=>item.status==='queued'));
  }
  function assistantCheckpoint(request,stage,refs=[]){
    if(!assistantRequestLive(request))throw Error('这次处理已停止');
    assistantEngine.checkpoint(request.workId,request.assignmentId,stage,refs.map(ref=>({source:ref.recordType||'document',id:String(ref.id||''),version:String(ref.baseVersionHash||ref.version||''),chunkId:String(ref.chunkId||'')})));
    request.stage=stage;request.progressAt=Date.now();
  }
  function assistantTicketSource(work){return work.mandate.source==='conversation'?'对话':work.mandate.source==='material'?'本机资料':'时间信箱'}
  function assistantRuntimeRefresh(){
    if(assistantRuntimeRefreshFrame)return;
    assistantRuntimeRefreshFrame=requestAnimationFrame(()=>{
      assistantRuntimeRefreshFrame=0;
      if(panel?.kind==='agent'||!panel&&['settings','today'].includes(page))render(false);
      assistantRefreshWorkbench();
    });
  }
  function assistantQueuePass(){if(assistantPumpScheduled||!assistantRuntimeReady)return;assistantPumpScheduled=true;setTimeout(()=>{assistantPumpScheduled=false;assistantRunPass().catch(error=>{if(!storageBlocked)notify(error.message||'助手暂未继续，原资料仍保留')})},0)}
  function assistantCancelTransport(request){
    if(!request)return;
    request.cancelled=true;
    assistantCancelApprovalFor(request);
    assistantCancelRemoteWaiter(request);
    if(request.modelId)assistantResolveModel(request.modelId,Error('这次处理已停止'));
    if(request.knowledgeId)cancelKnowledgeRequest(request.knowledgeId);
    if(agentRequests.get(request.conversationId)===request)agentRequests.delete(request.conversationId);
  }
  function assistantMakeRequest(work,attempt){
    const message=agentHistory.find(item=>item.id===work.userId&&item.role==='user'&&String(item.conversationId||'default')===work.conversationId);
    if(!message)throw Error('原消息已移除，未恢复请求');
    return {workId:work.id,assignmentId:attempt.id,owner:agentPreferences,conversationId:work.conversationId,userId:message.id,query:message.text,refs:[],stage:'local',started:performance.now(),progressAt:Date.now(),route:'rule',day:(()=>{const date=new Date(message.editedAt||message.createdAt);return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):localDay()})(),history:assistantClone(agentHistoryBeforeMessage(activeAgentHistory(work.conversationId),message.id))};
  }
  async function assistantRunTicket(work){
    const attempt=assistantEngine.assign(work.id);
    if(work.mandate.source!=='conversation'){
      assistantBackgroundJobs.set(work.id,{assignmentId:attempt.id,progressAt:Date.now(),owner:agentPreferences});
      try{
        let answer='';
        if(work.mandate.source==='material'){
          const ref=work.inputs.at(-1),record=assistantSourceRecords().find(item=>item.id===ref.id);
          if(!record)throw Error('原资料已移除');const version=await archiveSha(new TextEncoder().encode(record.text));
          if(version!==ref.version)throw Error('原资料已更新，后续版本会单独检查');
          const owner=agentPreferences;await assistantMineRecords([record],true,()=>assistantBackgroundJobs.get(work.id)?.assignmentId===attempt.id&&assistantEngine.state().tickets.find(item=>item.id===work.id)?.status==='running');if(owner!==agentPreferences||assistantBackgroundJobs.get(work.id)?.assignmentId!==attempt.id)return;
          const count=assistantState().commitments.filter(item=>item.sourceId===ref.id&&item.sourceVersion===version&&item.status==='suggested'&&!assistantTaskMatch(item)).length;
          answer=count?'这份资料有 '+count+' 件事等待核对':'这份资料暂未发现新的未登记事项';
          assistantEngine.complete(work.id,attempt.id,{answer,refs:[],action:{type:count?'review_commitments':'none'},source:'local'});
        }else{
          const previous=assistantState().mailbox.letters.length;assistantMailboxGenerate();const count=assistantState().mailbox.letters.length-previous;
          assistantEngine.complete(work.id,attempt.id,{answer:count?'时间信箱有新的来信':'时间信箱已检查',refs:[],action:{type:count?'open_mailbox':'none'},source:'local'});
        }
      }catch(error){
        if(assistantBackgroundJobs.get(work.id)?.owner===agentPreferences)try{assistantEngine.complete(work.id,attempt.id,{answer:String(error.message||'本机整理未完成'),error:true,refs:[],action:{type:'none'},source:'local'})}catch(_){}
      }finally{if(assistantBackgroundJobs.get(work.id)?.assignmentId===attempt.id)assistantBackgroundJobs.delete(work.id);assistantRuntimeRefresh();assistantQueuePass()}
      return;
    }
    let request;
    try{request=assistantMakeRequest(work,attempt);agentRequests.set(work.conversationId,request);assistantRuntimeRefresh();await assistantExecuteAgent(request)}
    catch(error){
      if(request&&assistantRequestLive(request)){
        // A failed durable report must not silently become a successful reply.
        try{assistantPublishResult(request,{answer:'处理未完成：'+String(error.message||'请稍后重试')+'。没有执行日程修改。',error:true,refs:[],action:{type:'none'},source:'local'})}
        catch(_){assistantCancelTransport(request);try{assistantEngine.control(work.id,'interrupt')}catch(_){}notify('这次结果尚未完整保存，请检查存储后在工作台恢复')}
      }else if(!request)try{assistantEngine.complete(work.id,attempt.id,{answer:String(error.message),error:true,refs:[],action:{type:'none'},source:'local'})}catch(_){}
    }finally{assistantQueuePass()}
  }
  async function assistantRunPass(){
    if(assistantPumpBusy||document.hidden||storageBlocked||!assistantRuntimeReady)return;assistantPumpBusy=true;
    try{
      for(const effect of assistantEngine.state().outbox.filter(item=>item.status==='pending'))assistantDeliverEffect(effect);
      const state=assistantEngine.state();if(state.policy.paused)return;
      const active=[...agentRequests.values()].filter(request=>!['approval','approval-queued','transport-queued'].includes(request.stage)).length+assistantBackgroundJobs.size,limit=state.policy.concurrency;
      const foregroundExtra=active===limit&&state.tickets.some(item=>item.status==='queued'&&item.conversationId===activeConversationId()&&!agentRequests.has(item.conversationId));
      if(active>=limit&&!foregroundExtra)return;
      const busyConversations=new Set([...agentRequests.keys()]);
      const jobs=state.tickets.filter(item=>item.status==='queued'&&assistantEngine.allowed(item)&&(!item.conversationId||!busyConversations.has(item.conversationId)));
      jobs.sort((a,b)=>Number(b.conversationId===activeConversationId())-Number(a.conversationId===activeConversationId())||Number(Boolean(b.conversationId))-Number(Boolean(a.conversationId))||a.createdAt.localeCompare(b.createdAt));
      let slots=Math.max(foregroundExtra?1:0,limit-active);
      for(const work of jobs){if(!slots)break;if(foregroundExtra&&work.conversationId!==activeConversationId())continue;if(work.conversationId&&busyConversations.has(work.conversationId))continue;if(work.conversationId)busyConversations.add(work.conversationId);slots--;void assistantRunTicket(work).catch(error=>{notify(error.message);assistantQueuePass()})}
    }finally{assistantPumpBusy=false;}
  }
  function assistantEnqueueQuestion(conversationId,userId,ticketId='',version=''){
    const message=agentHistory.find(item=>item.id===userId);if(!message)throw Error('原消息不存在');
    if(!/^[a-f0-9]{64}$/.test(version))throw Error('消息版本标识缺失');
    const result=assistantEngine.receive({source:'conversation',key:userId+':'+version+':'+(message.editedAt||''),thread:conversationId,ticketId,ref:{source:'conversation',id:userId,version,at:String(message.editedAt||message.createdAt||'')}});
    assistantQueuePass();return result;
  }
  let assistantMaterialIntake=null;
  function assistantIntakeMaterials(records){
    if(!assistantRuntimeReady||storageBlocked)return Promise.resolve();
    const owner=agentPreferences;
    if(!assistantMaterialIntake||assistantMaterialIntake.owner!==owner)assistantMaterialIntake={owner,queue:new Map(),running:null};
    const intake=assistantMaterialIntake,tracked=new Set(assistantEngine.state().threads.filter(item=>item.source==='material').map(item=>item.sourceId));
    for(const record of records){
      // Do not create durable jobs for every ordinary note on each launch.
      // Tracked evidence is always rechecked, including cancellation-only edits.
      if(tracked.has(record.id)||/提交|交(?:作业|报告|开题|稿|材料)|截止|汇报|答辩|开会|考试|开题.*交|(?:号|日|天|周[一二三四五六日]).{0,15}(?:交|发给)/i.test(String(record.text||'')))intake.queue.set(record.id,record);
    }
    if(intake.running)return intake.running;
    intake.running=(async()=>{
      await Promise.resolve();
      try{while(intake.queue.size){
        if(owner!==agentPreferences||storageBlocked||!assistantEngine.state().policy.materials)return;
        // Interactive requests take priority over material hashing and snapshots.
        if(agentRequests.size||assistantSubmittingConversations.size){await new Promise(resolve=>setTimeout(resolve,100));continue}
        const [key,record]=intake.queue.entries().next().value;intake.queue.delete(key);
        const version=await archiveSha(new TextEncoder().encode(String(record.text||'')));if(owner!==agentPreferences)return;
        const current=key.startsWith('note:')?notes.find(item=>item.id===record.recordId):scratchEntries.find(item=>item.id===record.recordId);
        if(!current||current.text!==record.text)continue;
        assistantEngine.receive({source:'material',key:record.id+':'+version,thread:record.id,ref:{source:'material',id:record.id,version,at:String(record.at||'')}});
        const workById=new Map(assistantEngine.state().tickets.map(item=>[item.id,item]));
        for(const [id,job] of assistantBackgroundJobs)if(workById.get(id)?.status==='superseded'&&assistantBackgroundJobs.get(id)===job)assistantBackgroundJobs.delete(id);
        assistantQueuePass();await archiveYield();
      }}finally{intake.running=null;if(owner===agentPreferences)assistantRuntimeRefresh()}
    })();
    return intake.running;
  }
  function assistantRuntimeStart(){
    if(storageBlocked)return;
    if(assistantRuntimeOwner===agentPreferences&&assistantRuntimeReady){assistantQueuePass();return}
    for(const request of agentRequests.values())assistantCancelTransport(request);
    assistantBackgroundJobs.clear();assistantClearResultDrafts();assistantRuntimeOwner=agentPreferences;assistantRuntimeReady=false;assistantResetWorkView();
    try{assistantEngine.recover();assistantRestoreResults();assistantRuntimeReady=true;assistantQueuePass();assistantIntakeMaterials(assistantSourceRecords()).catch(error=>notify(error.message))}
    catch(error){notify(error.message||'助手任务恢复未完成，原资料保留')}
  }
  const assistantLoadBeforeRuntime=loadSaved;
  loadSaved=function(){assistantLoadBeforeRuntime();setTimeout(assistantRuntimeStart,0)};
  function assistantRuntimeTick(){
    if(document.hidden||storageBlocked)return;
    if(assistantRuntimeOwner!==agentPreferences||!assistantRuntimeReady){assistantRuntimeStart();return}
    const now=Date.now();
    if(now-assistantWatchdogAt>30000){assistantWatchdogAt=now;for(const request of [...agentRequests.values()]){
      if(request.stage==='approval'||request.stage==='approval-queued')continue;
      if(now-request.progressAt>180000){try{assistantEngine.control(request.workId,'interrupt');assistantCancelTransport(request)}catch(error){notify(error.message)}}
    }for(const [id,job] of [...assistantBackgroundJobs])if(now-job.progressAt>180000){try{assistantEngine.control(id,'interrupt');assistantBackgroundJobs.delete(id)}catch(error){notify(error.message)}}}
    assistantDrainApprovals();
    if(assistantEngine.state().policy.clock&&assistantState().mailbox.enabled){const day=localDay(),bucket=Math.floor(now/3600000);try{assistantEngine.receive({source:'clock',key:'mailbox:'+day+':'+bucket,thread:'mailbox',ref:{source:'clock',id:'mailbox',version:String(bucket)}})}catch(error){notify(error.message)}}
    assistantQueuePass();
  }
  registerForegroundTask(assistantRuntimeTick,30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)assistantRuntimeTick()});
  window.addEventListener('pagehide',()=>{for(const request of [...agentRequests.values()]){try{assistantEngine.control(request.workId,'interrupt')}catch(_){}assistantCancelTransport(request)}for(const id of assistantBackgroundJobs.keys())try{assistantEngine.control(id,'interrupt')}catch(_){}assistantBackgroundJobs.clear();});
