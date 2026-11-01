  // Message-bound proposals, edit drafts and durable local result delivery.
  const assistantActionDrafts=new Map();
  function assistantAssertPlanTicket(id){
    const work=assistantEngine.state().tickets.find(item=>item.id===id);
    if(!work||work.status!=='review'||!assistantEngine.allowed(work))throw Error('这项建议已经结束或授权改变，请重新核对');
    if(work.contextChanged)throw Error('关联资料已更新，请重新查询后核对这项建议');
  }
  function assistantSettlePlanTicket(id,receipt=null){
    if(id)assistantState().orchestration=assistantEngine.prepareConfirmation(id,receipt);
  }
  function assistantBuildResultIndex(history,tickets){
    const messages=new Map(),latestQuestions=new Map(),workByMessage=new Map();
    for(const message of history){messages.set(message.id,message);if(message.role==='user')latestQuestions.set(String(message.conversationId||'default'),message.id)}
    for(const work of tickets)if(work.resultMessageId)workByMessage.set(work.resultMessageId,work);
    return {messages,latestQuestions,workByMessage};
  }
  function assistantMessageResult(message,history=agentHistory,tickets=assistantEngine.state().tickets,index=null){
    if(!message||message.role!=='assistant')return null;
    const conversationId=String(message.conversationId||'default');
    const work=index?index.workByMessage.get(message.id):tickets.find(item=>item.resultMessageId===message.id);
    if(!work||work.conversationId!==conversationId||!work.result)return null;
    const question=index?index.messages.get(work.userId):history.find(item=>item.id===work.userId);
    if(!question||question.role!=='user'||String(question.conversationId||'default')!==conversationId)return null;
    const input=work.inputs.filter(ref=>ref.id===work.userId).at(-1);
    if(input?.at&&input.at!==String(question.editedAt||question.createdAt||''))return null;
    const result={...JSON.parse(JSON.stringify(work.result)),ticketId:work.id,messageId:message.id,conversationId};
    if(work.status!=='review'||work.mandate.revoked||work.contextChanged)result.action={type:'none'};
    const latestQuestionId=index?index.latestQuestions.get(conversationId):history.filter(item=>item.role==='user'&&String(item.conversationId||'default')===conversationId).at(-1)?.id;
    if(work.status!=='awaiting_answer'||latestQuestionId!==work.userId)result.choices=[];
    return result;
  }
  function assistantMessageActionsHtml(message,index=null){
    const result=assistantMessageResult(message,agentHistory,assistantEngine.state().tickets,index);if(!result)return '';
    const html=agentChoicesHtml(result.choices)+agentActionHtml(result.action)+agentDestinationHtml(result.receipt);
    return html?'<div class="xixu-agent-answer" data-agent-result-message="'+esc(message.id)+'" data-agent-ticket="'+esc(result.ticketId)+'">'+html+'</div>':'';
  }
  function assistantRestoreActionDrafts(){
    const tickets=assistantEngine.state().tickets,index=assistantBuildResultIndex(agentHistory,tickets);
    const containers=new Map([...main.querySelectorAll('[data-agent-result-message]')].map(item=>[item.dataset.agentResultMessage,item]));
    for(const [id,draft] of assistantActionDrafts){
      const result=assistantMessageResult(index.messages.get(id),agentHistory,tickets,index);
      if(!result||result.action.type==='none'||assistantStable(result.action)!==draft.signature){assistantActionDrafts.delete(id);continue}
      const container=containers.get(id);
      if(container)for(const field of container.querySelectorAll('[data-agent-field]'))if(Object.prototype.hasOwnProperty.call(draft.fields,field.name))field.value=draft.fields[field.name];
    }
  }
  root.addEventListener('input',event=>{
    const field=event.target,binding=field.closest?.('[data-agent-result-message]');if(!binding||!field.hasAttribute('data-agent-field'))return;
    const result=assistantMessageResult(agentHistory.find(item=>item.id===binding.dataset.agentResultMessage));if(!result||result.action.type==='none')return;
    const signature=assistantStable(result.action),previous=assistantActionDrafts.get(result.messageId),draft=previous?.signature===signature?previous:{signature,fields:{}};
    draft.fields[field.name]=field.value;assistantActionDrafts.set(result.messageId,draft);
  });
  function assistantBindMessageResult(button){
    const binding=button.closest('[data-agent-result-message]');
    if(!binding){if(agentDraft?.ticketId)throw Error('请从对应回复下方选择操作');return}
    const message=agentHistory.find(item=>item.id===binding.dataset.agentResultMessage&&String(item.conversationId||'default')===activeConversationId());
    const result=assistantMessageResult(message);
    if(!result||result.ticketId!==binding.dataset.agentTicket)throw Error('这条建议已更新或结束，请重新核对');
    if(['agent-confirm','agent-dismiss','assistant-temporal-review','assistant-start-web'].includes(button.dataset.action)&&result.action?.type==='none')throw Error('这条建议已结束，未执行任何修改');
    if(button.dataset.action==='agent-choice'&&!result.choices?.some(item=>item.value===button.dataset.text))throw Error('这条快捷回复已失效，请直接输入');
    agentDraft=result;agentConversationResults.set(activeConversationId(),result);
  }
  function assistantUpdatePlanMessage(plan){
    const work=assistantEngine.state().tickets.find(item=>item.id===plan.draft?.ticketId);if(!work)return;
    const message=agentHistory.find(item=>item.id===work.resultMessageId&&String(item.conversationId||'default')===work.conversationId);
    if(message)message.text=work.result.answer;
    assistantActionDrafts.delete(work.resultMessageId);
    const result=message&&assistantMessageResult(message);
    if(result&&agentConversationResults.get(work.conversationId)?.ticketId===work.id)agentConversationResults.set(work.conversationId,result);
    if(result&&activeConversationId()===work.conversationId&&agentDraft?.ticketId===work.id)agentDraft=result;
  }
  function assistantSafeResult(result){
    // Store only portable source references and bounded excerpts, never token
    // maps, vectors, native handles or provider credentials.
    const refs=(result.refs||[]).slice(0,12).map(ref=>Object.fromEntries(['id','documentId','chunkId','title','text','url','recordType','kind','action','date','sourceId','chunkStart','chunkEnd','sourceExcerpt','truncated','baseVersion','baseVersionHash'].filter(key=>ref[key]!==undefined).map(key=>[key,ref[key]])));
    return assistantClone({...result,refs,action:result.action||{type:'none'}});
  }
  function assistantPublishResult(request,result){
    if(!assistantRequestLive(request))return;
    const work=assistantEngine.state().tickets.find(item=>item.id===request.workId);if(work?.contextChanged)result={...result,answer:result.answer+'\n\n关联资料在处理期间有更新，请重新核对后再决定；本次没有执行修改。',action:{type:'none'},needsAnswer:true};
    result={...result,traceId:assistantTrace(request,result),ticketId:request.workId};
    result.needsAnswer=Boolean(result.needsAnswer||assistantState().pendingSlots[request.conversationId]||result.choices?.length);
    const effect=assistantEngine.complete(request.workId,request.assignmentId,assistantSafeResult(result));
    // Commit the report + outbox before making the reply visible. A reload can
    // redeliver this local result using the same message id, never a model call.
    agentRequests.delete(request.conversationId);
    if(effect)assistantDeliverEffect(effect);assistantQueuePass();assistantRuntimeRefresh();
  }
  function assistantDeliverEffect(effect){
    if(effect.status!=='pending')return;
    const work=assistantEngine.state().tickets.find(item=>item.id===effect.ticketId);
    const user=agentHistory.find(item=>item.id===effect.userId&&String(item.conversationId||'default')===effect.conversationId);
    if(!user||!work||effect.inputAt&&String(user.editedAt||user.createdAt||'')!==effect.inputAt){assistantEngine.acknowledge(effect.id,'dropped');return}
    const previousHistory=agentHistory.slice(),oldResult=agentConversationResults.get(effect.conversationId),oldMeta=agentPreferences.conversations?.[effect.conversationId],oldDraft=agentDraft;
    try{
      if(!agentHistory.some(item=>item.id===effect.messageId)){
        const index=agentHistory.indexOf(user);agentHistory.splice(index+1,0,{id:effect.messageId,conversationId:effect.conversationId,role:'assistant',text:effect.result.answer,source:effect.result.source||'local',createdAt:effect.at,retrievalRefs:effect.result.refs||[],ticketId:work.id});
      }
      agentConversationResults.set(effect.conversationId,assistantClone(effect.result));if(activeConversationId()===effect.conversationId)agentDraft=agentConversationResults.get(effect.conversationId);
      agentConversationMetadata()[effect.conversationId]={...oldMeta,updatedAt:effect.at};assistantRuntimeSave();
    }catch(error){agentHistory=previousHistory;if(oldResult)agentConversationResults.set(effect.conversationId,oldResult);else agentConversationResults.delete(effect.conversationId);agentDraft=oldDraft;agentPreferences.conversations[effect.conversationId]=oldMeta;throw error}
    assistantEngine.acknowledge(effect.id);
  }
  function assistantRestoreResults(){
    const latestQuestions=new Map();agentConversationResults.clear();
    for(const item of agentHistory)if(item.role==='user')latestQuestions.set(String(item.conversationId||'default'),item.id);
    for(const work of assistantEngine.state().tickets){
      if(latestQuestions.get(work.conversationId)!==work.userId)continue;
      const result=assistantMessageResult(agentHistory.find(item=>item.id===work.resultMessageId));
      if(result)agentConversationResults.set(work.conversationId,result);
    }
    agentDraft=agentConversationResults.get(activeConversationId())||null;
  }
  function assistantClearResultDrafts(){assistantActionDrafts.clear()}
