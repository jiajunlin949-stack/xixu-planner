  // Analyze only material already saved by the user. No watchers or account access.
  let assistantMiningGeneration=0,assistantMiningBusy=false;
  const assistantMiningQueue=new Map();
  const assistantTopic=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s，。；：、,.!！?？:]/g,'');
  const assistantOriginalTime=note=>String(note.sourceUpdatedAt||note.sourceSentAt||note.updatedAt||note.createdAt||'');
  function assistantSourceRecords(){
    return [...notes.map(note=>({id:'note:'+note.id,title:note.title||'备忘录',text:note.text,at:assistantOriginalTime(note),originalHash:note.archive?.originalHash||'',action:'memory',recordId:note.id})),...scratchEntries.map(item=>({id:'scratch:'+item.id,title:'碎片记录',text:item.text,at:item.updatedAt||item.createdAt,originalHash:'',action:'scratch',recordId:item.id}))];
  }
  function assistantExtractCommitments(record){
    const text=String(record.text||''),results=[];let offset=0;
    for(const line of text.split(/\n|(?<=[。；！？])/u)){
      const start=text.indexOf(line,offset);offset=Math.max(offset,start+line.length);
      if(line.length>2000)continue; // Suggestion extraction never truncates the stored source.
      if(!/提交|交(?:作业|报告|开题|稿|材料)|截止|汇报|答辩|开会|考试|开题.*交|(?:号|日|天|周[一二三四五六日]).{0,15}(?:交|发给)/i.test(line)||/取消|不用交|无需提交|不必提交|已经提交|已提交|已完成|[?？]/.test(line))continue;
      const anchor=/^\d{4}-\d{2}-\d{2}/.exec(record.at||'')?.[0]||'',date=assistantDateSlots(line,anchor||DEMO_DAY),clock=assistantTimeSlot(line),hasRelative=/明天|后天|今天|今晚|下周|本周|这周/.test(line);
      // Never anchor an old unknown-time message to today's import date.
      if(!date.date&&!date.ambiguous&&!/\d{1,2}月\d{1,2}|明天|后天|下周|本周/.test(line))continue;
      const unknownAnchor=!anchor&&(hasRelative||! /\d{4}[-年]/.test(line));
      const actorMatch=line.match(/(?:^|[，,:：\s])([\u3400-\u9fffA-Za-z0-9_]{1,16})(?:同学|老师|教授)?(?:请|需要|要|务必)/),actor=actorMatch?.[1]||(/大家|各位|全体/.test(line)?'群体通知（待确认是否与你有关）':'未明确指派给谁');
      const title=assistantTitle(line).replace(/(?:请|大家|各位|务必|需要)/g,'').trim().slice(0,100)||record.title,kind=/考试|答辩/.test(line)?'exam':/开会|会议|汇报/.test(line)?'meeting':'homework';
      results.push({title,actor,date:unknownAnchor?'':date.date||'',time:clock.time||(kind==='homework'&&!clock.invalid?'23:59':''),timeEstimated:!clock.time,type:kind,evidence:line.trim(),start,end:start+line.length,sourceId:record.id,sourceTitle:record.title,sourceAt:record.at||'',originalHash:record.originalHash,recordId:record.recordId,requiresDate:unknownAnchor||!date.date,requiresAssignee:!/(?:我|本人)/.test(line),status:'suggested'});
    }
    return results;
  }
  function assistantTaskMatch(candidate){
    const title=assistantTopic(candidate.title);return tasks.find(task=>task.date===candidate.date&&(assistantTopic(task.title)===title||Math.min(title.length,assistantTopic(task.title).length)>=4&&(title.includes(assistantTopic(task.title))||assistantTopic(task.title).includes(title))));
  }
  async function assistantMineRecords(records){
    for(const record of records)assistantMiningQueue.set(record.id,record);
    if(assistantMiningBusy)return;
    const generation=assistantMiningGeneration,state=assistantState();assistantMiningBusy=true;
    try{
      while(assistantMiningQueue.size){
        const record=assistantMiningQueue.values().next().value;assistantMiningQueue.delete(record.id);
        if(generation!==assistantMiningGeneration)return;
        const version=await archiveSha(new TextEncoder().encode(record.text));
        if(generation!==assistantMiningGeneration)return;
        if(!assistantSourceRecords().some(item=>item.id===record.id&&item.text===record.text))continue;
        state.commitments.filter(item=>item.sourceId===record.id&&item.sourceVersion!==version&&item.status==='suggested').forEach(item=>item.status='source_changed');
        for(const candidate of assistantExtractCommitments(record)){
          if(state.commitments.some(item=>item.sourceId===record.id&&item.sourceVersion===version&&item.start===candidate.start))continue;
          if(state.commitments.length>=10000)throw Error('建议档案容量已满，请先完整备份并整理。');
          const existing=assistantTaskMatch(candidate);state.commitments.push({...candidate,id:uid(),sourceVersion:version,foundAt:new Date().toISOString(),status:existing?'already_recorded':'suggested',matchedTaskId:existing?.id||''});
        }
        await archiveYield();
      }
      persist();if(assistantSheet?.kind==='commitments')assistantShowCommitments();
    }catch(error){notify(error.message||'事项建议未整理完成，原记录仍保留')}
    finally{assistantMiningBusy=false}
  }
  function assistantShowCommitments(){
    const state=assistantState(),pending=state.commitments.filter(item=>item.status==='suggested'&&!assistantTaskMatch(item));
    assistantShowSheet('待核对的事项','<p>仅分析你已手动保存或导入的内容；不会自动加入日程。群体通知不一定是你的任务，请逐条核对。</p><button class="tide-secondary" data-action="assistant-mine">重新检查本机记录</button>'+(knowledgeEnabled()?'<button class="tide-secondary" data-action="assistant-computer-suggestions">读取电脑建议（最多100条）</button>':'')+'<p>共有 '+pending.length+' 条，先展示最近 '+Math.min(30,pending.length)+' 条；处理后继续显示其余建议。</p>'+(pending.slice(-30).reverse().map(item=>'<article class="xixu-commitment"><strong>'+esc(item.title)+'</strong><blockquote>'+esc(item.evidence)+'</blockquote><p>'+esc(item.sourceTitle)+' · '+esc(item.sourceAt||'原始时间未知')+'</p><p>'+esc(item.actor)+' · '+esc(item.requiresDate?'日期需补充':item.date)+(item.timeEstimated?' · 时刻待核对':' '+esc(item.time))+'</p><div class="tide-detail-actions"><button data-action="assistant-suggestion-dismiss" data-id="'+esc(item.id)+'" class="tide-link">忽略</button><button data-action="assistant-suggestion-review" data-id="'+esc(item.id)+'" class="tide-primary">核对这件事</button></div></article>').join('')||'<p>暂无新的未登记事项建议。</p>'),'commitments');
  }
  async function assistantVerifyCommitment(item){
    if(!item)throw Error('建议已经不存在');
    if(item.external){if(!knowledgeEnabled())throw Error('请先连接原来的电脑以核对来源');const source=await knowledgeCall('excerpt',{document_id:item.documentId,version:item.sourceVersion,start:item.start,end:item.end});if(String(source.text).trim()!==item.evidence.trim())throw Error('电脑来源内容已改变，请重新读取建议');return}
    const record=assistantSourceRecords().find(value=>value.id===item.sourceId);if(!record||await archiveSha(new TextEncoder().encode(record.text))!==item.sourceVersion)throw Error('原文后来改过或已移除，请重新检查');
  }
  async function assistantComputerSuggestions(){
    if(!knowledgeEnabled())throw Error('请先连接电脑');const result=await knowledgeCall('suggestions'),state=assistantState();
    for(const item of result.suggestions||[]){const id='computer:'+item.id;if(state.commitments.some(entry=>entry.id===id))continue;if(state.commitments.length>=10000)throw Error('建议档案容量已满');state.commitments.push({id,sourceId:'computer:'+item.document_id,documentId:item.document_id,sourceVersion:item.version,external:true,title:item.title,actor:'发言者：'+(item.actor||'未知')+'；需确认是否指派给你',date:item.deadline||'',time:/考试|答辩|开会|汇报/.test(item.title)?'':'23:59',timeEstimated:true,type:/考试|答辩/.test(item.title)?'exam':/开会|汇报/.test(item.title)?'meeting':'homework',sourceAt:item.source_time||'',sourceTitle:'电脑已导入的聊天资料',originalHash:item.original_hash||'',evidence:item.evidence,start:item.start,end:item.end,status:'suggested',requiresDate:!item.deadline,foundAt:new Date().toISOString()})}
    persist();assistantShowCommitments();
  }
  async function assistantReviewSuggestion(id){
    const item=assistantState().commitments.find(value=>value.id===id);await assistantVerifyCommitment(item);
    assistantShowSheet('核对来源和安排','<blockquote>'+esc(item.evidence)+'</blockquote><form id="xixu-suggestion-form" data-id="'+esc(id)+'" class="tide-form"><label class="tide-field">标题<input name="title" maxlength="100" required value="'+esc(item.title)+'"></label><label class="tide-field">日期<input name="date" type="date" required value="'+esc(item.date)+'"></label><label class="tide-field">时刻<input name="time" type="time" required value="'+esc(item.time)+'"></label><label class="xixu-check-line"><input type="checkbox" name="mine" required>我确认这是我需要处理的事项</label><button class="tide-primary tide-full">查看日程变更</button></form>','suggestion');
  }
  function assistantTemporalClaims(refs){
    const claims=[];
    for(const ref of refs){
      const record=notes.find(item=>ref.recordType==='note'&&(item.id===ref.id||ref.documentId==='note:'+item.id)),at=record?assistantOriginalTime(record):ref.metadata?.sent_at||ref.metadata?.source_updated_at||'',text=String(ref.text||'');
      for(const line of text.split(/\n|(?<=[。；])/u)){
        if(!/改为|改到|延期|推迟|更正|调整|原定|考试|截止|提交/.test(line))continue;
        let dates=normalizeSpokenScheduleText(line).match(/(?:(?:\d{4})年)?\d{1,2}月\d{1,2}(?:日|号)?/g)||[],field='date';
        if(!dates.length){const detail=line.match(/(地点|教室|考场|范围)\s*[:：]?\s*(.{1,100})/);if(detail){field=detail[1]==='范围'?'scope':'location';dates=detail[2].split(/[，,]?\s*(?:现|现在|已经)?(?:改为|改到|调整为|更正为)/).map(item=>item.replace(/^[，,:：\s]+|[，,:：\s]+$/g,'')).filter(Boolean)}}if(!dates.length)continue;
        const knownCourse=linkableCourses().find(item=>line.includes(item.name)),subject=line.replace(/(?:(?:\d{4})年)?\d{1,2}月\d{1,2}(?:日|号)?/g,'').split(/改为|改到|延期|推迟|更正|调整|原定|定于|在|时间|截止|地点|教室|考场|范围/)[0].replace(/[，。:：\s]/g,'');
        if(subject.length<3&&!knownCourse)continue;
        claims.push({ref,subject:subject||knownCourse.name,field,at,dates,changed:/改为|改到|延期|推迟|更正/.test(line),evidence:line.trim()});
      }
    }
    const groups=new Map();for(const claim of claims){const key=assistantTopic(claim.subject)+'|'+claim.field;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(claim)}
    return [...groups.values()].filter(group=>new Set(group.flatMap(item=>item.dates)).size>1).map(group=>({subject:group[0].subject,claims:group.slice().sort((a,b)=>(Date.parse(a.at)||0)-(Date.parse(b.at)||0)),status:group.length===1&&group[0].changed&&group[0].dates.length>1?'explicit_revision_in_source':'needs_scope_confirmation'}));
  }
  let temporalReviewGroups=null;
  function temporalFingerprint(claim){return assistantStable({source:claim.ref.documentId||claim.ref.id,version:claim.ref.baseVersionHash||claim.ref.id,at:claim.at,field:claim.field,evidence:claim.evidence})}
  function temporalResolution(group){
    const fingerprints=group.claims.map(temporalFingerprint).sort();
    return (assistantState().temporalResolutions||[]).slice().reverse().find(item=>item.subject===group.subject&&item.field===group.claims[0].field&&assistantStable(item.fingerprints)===assistantStable(fingerprints));
  }
  function assistantTemporalAnswer(query,refs){
    if(!/后来|改了|改期|延期|最新|什么时候|冲突|以.*为准/.test(query))return null;
    const groups=assistantTemporalClaims(refs);if(!groups.length)return null;
    const unresolved=groups.some(group=>!temporalResolution(group));
    return {answer:groups.map(group=>{
      const decision=temporalResolution(group),sources=group.claims.map(claim=>'• '+(claim.at||'原始时间未知')+'：'+claim.evidence).join('\n');
      if(decision)return '“'+group.subject+'”当前按你核对的“'+decision.scope+'”处理：'+decision.value+'。\n核对时间：'+decision.at+'；保留的新旧出处：\n'+sources+'\n来源内容若变化，会重新请求核对。尚未替你改日程。';
      return '“'+group.subject+'”有不同通知内容：\n'+sources+(group.status==='explicit_revision_in_source'?'\n本条明确写了从“'+group.claims[0].dates[0]+'”改为“'+group.claims[0].dates.at(-1)+'”。':'\n请核对是否同一次事项、班级或批次，并选择哪条为准。')+'尚未替你修改日程。';
    }).join('\n\n'),refs,action:unresolved?{type:'review_temporal',groups}:{type:'none'},source:'local',tool:'temporal_sources'};
  }
  function assistantReviewTemporal(){
    const groups=agentDraft?.action?.type==='review_temporal'?agentDraft.action.groups:null;if(!groups?.length)throw Error('请先向助手询问“这件事后来改了吗”，再核对这次的通知来源');temporalReviewGroups=groups;
    assistantShowSheet('核对通知变化','<p>为每组通知说明适用的同一事项、班级或批次，再选择当前采用的值。所有旧通知保留，资料或版本变化后会重新核对。</p><form id="xixu-temporal-review" class="tide-form">'+groups.map((group,index)=>'<fieldset><legend>'+esc(group.subject)+'</legend><label class="tide-field">适用事项／批次<input name="scope-'+index+'" maxlength="80" required placeholder="例如：本学期软件工程一班期末"></label><label class="tide-field">当前以哪条为准<select name="choice-'+index+'">'+group.claims.flatMap((claim,claimIndex)=>claim.dates.map((value,valueIndex)=>'<option value="'+esc(JSON.stringify([claimIndex,valueIndex]))+'">'+esc(value+' · '+(claim.at||'原始时间未知')+' · '+claim.ref.title)+'</option>')).join('')+'</select></label>'+group.claims.map(claim=>'<blockquote>'+esc(claim.evidence)+'</blockquote>').join('')+'</fieldset>').join('')+'<label class="xixu-check-line"><input type="checkbox" name="verified" required>我已核对这些来源和适用批次，同意保存所选依据</label><button class="tide-primary">保存核对依据</button></form>','temporal-review');
  }
  async function temporalVerifySource(claim){
    const ref=claim.ref;
    if(ref.recordType==='external'){
      if(!knowledgeEnabled())throw Error('请先连接原电脑以核对通知版本');const [document_id,version,start,end]=String(ref.id).split(':');await knowledgeCall('excerpt',{document_id,version,start:Number(start),end:Number(end)});return;
    }
    const record=ref.recordType==='note'?notes.find(item=>item.id===ref.id):ref.recordType==='task'?tasks.find(item=>item.id===ref.id):ref.recordType==='course'?courses.find(item=>item.id===ref.id):ref.recordType==='scratch'?scratchEntries.find(item=>item.id===ref.id):null;
    if(!record||!ref.baseVersion||assistantStable(record)!==ref.baseVersion)throw Error('通知原文已变化，请重新查询后核对');
  }
  async function temporalSaveReview(form){
    const groups=temporalReviewGroups,token=assistantSheet?.token;if(!groups?.length)throw Error('本次核对已失效');const data=new FormData(form);if(!data.has('verified'))throw Error('请先核对适用批次');
    const decisions=[];for(let index=0;index<groups.length;index++){
      const group=groups[index],scope=String(data.get('scope-'+index)||'').trim(),choice=JSON.parse(String(data.get('choice-'+index)||'null'));
      if(!scope||scope.length>80||!Array.isArray(choice)||choice.length!==2)throw Error('请完整核对通知和适用批次');
      const claim=group.claims[choice[0]],value=claim?.dates[choice[1]];if(typeof value!=='string')throw Error('所选通知已经失效');
      for(const source of group.claims)await temporalVerifySource(source);
      decisions.push({id:uid(),subject:group.subject,field:claim.field,scope,value,at:new Date().toISOString(),fingerprints:group.claims.map(temporalFingerprint).sort(),chosen:temporalFingerprint(claim),evidence:claim.evidence,sourceAt:claim.at,sourceTitle:claim.ref.title});
    }
    if(temporalReviewGroups!==groups||assistantSheet?.kind!=='temporal-review'||assistantSheet?.token!==token)throw Error('已取消核对，本次没有保存');
    const state=assistantState(),previous=state.temporalResolutions||[];state.temporalResolutions=[...previous,...decisions];if(persist()===false){state.temporalResolutions=previous;throw Error('核对依据未保存')}
    temporalReviewGroups=null;assistantCloseSheet();notify('通知依据已保存；再次提问可按所核对批次追溯新旧变化');
  }
  const semanticSearchBeforeAssistant=semanticAgentSearch;
  Object.assign(agentRagSynonyms,{开题:'开题报告 提交',汇报:'presentation 展示',改期:'延期 调整 改为'});
  semanticAgentSearch=function(query){
    const result=semanticSearchBeforeAssistant(query);result.temporal=assistantTemporalClaims(result);return result;
  };
  // Completion is an observed user marking, never a claim about work/sleep.
  let assistantSavedSources=null,assistantSavedDone=null,assistantPersistBusy=false;
  const persistBeforeIntelligence=persist;
  const loadBeforeIntelligence=loadSaved;
  loadSaved=function(){loadBeforeIntelligence();assistantSavedSources=new Map(assistantSourceRecords().map(item=>[item.id,{at:item.at,text:item.text}]));assistantSavedDone=new Map(tasks.map(item=>[item.id,Boolean(item.done)]))};
  persist=function(){
    if(assistantPersistBusy)return persistBeforeIntelligence();
    assistantPersistBusy=true;
    try{
      const state=assistantState(),done=new Map(tasks.map(task=>[task.id,Boolean(task.done)]));
      if(assistantSavedDone)for(const task of tasks){if(assistantSavedDone.has(task.id)&&assistantSavedDone.get(task.id)!==Boolean(task.done)){const entries=state.taskProgress[task.id]||(state.taskProgress[task.id]=[]);entries.push({at:new Date().toISOString(),kind:task.done?'marked_done':'reopened'});if(entries.length>1000)entries.splice(0,entries.length-1000)}}
      const sources=assistantSourceRecords(),current=new Map(sources.map(item=>[item.id,{at:item.at,text:item.text}])),changed=assistantSavedSources?sources.filter(item=>{const old=assistantSavedSources.get(item.id);return !old||old.at!==item.at||old.text!==item.text}):[];
      persistBeforeIntelligence();
      const saved=lastSaved===JSON.stringify(snapshot());
      if(saved){assistantSavedDone=done;assistantSavedSources=current;if(changed.length)setTimeout(()=>assistantMineRecords(changed),0)}
      return saved;
    }finally{assistantPersistBusy=false}
  };
  function assistantMailboxDue(task){return validCalendarDate(task.date)?Date.parse(task.date+'T'+(assistantClock(task.time)?task.time:'23:59')+':00+08:00'):NaN}
  function assistantMailboxFacts(task){
    const state=assistantState(),progress=state.taskProgress[task.id]||[],truth=state.mailbox.truths.filter(item=>item.allowReuse&&item.type===task.type).at(-1);
    const facts=[{kind:'task',id:task.id,value:task.title},{kind:'deadline',id:task.id,value:task.date+(task.time?' '+task.time:'（未记录时刻）')},{kind:'status',id:task.id,value:task.done?'已标记完成':'未标记完成'}];
    if(progress.length)facts.push({kind:'progress',id:task.id,value:progress.at(-1).at+' '+progress.at(-1).kind});
    if(truth)facts.push({kind:'user_quote',id:truth.id,value:truth.text,at:truth.at,taskId:truth.taskId});
    return facts;
  }
  function assistantMailboxBody(task,stage,tone,facts){
    const deadline=facts.find(item=>item.kind==='deadline').value,quote=facts.find(item=>item.kind==='user_quote'),status=facts.find(item=>item.kind==='status').value;
    const opener={gentle:'想轻轻提醒你，给之后的自己留一点余地。',plain:'我只把现有记录放到你面前，让你自己决定从哪里开始。',direct:'先看事实，再决定要不要继续放着。'}[tone];
    const action=task.note?('打开“'+task.title+'”的备注，标出第一条还需要核对的内容。'):('打开“'+task.title+'”，写下一个你愿意先做的小动作。');
    return '现在的你：\n\n这是一封从“'+task.title+'”截止前夕写给你的推演信，不是已经发生的回忆。记录的截止时间是 '+deadline+'。\n\n'+opener+'目前它'+status+'；这不代表我知道你的实际进度，也不代表你一定会熬夜。\n\n'+(quote?'你在 '+quote.at+' 留下过一句原话：“'+quote.value+'”。这句话来自你本人，出处保留在信里。':'这里还没有可引用的旧承诺，我不会替你编一段经历。')+'\n\n如果现在愿意，只做一件小事：'+action+'不用在这封信里排时间表。\n\n——站在这件事截止前夕、希望被你照顾一下的自己\n（基于真实记录的未来视角；'+({seven:'进入七天提醒',mid:'阶段提醒',eve:'前夜提醒'})[stage]+'）';
  }
  function assistantMailboxGenerate(now=Date.now()){
    const state=assistantState(),box=state.mailbox;if(!box.enabled)return;
    if(box.letters.length>=1000)return;
    const weekStart=mondayOf(localDay()),count=box.letters.filter(letter=>{const date=new Date(letter.createdAt);return Number.isFinite(date.getTime())&&new Date(date.getTime()+8*3600000).toISOString().slice(0,10)>=weekStart}).length;if(count>=2)return;
    let remaining=2-count;
    for(const task of tasks.slice().sort((a,b)=>assistantMailboxDue(a)-assistantMailboxDue(b))){
      const enrollment=box.enrolled[task.id];if(!remaining||!enrollment||enrollment.muted||task.done)continue;
      const due=assistantMailboxDue(task),days=(due-now)/86400000;if(!Number.isFinite(due)||days<0||days>7)continue;
      const stage=days<=1?'eve':days<=3.5?'mid':'seven',letters=box.letters.filter(item=>item.taskId===task.id),progress=state.taskProgress[task.id]||[];
      if(letters.length>=3||letters.some(item=>item.stage===stage)||stage==='mid'&&progress.some(item=>item.at>enrollment.at))continue;
      // At most one currently relevant stage. Never backfill missed letters.
      const facts=assistantMailboxFacts(task);box.letters.push({id:uid(),taskId:task.id,stage,tone:box.tone,createdAt:new Date(now).toISOString(),deadline:task.date+' '+(task.time||''),taskVersion:assistantStable({title:task.title,date:task.date,time:task.time}),body:assistantMailboxBody(task,stage,box.tone,facts),facts,openedAt:'',reply:'',replyAt:'',review:null});remaining--;
    }
  }
  function assistantShowMailbox(){
    assistantMailboxGenerate();persist();const box=assistantState().mailbox;
    assistantShowSheet('时间信箱','<p>来信取材于记录，用未来视角推演。每周最多两封、每件事最多三封；不推断你的睡眠和实际完成情况。</p><form id="xixu-mailbox-settings" class="tide-form"><label class="xixu-check-line"><input type="checkbox" name="enabled" '+(box.enabled?'checked':'')+'>启用时间信箱</label><label class="tide-field">语气<select name="tone"><option value="gentle" '+(box.tone==='gentle'?'selected':'')+'>温柔</option><option value="plain" '+(box.tone==='plain'?'selected':'')+'>实话</option><option value="direct" '+(box.tone==='direct'?'selected':'')+'>直接（不羞辱）</option></select></label><button class="tide-secondary">保存偏好</button></form><details><summary>选择重要事项</summary>'+tasks.filter(item=>!item.done&&validCalendarDate(item.date)).map(task=>'<label class="xixu-check-line"><input type="checkbox" data-mailbox-task="'+esc(task.id)+'" '+(box.enrolled[task.id]&&!box.enrolled[task.id].muted?'checked':'')+'>'+esc(task.title)+' · '+esc(task.date)+'</label>').join('')+'</details><div class="xixu-mailbox">'+box.letters.slice().reverse().map(letter=>'<button class="xixu-envelope '+(letter.openedAt?'is-open':'')+'" data-action="assistant-letter" data-id="'+esc(letter.id)+'">'+icon(letter.openedAt?'mail-open':'mail')+'<span>'+esc(letter.facts.find(item=>item.kind==='task')?.value||'一件重要的事')+'</span><time>'+esc(letter.createdAt.slice(0,10))+'</time>'+(letter.openedAt?'':'<i aria-label="未拆封"></i>')+'</button>').join('')+'</div>','mailbox');
  }
  function assistantOpenLetter(id){
    const box=assistantState().mailbox,letter=box.letters.find(item=>item.id===id);if(!letter)return;
    if(!letter.openedAt)letter.openedAt=new Date().toISOString();const task=tasks.find(item=>item.id===letter.taskId),changed=task&&assistantStable({title:task.title,date:task.date,time:task.time})!==letter.taskVersion,due=task&&assistantMailboxDue(task)<=Date.now();persist();
    assistantShowSheet('一封给现在的信','<article class="xixu-letter"><p class="xixu-letter-body">'+esc(letter.body)+'</p>'+(changed?'<p role="status">事项后来改过：这封信保留寄出时的记录。现在截止 '+esc(task.date+' '+task.time)+'。</p>':'')+'<details><summary>核对事实出处</summary><ul>'+letter.facts.map(fact=>'<li>'+esc(fact.kind)+' · '+esc(fact.value)+' · '+esc(fact.id)+'</li>').join('')+'</ul></details>'+(letter.reply?'<blockquote>你封存的回信：'+esc(letter.reply)+'<br><time>'+esc(letter.replyAt)+'</time></blockquote>':'<form id="xixu-letter-reply" data-id="'+esc(id)+'" class="tide-form"><label class="tide-field">给之后的自己回一句话<textarea name="reply" maxlength="1000" required></textarea></label><button class="tide-primary">封存回信</button><p>回信不会自动生成任务。</p></form>')+(due?'<section><h3>到期对账</h3><p>现在的记录：'+(task.done?'已标记完成':'尚未标记完成')+'。实际完成与睡眠情况由你补充。</p>'+(letter.review?'<p>'+esc(letter.review.receipt||'这次实际情况以你的对账为准。')+'</p><blockquote>'+esc(letter.review.text)+'</blockquote>':'<form id="xixu-letter-review" data-id="'+esc(id)+'" class="tide-form"><label class="tide-field">这次实际怎么样？<textarea name="truth" maxlength="1000" required></textarea></label><label class="xixu-check-line"><input type="checkbox" name="reuse">允许在同类事项来信中原样引用这句话</label><button class="tide-secondary">封存这次对账</button></form>')+'</section>':'')+'</article>','letter');
  }
  const settingsBeforeIntelligence=renderSettings;
  function assistantMailboxTick(){if(document.hidden||storageBlocked)return;const count=assistantState().mailbox.letters.length;assistantMailboxGenerate();if(assistantState().mailbox.letters.length!==count){persist();if(!panel)render(false)}}
  setTimeout(assistantMailboxTick,0);setInterval(assistantMailboxTick,60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)assistantMailboxTick()});
  renderSettings=function(){return settingsBeforeIntelligence()+'<div class="tide-section"><h2>记录里的线索</h2></div><div class="xixu-setting-actions"><button data-action="assistant-suggestions">'+icon('scan-search')+'<span>待核对的事项</span>'+icon('chevron-right')+'</button><button data-action="assistant-mailbox">'+icon('mail')+'<span>时间信箱</span>'+icon('chevron-right')+'</button></div>'};
  const todayBeforeIntelligence=renderToday;
  renderToday=function(){const box=assistantState().mailbox,unread=box.letters.filter(item=>!item.openedAt).length,pending=assistantState().commitments.filter(item=>item.status==='suggested'&&!assistantTaskMatch(item)).length;return todayBeforeIntelligence()+(unread||pending?'<div class="xixu-quiet-entries">'+(unread?'<button data-action="assistant-mailbox">'+icon('mail')+'有 '+unread+' 封未拆的信</button>':'')+(pending?'<button data-action="assistant-suggestions">'+icon('scan-search')+pending+' 件事待核对</button>':'')+'</div>':'')};
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    const action=button.dataset.action;
    if(action==='assistant-temporal-review')try{assistantReviewTemporal()}catch(error){notify(error.message)}
    else if(action==='assistant-suggestions')assistantShowCommitments();
    else if(action==='assistant-mine'){if(!assistantMiningBusy)assistantMineRecords(assistantSourceRecords())}
    else if(action==='assistant-suggestion-dismiss'){const item=assistantState().commitments.find(value=>value.id===button.dataset.id);if(item){item.status='dismissed';persist();assistantShowCommitments()}}
    else if(action==='assistant-suggestion-review')assistantReviewSuggestion(button.dataset.id).catch(error=>notify(error.message));
    else if(action==='assistant-computer-suggestions')assistantComputerSuggestions().catch(error=>notify(error.message));
    else if(action==='assistant-mailbox')assistantShowMailbox();
    else if(action==='assistant-letter')assistantOpenLetter(button.dataset.id);
  },true);
  root.addEventListener('change',event=>{const id=event.target.dataset?.mailboxTask;if(!id)return;const box=assistantState().mailbox,previous=box.enrolled[id];box.enrolled[id]={at:previous?.at||new Date().toISOString(),muted:!event.target.checked};persist()});
  root.addEventListener('submit',async event=>{
    const form=event.target;if(form.id==='xixu-temporal-review'){event.preventDefault();event.stopImmediatePropagation();const button=form.querySelector('button');button.disabled=true;temporalSaveReview(form).catch(error=>{notify(error.message);if(button.isConnected)button.disabled=false});return}if(!['xixu-suggestion-form','xixu-mailbox-settings','xixu-letter-reply','xixu-letter-review'].includes(form.id))return;event.preventDefault();event.stopImmediatePropagation();const data=new FormData(form),box=assistantState().mailbox;
    try{
      if(form.id==='xixu-suggestion-form'){
        const candidate=assistantState().commitments.find(item=>item.id===form.dataset.id);await assistantVerifyCommitment(candidate);
        const args={title:String(data.get('title')).trim(),date:String(data.get('date')),time:String(data.get('time')),type:candidate.type,note:'来源：'+candidate.sourceTitle+'\n'+candidate.evidence};
        const action=assistantTool('create_event',args);assistantPreviewPlan(action,null);assistantPlan.commitmentId=candidate.id;
      }else if(form.id==='xixu-mailbox-settings'){box.enabled=data.has('enabled');box.tone=String(data.get('tone'));persist();assistantShowMailbox()}
      else{const letter=box.letters.find(item=>item.id===form.dataset.id);if(!letter)throw Error('这封信已不存在');
        if(form.id==='xixu-letter-reply'){if(letter.reply)throw Error('回信已经封存');letter.reply=String(data.get('reply')||'').trim();if(!letter.reply)throw Error('先写一句话');letter.replyAt=new Date().toISOString()}
        else{const task=tasks.find(item=>item.id===letter.taskId);if(!task||assistantMailboxDue(task)>Date.now()||letter.review)throw Error('尚未到期或已经对账');const text=String(data.get('truth')||'').trim();if(!text)throw Error('请写下实际情况');if(box.truths.length>=10000)throw Error('对账档案已满，请先完整备份');const truth={id:uid(),taskId:task.id,type:task.type,text,at:new Date().toISOString(),allowReuse:data.has('reuse')};box.truths.push(truth);const mark=(assistantState().taskProgress[task.id]||[]).filter(item=>item.kind==='marked_done').at(-1),early=mark&&Date.parse(mark.at)<=assistantMailboxDue(task);letter.review={truthId:truth.id,text,at:truth.at,recordedDone:Boolean(task.done),receipt:task.done?(early?'记录显示你在截止前标记完成了。谢谢现在的你替这件事收好尾。':'这件事已标记完成，谢谢你回来留下这句真话。是否提前完成，以你的实际记录为准。'):'这一次先把来信、回信和实际情况放在一起。没有新的指责，下一次仍可以从一个小动作开始。'}}
        persist();assistantOpenLetter(letter.id);
      }
    }catch(error){notify(error.message||'未保存，请重新核对')}
  },true);
