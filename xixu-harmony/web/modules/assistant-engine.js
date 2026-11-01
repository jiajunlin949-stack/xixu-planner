  // Persistent domain model. Adapters own transports and DOM; this engine owns
  // admission, mandates, assignments and delivery receipts. No remote I/O here.
  const ASSISTANT_ENGINE_LIVE=new Set(['queued','running','awaiting_send']);
  const ASSISTANT_ENGINE_ATTENTION=new Set(['awaiting_send','awaiting_answer','review','failed','interrupted','blocked']);
  const ASSISTANT_ENGINE_TERMINAL=new Set(['completed','stopped','revoked','dismissed','superseded']);
  const ASSISTANT_ENGINE_STATES=new Set([...ASSISTANT_ENGINE_LIVE,...ASSISTANT_ENGINE_ATTENTION,'waiting',...ASSISTANT_ENGINE_TERMINAL]);
  function assistantEngineInitial(){return {version:1,revision:0,policy:{revision:1,paused:false,concurrency:2,cloud:true,materials:true,clock:true},triggers:[],threads:[],tickets:[],outbox:[],events:[],cursors:[]}}
  function validateAssistantEngine(state){
    if(state===undefined)return;
    const fail=()=>{throw Error('助手任务档案无效，未覆盖原资料')},date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
    if(!state||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0)fail();
    const p=state.policy;if(!p||!Number.isSafeInteger(p.revision)||p.revision<1||![1,2].includes(p.concurrency)||['paused','cloud','materials','clock'].some(key=>typeof p[key]!=='boolean'))fail();
    for(const [key,max] of [['triggers',2000],['threads',400],['tickets',300],['outbox',300],['events',500]]){
      if(!Array.isArray(state[key])||state[key].length>max)fail();const ids=new Set();
      for(const item of state[key]){if(!item||typeof item.id!=='string'||!item.id||item.id.length>200||ids.has(item.id))fail();ids.add(item.id)}
    }
    const threads=new Set(state.threads.map(item=>item.id)),tickets=new Set(state.tickets.map(item=>item.id)),triggers=new Set(state.triggers.map(item=>item.id));
    const ref=value=>value&&typeof value.source==='string'&&typeof value.id==='string'&&typeof value.version==='string';
    for(const item of state.triggers)if(typeof item.key!=='string'||!threads.has(item.threadId)||!['conversation','material','clock'].includes(item.source)||!['owner','imported','clock'].includes(item.actor)||!date(item.at)||!ref(item.ref))fail();
    for(const item of state.threads)if(typeof item.sourceId!=='string'||!['conversation','material','clock'].includes(item.source)||!Array.isArray(item.correlations)||item.correlations.length>20||item.correlations.some(id=>typeof id!=='string'))fail();
    for(const item of state.tickets){
      if(!threads.has(item.threadId)||!triggers.has(item.triggerId)||!ASSISTANT_ENGINE_STATES.has(item.status)||!date(item.createdAt)||!date(item.updatedAt)||typeof item.conversationId!=='string'||typeof item.userId!=='string'||typeof item.acknowledged!=='boolean')fail();
      const mandate=item.mandate;if(!mandate||!Number.isSafeInteger(mandate.policyRevision)||!['owner','imported','clock'].includes(mandate.actor)||!['conversation','material','clock'].includes(mandate.source)||!Array.isArray(mandate.scope)||mandate.scope.some(value=>!['local_read','suggest','request_cloud'].includes(value))||typeof mandate.revoked!=='boolean')fail();
      if(!Array.isArray(item.inputs)||item.inputs.length>40||item.inputs.some(value=>!ref(value))||!Array.isArray(item.subscriptions)||item.subscriptions.length>20||item.subscriptions.some(value=>!value||!threads.has(value.threadId)||!['origin','context'].includes(value.mode)))fail();
      if(!Array.isArray(item.assignments)||item.assignments.length>20||item.assignments.some(a=>!a||typeof a.id!=='string'||!['running','ended','interrupted'].includes(a.status)||!date(a.startedAt)||typeof a.stage!=='string'||!date(a.progressAt)))fail();
      if(item.result!==undefined&&(!item.result||typeof item.result.answer!=='string'||item.result.answer.length>64000||!item.result.action||typeof item.result.action.type!=='string'))fail();
    }
    for(const item of state.outbox)if(!tickets.has(item.ticketId)||typeof item.messageId!=='string'||typeof item.conversationId!=='string'||typeof item.userId!=='string'||!['pending','delivered','dropped'].includes(item.status)||!date(item.at)||!item.result||typeof item.result.answer!=='string')fail();
    for(const item of state.events)if(!date(item.at)||typeof item.kind!=='string'||typeof item.ticketId!=='string')fail();
    if(state.cursors!==undefined){if(!Array.isArray(state.cursors)||state.cursors.length>10000||state.cursors.some(item=>!item||typeof item.source!=='string'||typeof item.id!=='string'||typeof item.version!=='string'))fail()}
    if(JSON.stringify(state).length>5000000)throw Error('助手任务档案容量已满，请先备份并整理已完成的任务');
  }
  function createAssistantEngine({read,write,save,now=()=>new Date().toISOString(),newId=uid}){
    const clone=value=>JSON.parse(JSON.stringify(value));
    const get=()=>read()||assistantEngineInitial();
    function transact(change){
      const previous=read(),next=clone(get());if(!next.cursors)next.cursors=[];const result=change(next);next.revision++;
      validateAssistantEngine(next);write(next);
      try{if(save()===false)throw Error('助手任务未保存，请检查本机存储后重试')}
      catch(error){write(previous);throw error}
      return clone(result===undefined?null:result);
    }
    const ticket=(state,id)=>{const item=state.tickets.find(item=>item.id===id);if(!item)throw Error('这项任务已不存在');return item};
    const event=(state,kind,id='')=>{state.events.push({id:newId(),at:now(),kind,ticketId:id});if(state.events.length>500)state.events.splice(0,state.events.length-500)};
    const allowed=(state,item)=>Boolean(item&&!item.mandate.revoked&&!(item.mandate.source==='material'&&!state.policy.materials)&&!(item.mandate.source==='clock'&&!state.policy.clock));
    function prune(state){
      // Only settled, acknowledged work may be discarded. Pending work is never
      // evicted to admit new work; callers get a capacity error instead.
      state.outbox=state.outbox.filter(item=>item.status==='pending');
      while(state.tickets.length>=280){const index=state.tickets.findIndex(item=>ASSISTANT_ENGINE_TERMINAL.has(item.status)&&item.acknowledged&&!state.outbox.some(effect=>effect.ticketId===item.id));if(index<0)break;state.tickets.splice(index,1)}
      const needed=new Set(state.tickets.map(item=>item.triggerId));
      for(const item of state.tickets)for(const input of item.inputs)if(input.triggerId)needed.add(input.triggerId);
      if(state.triggers.length>1700||state.threads.length>=350){
        // Retain every task's evidence and a small recent orphan history. An
        // ever-growing list of old conversations must not exhaust thread slots.
        const keepThreads=new Set(state.tickets.flatMap(item=>[item.threadId,...item.subscriptions.map(value=>value.threadId)]));
        const keepTriggers=new Set(needed);let extras=0;
        for(const item of state.triggers.slice().reverse()){
          if(needed.has(item.id))continue;
          if(extras>=500||!keepThreads.has(item.threadId)&&keepThreads.size>=380)continue;
          keepThreads.add(item.threadId);keepTriggers.add(item.id);extras++;
        }
        state.triggers=state.triggers.filter(item=>keepTriggers.has(item.id));
      }
      const threadIds=new Set([...state.triggers.map(item=>item.threadId),...state.tickets.flatMap(item=>item.subscriptions.map(value=>value.threadId))]);
      state.threads=state.threads.filter(item=>threadIds.has(item.id));
      for(const thread of state.threads)thread.correlations=thread.correlations.filter(id=>threadIds.has(id));
    }
    function receive(input){
      if(!['conversation','material','clock'].includes(input.source))throw Error('未登记的资料来源');
      const actor={conversation:'owner',material:'imported',clock:'clock'}[input.source];
      if(input.source==='material'&&!get().policy.materials||input.source==='clock'&&!get().policy.clock)return {ignored:true};
      const cursor=get().cursors?.find(item=>item.source===input.source&&item.id===input.ref.id);
      if(cursor&&input.source!=='conversation'&&(cursor.version===input.ref.version||input.source==='clock'&&Number(cursor.version)>=Number(input.ref.version)))return {duplicate:true,ticketId:''};
      const existing=get().triggers.find(item=>item.key===input.key&&item.source===input.source);
      if(existing)return {duplicate:true,ticketId:get().tickets.find(item=>item.triggerId===existing.id||item.inputs.some(ref=>ref.triggerId===existing.id))?.id||''};
      return transact(state=>{
        if(input.source==='material'&&!state.policy.materials||input.source==='clock'&&!state.policy.clock)return {ignored:true};
        prune(state);let thread=state.threads.find(item=>item.source===input.source&&item.sourceId===input.thread);
        if(!thread){thread={id:newId(),source:input.source,sourceId:input.thread,correlations:[]};state.threads.push(thread)}
        const trigger={id:newId(),key:input.key,source:input.source,actor,threadId:thread.id,ref:clone(input.ref),at:now()};state.triggers.push(trigger);
        if(input.source!=='conversation'){const index=state.cursors.findIndex(item=>item.source===input.source&&item.id===input.ref.id),value={source:input.source,id:input.ref.id,version:input.ref.version};if(index<0)state.cursors.push(value);else state.cursors[index]=value}
        if(input.source==='material')for(const previous of state.tickets){
          if(previous.mandate.source!=='material'||ASSISTANT_ENGINE_TERMINAL.has(previous.status))continue;
          if(!previous.inputs.some(ref=>ref.id===input.ref.id&&ref.version!==input.ref.version))continue;
          previous.status='superseded';previous.supersededBy=trigger.id;previous.mandate.revoked=true;previous.acknowledged=true;previous.updatedAt=now();
          const attempt=previous.assignments.at(-1);if(attempt?.status==='running'){attempt.status='ended';attempt.endedAt=now()}
          event(state,'source_superseded',previous.id);
        }
        // Evidence subscriptions do not lend authority. Only an owner message
        // on the origin thread, explicitly attached or answering a question,
        // can resume an existing task.
        let work=input.source==='conversation'?state.tickets.find(item=>item.id===input.ticketId&&item.threadId===thread.id):null;
        if(input.ticketId&&(!work||!allowed(state,work)||['stopped','revoked','review'].includes(work.status)))throw Error('这项任务不能直接续接，请新建请求或先处理待确认修改');
        if(!work&&input.source==='conversation')work=state.tickets.slice().reverse().find(item=>item.threadId===thread.id&&item.status==='awaiting_answer'&&allowed(state,item));
        if(work){
          if(ASSISTANT_ENGINE_LIVE.has(work.status))throw Error('这项任务仍在处理，请先停止或等待完成');
          if(work.inputs.length>=40||work.assignments.length>=20)throw Error('这项任务续接次数较多，请新建请求，历史仍然保留');
          work.inputs.push({...clone(input.ref),triggerId:trigger.id,authority:'owner'});work.userId=input.ref.id;work.status='queued';work.updatedAt=now();work.acknowledged=false;work.result=undefined;work.contextChanged=false;event(state,'resumed',work.id);
        }else{
          work={id:newId(),threadId:thread.id,triggerId:trigger.id,conversationId:input.source==='conversation'?input.thread:'',userId:input.source==='conversation'?input.ref.id:'',status:'queued',createdAt:now(),updatedAt:now(),acknowledged:false,mandate:{policyRevision:state.policy.revision,actor,source:input.source,scope:input.source==='conversation'?['local_read','suggest','request_cloud']:['local_read','suggest'],revoked:false},inputs:[{...clone(input.ref),triggerId:trigger.id,authority:actor}],subscriptions:[{threadId:thread.id,mode:'origin'}],assignments:[]};state.tickets.push(work);event(state,'accepted',work.id);
        }
        for(const other of state.tickets)if(other.id!==work.id&&!ASSISTANT_ENGINE_TERMINAL.has(other.status)&&other.subscriptions.some(sub=>sub.threadId===thread.id&&sub.mode==='context')){other.contextChanged=true;other.updatedAt=now()}
        return {ticketId:work.id,triggerId:trigger.id};
      });
    }
    function assign(id){return transact(state=>{
      const work=ticket(state,id);if(state.policy.paused||work.status!=='queued'||!allowed(state,work))throw Error('任务当前不可执行');
      if(work.assignments.length>=20)throw Error('任务尝试次数已满，请新建请求');
      const attempt={id:newId(),status:'running',stage:'local',startedAt:now(),progressAt:now()};work.assignments.push(attempt);work.status='running';work.contextChanged=false;work.updatedAt=now();event(state,'assigned',id);return attempt;
    })}
    function current(state,id,attemptId){const work=ticket(state,id);if(!allowed(state,work)||!ASSISTANT_ENGINE_LIVE.has(work.status)||work.assignments.at(-1)?.id!==attemptId)throw Error('这次执行已失效');return work}
    function checkpoint(id,attemptId,stage,refs=[]){return transact(state=>{
      const work=current(state,id,attemptId);work.status=stage==='approval'?'awaiting_send':'running';Object.assign(work.assignments.at(-1),{stage,progressAt:now()});work.updatedAt=now();
      if(refs.length)work.contextRefs=clone(refs.slice(0,30));event(state,'checkpoint:'+stage,id);
    })}
    function complete(id,attemptId,result){return transact(state=>{
      const work=current(state,id,attemptId),attempt=work.assignments.at(-1);attempt.status='ended';attempt.endedAt=now();attempt.stage='finished';
      work.result=clone(result);work.updatedAt=now();work.acknowledged=false;
      work.status=result.cancelled?'stopped':result.error?'failed':result.needsAnswer?'awaiting_answer':result.action.type!=='none'?'review':'completed';
      if(work.status==='stopped')work.mandate.revoked=true;
      let effect=null;if(work.conversationId){effect={id:newId(),ticketId:id,assignmentId:attemptId,messageId:newId(),conversationId:work.conversationId,userId:work.userId,inputAt:work.inputs.filter(ref=>ref.id===work.userId).at(-1)?.at||'',result:clone(result),status:'pending',at:now()};state.outbox.push(effect);work.resultMessageId=effect.messageId}else if(work.status==='completed')work.acknowledged=true;
      event(state,'reported:'+work.status,id);return effect;
    })}
    function acknowledge(effectId,status='delivered'){
      if(!['delivered','dropped'].includes(status))throw Error('交付状态无效');
      if(!get().outbox.some(item=>item.id===effectId&&item.status==='pending'))return;
      return transact(state=>{
        const effect=state.outbox.find(item=>item.id===effectId);effect.status=status;effect.deliveredAt=now();const work=ticket(state,effect.ticketId);
        const currentReport=work.result&&work.resultMessageId===effect.messageId&&work.userId===effect.userId&&(!effect.assignmentId||work.assignments.at(-1)?.id===effect.assignmentId);
        if(status==='dropped'&&currentReport&&!ASSISTANT_ENGINE_LIVE.has(work.status)){
          work.status='dismissed';work.updatedAt=now();work.result={...work.result,action:{type:'none'},choices:[],deliveryDropped:true};
        }
        if(ASSISTANT_ENGINE_TERMINAL.has(work.status))work.acknowledged=true;event(state,'delivery:'+status,work.id);
      });
    }
    function control(id,action){return transact(state=>{
      const work=ticket(state,id);
      if(action==='retry'){
        if(!['interrupted','failed','blocked'].includes(work.status)||!allowed(state,work))throw Error('这项任务当前不能恢复');
        work.status='queued';work.acknowledged=false;work.result=undefined;
      }else if(action==='stop'){
        work.status='stopped';work.mandate.revoked=true;work.acknowledged=true;
        const attempt=work.assignments.at(-1);if(attempt?.status==='running'){attempt.status='ended';attempt.endedAt=now()}
      }else if(action==='dismiss'){
        if(ASSISTANT_ENGINE_LIVE.has(work.status))throw Error('请先停止正在执行的任务');work.status='dismissed';work.acknowledged=true;if(work.result)work.result.action={type:'none'};
      }else if(action==='interrupt'){
        if(!ASSISTANT_ENGINE_LIVE.has(work.status))return;work.status='interrupted';const attempt=work.assignments.at(-1);if(attempt?.status==='running'){attempt.status='interrupted';attempt.endedAt=now()}
      }else throw Error('不支持的任务操作');
      work.updatedAt=now();event(state,action,id);
    })}
    function recover(){
      if(read()&&!get().tickets.some(work=>['running','awaiting_send'].includes(work.status)))return;
      return transact(state=>{
      for(const work of state.tickets)if(['running','awaiting_send'].includes(work.status)){work.status='interrupted';work.updatedAt=now();const attempt=work.assignments.at(-1);if(attempt?.status==='running'){attempt.status='interrupted';attempt.endedAt=now()}event(state,'recovered_interruption',work.id)}
      });
    }
    function policy(patch){return transact(state=>{
      for(const key of Object.keys(patch))if(!['paused','concurrency','cloud','materials','clock'].includes(key))throw Error('未知的任务设置');
      Object.assign(state.policy,patch,{revision:state.policy.revision+1});
      for(const work of state.tickets)if(!ASSISTANT_ENGINE_TERMINAL.has(work.status)&&!allowed(state,work)){work.status='revoked';work.mandate.revoked=true;work.updatedAt=now()}
      event(state,'policy_changed');return state.policy;
    })}
    function prepareConfirmation(id,receipt=null){
      // Pure preparation for the application's existing calendar transaction.
      // The caller persists these rows and the calendar snapshot together.
      const state=clone(get()),work=ticket(state,id);
      if(work.status!=='review'||!allowed(state,work)||work.contextChanged)throw Error('任务或关联资料已改变，请重新核对');
      work.status='completed';work.acknowledged=true;work.updatedAt=now();
      work.result={...work.result,answer:'已按核对内容保存，可以在变更记录中追溯或撤回。',action:{type:'none'},choices:[],...(receipt?{receipt:clone(receipt)}:{})};
      event(state,'confirmed',id);state.revision++;validateAssistantEngine(state);return state;
    }
    function attach(id,threadId){return transact(state=>{const work=ticket(state,id);if(!state.threads.some(item=>item.id===threadId))throw Error('资料来源已不存在');if(work.subscriptions.some(item=>item.threadId===threadId))return;if(work.subscriptions.length>=20)throw Error('关联来源已满');work.subscriptions.push({threadId,mode:'context'});const origin=state.threads.find(item=>item.id===work.threadId);if(!origin.correlations.includes(threadId))origin.correlations=[...origin.correlations,threadId].slice(-20);work.contextChanged=true;event(state,'context_attached',id)})}
    return {state:get,receive,assign,checkpoint,complete,acknowledge,control,recover,policy,attach,prepareConfirmation,allowed:(item)=>allowed(get(),item)};
  }
