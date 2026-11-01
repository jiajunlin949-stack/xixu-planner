  // Shared domain layer. All writes remain local, previewed and version checked.
  const assistantClone=value=>JSON.parse(JSON.stringify(value));
  function assistantCanonical(value){if(Array.isArray(value))return value.map(assistantCanonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,assistantCanonical(value[key])]));return value}
  const assistantStable=value=>JSON.stringify(assistantCanonical(value));
  const assistantClock=value=>/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value||''));
  const assistantFormatMinute=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  let assistantSheet=null,assistantSheetFocus=null,assistantPlan=null;
  function assistantState(){
    const preferences=agentPreferences;
    if(!preferences.intelligence)preferences.intelligence={version:1,pendingSlots:{},journal:[],traces:[],commitments:[],taskProgress:{},mailbox:{enabled:false,tone:'plain',enrolled:{},letters:[],truths:[]}};
    return preferences.intelligence;
  }
  function validateAssistantState(value){
    if(value===undefined)return;
    if(!value||value.version!==1||typeof value!=='object'||Array.isArray(value))throw Error('助手记录版本不受支持，未覆盖原数据。');
    for(const [key,max] of [['journal',1000],['traces',300],['commitments',10000]])if(!Array.isArray(value[key])||value[key].length>max)throw Error('助手记录不完整或超出容量，请保留原备份。');
    if(!value.pendingSlots||typeof value.pendingSlots!=='object'||Array.isArray(value.pendingSlots)||!value.taskProgress||typeof value.taskProgress!=='object'||Array.isArray(value.taskProgress))throw Error('助手状态不完整。');
    for(const entry of value.journal)if(!entry||typeof entry.id!=='string'||!Array.isArray(entry.deltas)||entry.deltas.some(delta=>!delta||!['courses','lessons','tasks','notes'].includes(delta.collection)||typeof delta.id!=='string'||delta.before!==null&&typeof delta.before!=='object'||delta.after!==null&&typeof delta.after!=='object'))throw Error('变更档案无效，未覆盖数据。');
    if(value.privateTerms!==undefined&&(!Array.isArray(value.privateTerms)||value.privateTerms.length>500||value.privateTerms.some(term=>typeof term!=='string'||!term||term.length>80)))throw Error('隐藏词表无效');
    if(value.temporalResolutions!==undefined&&(!Array.isArray(value.temporalResolutions)||value.temporalResolutions.some(item=>!item||typeof item.subject!=='string'||typeof item.scope!=='string'||typeof item.value!=='string'||!Array.isArray(item.fingerprints)||item.fingerprints.some(value=>typeof value!=='string'))))throw Error('通知核对依据无效');
    validateAssistantEngine(value.orchestration);
    const history=value.checkpoints;
    if(value.workRequests!==undefined){
      if(!Array.isArray(value.workRequests)||value.workRequests.length>100)throw Error('处理请求记录无效');
      const ids=new Set();for(const item of value.workRequests){
        if(!item||typeof item.id!=='string'||!item.id||ids.has(item.id)||typeof item.conversationId!=='string'||typeof item.userId!=='string'||typeof item.route!=='string'||!['running','interrupted','failed','review','ready','cancelled','confirmed','dismissed'].includes(item.status)||!Number.isFinite(Date.parse(item.startedAt)))throw Error('处理请求条目无效');
        ids.add(item.id);
      }
    }
    if(history!==undefined){
      if(!history||history.version!==1||!Array.isArray(history.items))throw Error('历史快照索引无效');
      const historyIds=new Set();
      for(const item of history.items){
        if(!item||typeof item.id!=='string'||!item.id||historyIds.has(item.id)||typeof item.label!=='string'||item.label.length>80||!/^\d{4}-\d{2}-\d{2}$/.test(item.day)||!Number.isFinite(Date.parse(item.at))||!/^[a-f0-9]{64}$/.test(item.hash)||!Number.isSafeInteger(item.bytes)||item.bytes<1||!Array.isArray(item.assets)||!Array.isArray(item.counts))throw Error('历史快照条目无效');
        historyIds.add(item.id);
        if(item.assets.some(asset=>!asset||!/^[a-f0-9]{64}$/.test(asset.hash)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1))throw Error('历史原件清单无效');
        if(item.counts.some(value=>!value||!['courses','lessons','tasks','notes','scratchEntries','agentHistory'].includes(value.key)||!Number.isInteger(value.count)||value.count<0))throw Error('历史快照条数无效');
      }
    }
    const box=value.mailbox;
    if(!box||typeof box.enabled!=='boolean'||!['gentle','plain','direct'].includes(box.tone)||!box.enrolled||!Array.isArray(box.letters)||box.letters.length>10000||!Array.isArray(box.truths)||box.truths.length>10000)throw Error('时间信箱记录无效。');
    for(const letter of box.letters)if(!letter||typeof letter.id!=='string'||typeof letter.taskId!=='string'||typeof letter.body!=='string'||letter.body.length>12000||!Array.isArray(letter.facts))throw Error('时间信件数据无效。');
    if(JSON.stringify(value).length>12000000)throw Error('助手档案过大，请先保留完整备份。');
  }
  const checkDataBeforeAssistant=checkData;
  checkData=function(input,timetableOnly){const data=checkDataBeforeAssistant(input,timetableOnly);if(!timetableOnly){validateAssistantState(data.agentPreferences?.intelligence);for(const list of [data.tasks,data.notes,data.scratchEntries]){const ids=new Set();for(const item of list){if(['__proto__','prototype','constructor'].includes(item.id)||ids.has(item.id))throw Error('记录标识重复或无效，未覆盖原数据');ids.add(item.id)}}}return data};
  function assistantTrace(request,result={}){
    const state=assistantState();
    state.traces.push({id:uid(),at:new Date().toISOString(),conversationId:String(request.conversationId||'default'),route:String(request.route||'rule'),tool:String(result.tool||request.tool||''),sourceCount:(result.refs||request.refs||[]).length,elapsedMs:Math.max(0,Math.round(performance.now()-(request.started||performance.now()))),outcome:result.cancelled?'cancelled':result.error?'error':result.action?.type!=='none'&&result.action?'awaiting_confirmation':'answered',confirmed:false});
    if(state.traces.length>300)state.traces.splice(0,state.traces.length-300);
    return state.traces.at(-1).id;
  }
  function assistantSheetHtml(){return assistantSheet?'<div class="xixu-assistant-overlay"><section class="xixu-assistant-sheet" role="dialog" aria-modal="true" aria-labelledby="xixu-assistant-sheet-title"><header><h2 id="xixu-assistant-sheet-title">'+esc(assistantSheet.title)+'</h2><button type="button" data-action="assistant-close" aria-label="关闭">'+icon('x')+'</button></header>'+assistantSheet.html+'</section></div>':''}
  function assistantRefreshSheet(){
    const existing=root.querySelector('.xixu-assistant-overlay');if(assistantSheet&&existing?.dataset.sheetToken===assistantSheet.token)return;
    existing?.remove();
    if(!assistantSheet)return;
    root.insertAdjacentHTML('beforeend',assistantSheetHtml());
    root.querySelector('.xixu-assistant-overlay').dataset.sheetToken=assistantSheet.token;
    if(globalThis.lucide)globalThis.lucide.createIcons({root:root.querySelector('.xixu-assistant-overlay')});
  }
  function assistantShowSheet(title,html,kind='info'){
    if(assistantSheet&&['privacy','vision'].includes(assistantSheet.kind)&&assistantSheet.kind!==kind)throw Error('请先完成或关闭当前发送核对');
    assistantSheetFocus=document.activeElement;assistantSheet={title,html,kind,token:uid()};assistantRefreshSheet();window.XixuBack?.setCanGoBack?.(true);
    requestAnimationFrame(()=>root.querySelector('.xixu-assistant-sheet button,.xixu-assistant-sheet input')?.focus({preventScroll:true}));
  }
  function assistantCloseSheet(){
    const old=assistantSheet;assistantSheet=null;root.querySelector('.xixu-assistant-overlay')?.remove();
    if(old?.kind==='privacy')assistantCancelPrivacy();
    if(old?.kind==='vision')assistantCancelVision();
    if(typeof assistantDrainApprovals==='function')setTimeout(assistantDrainApprovals,0);
    if(typeof syncBackState==='function')syncBackState();
    if(assistantSheetFocus?.isConnected)assistantSheetFocus.focus({preventScroll:true});
  }
  const renderBeforeAssistant=render;
  render=function(...args){const result=renderBeforeAssistant(...args);assistantRefreshSheet();return result};
  root.addEventListener('keydown',event=>{
    if(!assistantSheet)return;
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();assistantCloseSheet();return}
    if(event.key!=='Tab')return;
    const controls=[...root.querySelectorAll('.xixu-assistant-sheet button,.xixu-assistant-sheet input,.xixu-assistant-sheet textarea,.xixu-assistant-sheet select,.xixu-assistant-sheet summary')].filter(item=>!item.disabled&&item.getClientRects().length),first=controls[0],last=controls.at(-1);
    if(event.shiftKey&&(document.activeElement===first||!controls.includes(document.activeElement))){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
  },true);
  function assistantValidate(schema,value,path='参数'){
    if(schema.type==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error(path+'必须是对象');
      for(const key of schema.required||[])if(!(key in value))throw Error(path+'缺少 '+key);
      for(const key of Object.keys(value)){if(!Object.prototype.hasOwnProperty.call(schema.properties||{},key))throw Error(path+'包含不支持的字段 '+key);assistantValidate(schema.properties[key],value[key],key)}
    }else if(schema.type==='string'){
      if(typeof value!=='string'||schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength||schema.pattern&&!new RegExp(schema.pattern).test(value)||schema.format==='date'&&!validCalendarDate(value))throw Error(path+'格式不正确');
    }else if(schema.type==='integer'&&(!Number.isInteger(value)||schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))throw Error(path+'不在允许范围内');
    if(schema.enum&&!schema.enum.includes(value))throw Error(path+'不在允许选项中');
    return value;
  }
  const assistantTools=new Map(XIXU_TOOL_MANIFEST.tools.map(tool=>[tool.name,tool]));
  function assistantTool(name,args,context={}){
    const definition=assistantTools.get(name);if(!definition)throw Error('不支持的工具');
    assistantValidate(definition.inputSchema,args);
    if(name==='recall_conversation')return {readOnly:true,messages:assistantRecallConversation(context.request,args)};
    if(name==='search_web')return {readOnly:true,type:'search_web',query:args.query,limit:args.limit||5};
    if(name==='search_notes')return {readOnly:true,refs:semanticAgentSearch(args.query).filter(ref=>!args.date_from||String(ref.date||'')>=args.date_from).filter(ref=>!args.date_to||String(ref.date||'')<=args.date_to).slice(0,args.limit||5)};
    if(name==='get_schedule')return {readOnly:true,...assistantSchedule(args)};
    if(name==='update_event'){
      const record=tasks.find(item=>item.id===args.task_id);
      if(!record||!context.refs?.some(ref=>ref.recordType==='task'&&ref.id===record.id))throw Error('修改必须对应本次已核对的具体事项');
      if(Object.keys(args).length<2)throw Error('请说明要修改的字段');
      return {type:'tool_update_event',taskId:record.id,base:assistantStable(record),patch:assistantClone(args),tool:name};
    }
    const item=normalizeAi({kind:'item',title:args.title,date:args.date,time:args.time||'',type:name==='create_todo'?'task':args.type,courseName:args.course_name||'',note:args.note||'',plan:args.date,repeat:'none',reminders:name==='create_todo'?[]:[1440,60]});
    return {type:'create_task',item,durationMinutes:args.duration_minutes||0,tool:name,reason:'本机工具已校验参数；确认后才写入'};
  }
  function assistantSchedule({date,start_time='',end_time='',exclude_task_id=''}){
    const occupied=[];
    const append=(start,end,label,estimated=false)=>{if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>start)occupied.push({start,end:Math.min(1440,end),label,estimated})};
    lessonsOnDate(date,{includeRescheduledOut:false}).forEach(({lesson})=>append(plannerTimeMinute(lessonStart(lesson)),plannerTimeMinute(lessonEnd(lesson),true),course(lesson.course)?.name||'课程'));
    tasks.filter(item=>!item.done&&item.id!==exclude_task_id).forEach(item=>{
      for(const session of item.sessions||[])if(session.date===date&&!session.done)append(plannerTimeMinute(session.time),plannerTimeMinute(session.time)+Number(session.minutes),item.title);
      if(item.date===date&&['task','meeting','exam'].includes(item.type))append(plannerTimeMinute(item.time),plannerTimeMinute(item.time)+(Number(item.durationMinutes)||60),item.title,!item.durationMinutes);
    });
    occupied.sort((a,b)=>a.start-b.start);
    const start=assistantClock(start_time)?Number(start_time.slice(0,2))*60+Number(start_time.slice(3)):null,end=assistantClock(end_time)?Number(end_time.slice(0,2))*60+Number(end_time.slice(3)):null;
    if(Boolean(start_time)!==Boolean(end_time)||start!==null&&end!==null&&end<=start)throw Error('查询需给出同一天完整的开始、结束时刻，跨日请分别核对');
    const conflicts=start!==null&&end!==null?occupied.filter(item=>item.start<end&&item.end>start):[];
    const deadlines=tasks.filter(item=>!item.done&&item.date===date&&['homework','exam'].includes(item.type)).map(item=>({id:item.id,title:item.title,time:item.time||'',kind:'deadline'}));
    return {date,occupied,conflicts,deadlines,estimatedDurations:true};
  }
  function assistantDateSlots(text,anchor=DEMO_DAY,scope=''){
    text=normalizeSpokenScheduleText(text);const explicit=text.match(/(?:(\d{4})[年/-])?(\d{1,2})[月/-](\d{1,2})(?:日|号)?/);
    if(explicit){const date=String(explicit[1]||anchor.slice(0,4))+'-'+explicit[2].padStart(2,'0')+'-'+explicit[3].padStart(2,'0');return {date:validCalendarDate(date)?date:'',invalid:!validCalendarDate(date)}}
    const relative=text.match(/大后天|前天|昨天|今天|今晚|明天|明晚|后天/);if(relative)return {date:addDays(anchor,{大后天:3,前天:-2,昨天:-1,今天:0,今晚:0,明天:1,明晚:1,后天:2}[relative[0]])};
    const weekday=text.match(/(下下|上上|本|这|下|上)?周([一二三四五六日天])/),week=text.match(/(下下|上上|本|这|下|上)周/);
    if(weekday){const qualifier=weekday[1]||scope;if(!qualifier)return {ambiguous:true,weekday:weekday[2]};const index='一二三四五六日'.indexOf(weekday[2]==='天'?'日':weekday[2]),monday=mondayOf(anchor);return {date:addDays(monday,index+7*({下下:2,上上:-2,下:1,上:-1}[qualifier]||0)),scope:qualifier}}
    return {scope:week?.[1]||scope};
  }
  function assistantTimeSlot(text){
    const clock=text.match(/(?:^|[^\d])(\d{1,2})[:：](\d{2})(?!\d)/),spoken=text.match(/(凌晨|早上|上午|中午|下午|晚上|今晚|明晚)?\s*([零〇一二三四五六七八九十两\d]{1,3})[点时](半|一刻|三刻|[零〇一二三四五六七八九十两\d]{1,2}分?)?/);
    if(!clock&&!spoken)return {};
    let hour=clock?Number(clock[1]):chineseNumber(spoken[2]),minute=clock?Number(clock[2]):({半:30,一刻:15,三刻:45}[spoken[3]]??(spoken[3]?chineseNumber(spoken[3].replace('分','')):0));
    if(spoken&&/下午|晚上|今晚|明晚/.test(spoken[1]||'')&&hour>=1&&hour<=11)hour+=12;
    if(spoken?.[1]==='中午'&&hour>=1&&hour<11)hour+=12;
    if(spoken?.[1]==='凌晨'&&hour===12)hour=0;
    if(hour<0||hour>23||minute<0||minute>59||!Number.isFinite(hour+minute))return {invalid:true};
    return {time:String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')};
  }
  function assistantClockRange(input){
    const text=String(input).replace(/([零一二三四五六七八九十两\d]{1,3})(到|至|-)([零一二三四五六七八九十两\d]{1,3})([点时])/g,'$1点$2$3$4'),matches=[...text.matchAll(/(凌晨|早上|上午|中午|下午|晚上|今晚|明晚)?\s*(?:\d{1,2}[:：]\d{2}|[零〇一二三四五六七八九十两\d]{1,3}[点时](?:半|一刻|三刻|[零〇一二三四五六七八九十两\d]{1,2}分?)?)/g)];
    if(matches.length<2)return {start:assistantTimeSlot(text).time||''};
    if(matches.length>2)return {invalid:true};
    const start=assistantTimeSlot(matches[0][0]),end=assistantTimeSlot(matches[1][1]?matches[1][0]:(matches[0][1]||'')+matches[1][0]);
    if(start.invalid||end.invalid||!start.time||!end.time||end.time<=start.time)return {invalid:true};return {start:start.time,end:end.time,duration:plannerTimeMinute(end.time)-plannerTimeMinute(start.time)};
  }
  function assistantTitle(text){
    return text.replace(/^(?:(?:请|麻烦)(?:你)?\s*)?(?:(?:帮我|替我|给我|我想要?|我要)\s*)?(?:添加|新增|创建|安排|提醒我)(?:一[条个项])?(?:任务|日程|事项|提醒)?[：:，,\s]*/,'').replace(/(?:(?:\d{4})[年/-])?\d{1,2}[月/-]\d{1,2}(?:日|号)?/g,'').replace(/(?:下下|上上|本|这|下|上)?周[一二三四五六日天]?|大后天|前天|昨天|今天|今晚|明天|明晚|后天/g,'').replace(/(?:凌晨|早上|上午|中午|下午|晚上)?\s*[零〇一二三四五六七八九十两\d]{1,3}[点时](?:半|一刻|三刻|[零〇一二三四五六七八九十两\d]{1,2}分?)?|\d{1,2}[:：]\d{2}/g,'').replace(/^[的在，,\s]+|[，,\s]+$/g,'').trim().slice(0,100);
  }
  function assistantRuleCommand(input,conversation=activeConversationId()){
    const text=normalizeSpokenScheduleText(input).trim(),state=assistantState();let pending=state.pendingSlots[conversation];
    if(pending&&Date.now()-pending.updatedAt>1800000){delete state.pendingSlots[conversation];pending=null}
    if(/^(?:算了|取消|不用了|重新开始)[。！!\s]*$/.test(text)&&pending){delete state.pendingSlots[conversation];return {answer:'已取消这次未完成的安排，没有写入日程。',refs:[],action:{type:'none'},source:'local',tool:'cancel_pending'}}
    const intent=assistantRouteIntent(text,Boolean(pending)),startsTask=['create_event','create_todo'].includes(intent);
    // A new explicit note is not a continuation of an unfinished date question.
    if(pending&&intent==='create_note'){delete state.pendingSlots[conversation];pending=null}
    const supplement=pending&&intent==='continue_event';
    if(!startsTask&&!supplement)return null;
    if(startsTask)pending=null;
    const mentions=parseRescheduleDateInfo(text);if(new Set(mentions.dates.map(item=>item.date)).size>1||mentions.ambiguous.length>1||/同时|分别|然后|并且/.test(text))return {answer:'这里包含多项安排或多个日期。请先明确要处理的那一件，我再继续核对。',refs:[],action:{type:'none'},source:'local'};
    if(text.length>1000)return {answer:'这段安排较长，原文已保留在对话中。可以先存成备忘录，再给这件事项一个简短标题和日期。',refs:[],action:{type:'none'},source:'local'};
    const anchor=pending?.anchor||DEMO_DAY,dates=assistantDateSlots(text,anchor,pending?.scope||''),period=text.match(/凌晨|早上|上午|中午|下午|晚上|今晚|明晚/)?.[0]||pending?.period||'',clockText=pending?.period&&!/凌晨|早上|上午|中午|下午|晚上|今晚|明晚/.test(text)?pending.period+text:text,clock=assistantTimeSlot(clockText),range=assistantClockRange(clockText);
    if(range.invalid)return {answer:'这次有多个时刻，或结束时刻早于开始。请明确同一天的开始、结束时间；跨日安排要分开核对。',refs:[],action:{type:'none'},source:'local'};
    if(dates.invalid||clock.invalid)return {answer:'这个日期或时刻不成立，请核对后再说。目前没有写入。',refs:[],action:{type:'none'},source:'local'};
    const next={...(pending||{}),anchor,period,updatedAt:Date.now(),title:pending?.title||assistantTitle(text),note:pending?.note||(text.length>100?text:''),type:pending?.type||(/考试|期末/.test(text)?'exam':/会议|开会|汇报|presentation/i.test(text)?'meeting':/作业|报告|ddl|截止|提交|交/i.test(text)?'homework':'task')};
    if(dates.date)next.date=dates.date;if(dates.scope)next.scope=dates.scope;if(range.start||clock.time)next.time=range.start||clock.time;if(range.duration)next.duration=range.duration;
    if(!next.title){return {answer:'要安排什么事情？告诉我标题，再补日期和时间。',refs:[],action:{type:'none'},source:'local'}}
    state.pendingSlots[conversation]=next;
    if(dates.ambiguous){next.weekday=dates.weekday;return {answer:'“'+next.title+'”是本周'+dates.weekday+'还是下周'+dates.weekday+'？',choices:[{label:'本周',value:'本周'+dates.weekday},{label:'下周',value:'下周'+dates.weekday}],refs:[],action:{type:'none'},source:'local'}}
    if(!next.date)return {answer:'记住了“'+next.title+'”。'+(next.scope?'是'+({下下:'下下',下:'下',本:'本',这:'本',上:'上'}[next.scope]||'这')+'周的周几？':'具体哪一天？')+'你可以直接补充日期和时刻。',refs:[],action:{type:'none'},source:'local'};
    if(!next.time&&['meeting','exam'].includes(next.type))return {answer:'“'+next.title+'”在 '+next.date+'。具体几点开始？',refs:[],action:{type:'none'},source:'local'};
    const name=next.type==='task'?'create_todo':'create_event',args={title:next.title,date:next.date,time:next.time||(next.type==='homework'?'23:59':''),note:next.note||''};if(next.duration)args.duration_minutes=next.duration;if(name==='create_event')args.type=next.type;
    const action=assistantTool(name,args);delete state.pendingSlots[conversation];
    return {answer:'已整理“'+next.title+'”。'+(!next.time&&next.type==='homework'?'截止时刻暂按 23:59 展示，请核对。':'请核对后确认加入。'),refs:[],action,tool:name,source:'local'};
  }
  function localAgentCommand(query,conversationId=activeConversationId()){return assistantRuleCommand(query,conversationId)||assistantScheduleAnswer(query)||localAgentNoteCommand(query)}
  function assistantScheduleAnswer(query){
    if(!/安排|日程|课|空闲|有空|冲突|足球|踢球/.test(query)||!(agentReadQuestion(query)||/能不能|可以|(?:我想|想去|能去).*(?:足球|踢球)/.test(query)))return null;
    const date=assistantDateSlots(query);if(date.ambiguous)return {answer:'你指本周还是下周？请把查询日期说完整，我再查课表和日程。',refs:[],action:{type:'none'},source:'local'};if(!date.date)return null;
    const clock=assistantTimeSlot(query),range=assistantClockRange(query),part=/下午/.test(query)?['13:00','18:00']:/上午|早上/.test(query)?['08:00','12:00']:/晚上/.test(query)?['18:00','23:00']:['',''];
    if(range.invalid||clock.invalid)return {answer:'请明确同一天的开始和结束时刻，我再查是否冲突。',refs:[],action:{type:'none'},source:'local'};
    const start=range.start||clock.time||part[0],to=clock.time?Math.min(1439,plannerTimeMinute(clock.time)+60):0,end=range.end||(clock.time?String(Math.floor(to/60)).padStart(2,'0')+':'+String(to%60).padStart(2,'0'):part[1]);
    if(start&&end<=start)return {answer:'这个时间范围接近跨日，请明确开始和结束日期，我再分别核对。',refs:[],action:{type:'none'},source:'local'};
    const result=assistantTool('get_schedule',{date:date.date,...(start?{start_time:start,end_time:end}:{})});
    const spans=start?result.conflicts:result.occupied,fmt=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
    return {answer:date.date+' '+(start?start+'—'+end+'：':'的安排：')+(spans.length?'\n'+spans.map(item=>'• '+fmt(item.start)+'—'+fmt(item.end)+' '+item.label).join('\n'):'未查到占用。')+(result.deadlines.length?'\n当天还有截止事项：'+result.deadlines.map(item=>item.title+(item.time?' '+item.time:'')).join('、')+'。截止风险与时间占用分开列出。':'')+'\n部分事项未记录时长时按一小时估计，空白不代表已核实可用。',refs:[],action:{type:'none'},source:'local',tool:'get_schedule'};
  }
  function assistantRows(){return {courses:assistantClone(courses),lessons:assistantClone(lessons),tasks:assistantClone(tasks),notes:assistantClone(notes)}}
  function assistantRestoreRows(rows){courses.splice(0,courses.length,...rows.courses);lessons.splice(0,lessons.length,...rows.lessons);tasks=rows.tasks;notes=rows.notes}
  function assistantDeltas(before,after){
    const result=[];
    for(const collection of ['courses','lessons','tasks','notes']){
      const key=(row,index)=>row.id||'legacy:'+collection+':'+index,old=new Map(before[collection].map((row,index)=>[key(row,index),row])),fresh=new Map(after[collection].map((row,index)=>[key(row,index),row]));
      for(const id of new Set([...old.keys(),...fresh.keys()]))if(assistantStable(old.get(id))!==assistantStable(fresh.get(id)))result.push({collection,id,before:old.get(id)||null,after:fresh.get(id)||null});
    }
    return result;
  }
  function assistantDiffHtml(deltas){
    const describe=row=>row?[(row.title||row.name||course(row.course)?.name||'课程'),row.course?'关联：'+(course(row.course)?.name||row.course):'',row.date||row.dateOverride||'',row.time||'',row.period||'',row.done?'已标记完成':'',row.cancelledDates?.length?'调出：'+row.cancelledDates.join('、'):'',row.reminders?.length?'提醒：'+row.reminders.join('、')+' 分钟前':'',row.sessions?.length?'学习时段：'+JSON.stringify(row.sessions):'',row.text||row.note||''].filter(Boolean).join(' · '):'无';
    return '<div class="xixu-plan-diff">'+deltas.map(delta=>'<article><h3>'+esc(({courses:'课程',lessons:'排课',tasks:'事项',notes:'备忘录'})[delta.collection])+'</h3><p class="is-before"><span>−</span>'+esc(describe(delta.before))+'</p><p class="is-after"><span>＋</span>'+esc(describe(delta.after))+'</p></article>').join('')+'</div>';
  }
  function assistantPreviewPlan(action,button){
    if(storageBlocked)throw Error('本机资料尚未完整读取，请先恢复数据，未覆盖保存');
    // Give legacy lessons stable identifiers so rollback never relies on shifting indexes.
    for(const lesson of lessons)if(!lesson.id)lesson.id=uid();
    const before=assistantRows(),after=assistantClone(before);let destination='agenda';
    if(action.type==='create_task'){
      const item=action.item,id=uid(),linked=after.courses.find(entry=>entry.name===item.courseName||entry.short===item.courseName);
      const tool=item.type==='task'?'create_todo':'create_event';assistantValidate(assistantTools.get(tool).inputSchema,{title:item.title,date:item.date,time:item.time||'',...(tool==='create_event'?{type:item.type}:{})});
      if(!validCalendarDate(item.date)||item.time&&!assistantClock(item.time))throw Error('请核对真实日期和时刻');
      after.tasks.push({id,type:item.type,title:item.title,course:linked?.id||'',date:item.date,time:item.time,plan:item.plan,repeat:item.repeat,reminders:item.reminders,note:item.note,done:false,estimateMinutes:0,sessions:[],images:[],durationMinutes:Number(action.durationMinutes)||0});
    }else if(action.type==='tool_update_event'){
      const target=after.tasks.find(item=>item.id===action.taskId);if(!target||assistantStable(target)!==action.base)throw Error('事项已发生变化，请重新查询后修改。');
      const patch=action.patch;for(const field of ['title','date','time','note'])if(field in patch)target[field]=patch[field];if(patch.duration_minutes!==undefined)target.durationMinutes=patch.duration_minutes;
    }else if(action.type==='create_note'){
      const now=new Date().toISOString();if(!String(action.text||'').trim()||action.text.length>50000)throw Error('笔记正文为空或超限');after.notes.unshift({id:uid(),title:action.title||'新笔记',text:action.text,category:action.category||categorizeMemory(action.text),course:'',createdAt:now,updatedAt:now,images:[]});destination='notes';
    }else if(['complete_task','plan_task','append_note','delete_task','delete_note','delete_course'].includes(action.type)){
      const collection=action.type.includes('note')?'notes':action.type==='delete_course'?'courses':'tasks',id=action.noteId||action.taskId||action.courseId,index=after[collection].findIndex(item=>item.id===id),target=after[collection][index];if(!target)throw Error('目标已移除，请重新查找');
      if(action.baseVersion&&assistantStable(target)!==action.baseVersion)throw Error('资料后来改过，请重新检索后再修改');
      if(action.type==='complete_task')target.done=true;
      else if(action.type==='plan_task'){const proposal=proposeSessions(target,action.estimateMinutes);target.estimateMinutes=action.estimateMinutes;target.sessions=proposal.sessions;target.plan=proposal.sessions[0]?.date||target.plan;destination='timetable'}
      else if(action.type==='append_note'){target.text+=(target.text?'\n\n':'')+action.text;if(target.text.length>50000)throw Error('追加后正文超出容量，未截断保存');target.updatedAt=new Date().toISOString();if(target.archive)target.archiveEdited=true;destination='notes'}
      else{after[collection].splice(index,1);if(collection==='courses'){after.lessons=after.lessons.filter(item=>item.course!==id);for(const item of [...after.tasks,...after.notes])if(item.course===id)item.course='';destination='timetable'}else if(collection==='notes')destination='notes'}
    }else if(action.type==='reschedule_lesson'||action.type==='swap_schedule'){
      const resolved=action.type==='reschedule_lesson'?resolveLessonReschedule(action.courseName,action.sourceDate,action.sourcePeriods,action.targetDate,action.targetPeriods):resolveScheduleSwap(action.firstDate,action.secondDate,action.firstPeriods,action.secondPeriods,action.scopeLabel);if(resolved.error)throw Error(resolved.error);
      const moves=action.type==='reschedule_lesson'?[resolved]:resolved.moves;
      for(const move of moves){const source=after.lessons[move.sourceLessonIndex],periods=move.targetPeriods,used=[...new Set(periods.map(periodBlockIndex))];source.cancelledDates=[...new Set([...(source.cancelledDates||[]),move.sourceDate])];after.lessons.push({id:uid(),course:source.course,day:(new Date(move.targetDate+'T12:00:00Z').getUTCDay()+6)%7,block:periodBlockIndex(periods[0]),spans:used.length>1?used:undefined,period:periods.join('–'),room:source.room,weeks:[weekOfDate(move.targetDate)],rule:'调课 · '+move.targetDate+' 单次',dateOverride:move.targetDate,rescheduledFrom:{lessonId:source.id||'',date:move.sourceDate,periods:move.sourcePeriods}})}destination='timetable';
    }else return false;
    const deltas=assistantDeltas(before,after);if(!deltas.length)throw Error('没有需要保存的变化');
    if(assistantState().journal.length>=1000||assistantStable(assistantState().journal).length+assistantStable(deltas).length>8000000)throw Error('变更档案已满，请先导出完整备份并整理档案。');
    assistantPlan={before,after,deltas,action:assistantClone(action),draft:button?agentDraft:null,destination,from:button?captureMotionBox(button):null,at:new Date().toISOString()};
    assistantShowSheet('核对日程变更',assistantDiffHtml(deltas)+'<p>同一次调课作为一组执行；原提醒将按新课表重新核对，事项提醒随对应日期重建。其他安排不会移动。</p><label class="xixu-check-line"><input type="checkbox" id="xixu-plan-accept">接受这一组变更</label><button class="tide-primary tide-full" data-action="assistant-plan-apply">保存这一组</button>','plan');return true;
  }
  async function assistantApplyPlan(){
    if(storageBlocked)throw Error('本机资料读取异常，未覆盖保存');
    const plan=assistantPlan;if(plan?.draft?.ticketId)assistantAssertPlanTicket(plan.draft.ticketId);if(!plan||!root.querySelector('#xixu-plan-accept')?.checked){notify('请先勾选接受这组变更');return}
    if(plan.applying)return;plan.applying=true;
    try{if(plan.commitmentId)await assistantVerifyCommitment(assistantState().commitments.find(item=>item.id===plan.commitmentId))}catch(error){plan.applying=false;throw error}
    if(assistantPlan!==plan)throw Error('这次预览已经关闭，请重新核对');
    plan.applying=false;
    if(assistantStable(assistantRows())!==assistantStable(plan.before))throw Error('预览后资料已改变，请关闭后重新核对。');
    const state=assistantState(),entry={id:uid(),at:new Date().toISOString(),kind:plan.action.type,deltas:plan.deltas,rolledBackAt:''};
    const previous=assistantClone(state),receipt={page:plan.destination,label:'查看已保存的安排',id:plan.deltas.find(item=>item.collection==='tasks'&&item.after)?.id||'',icon:'calendar-check'};
    try{
      assistantRestoreRows(plan.after);state.journal.push(entry);
      if(plan.commitmentId){const candidate=state.commitments.find(item=>item.id===plan.commitmentId);if(candidate){candidate.status='recorded';candidate.matchedTaskId=receipt.id;entry.commitmentId=candidate.id}}
      const trace=state.traces.find(item=>item.id===plan.draft?.traceId);if(trace){trace.confirmed=true;trace.outcome='confirmed'}
      assistantSettlePlanTicket(plan.draft?.ticketId,receipt);
      const raw=JSON.stringify(snapshot());checkData(JSON.parse(raw),false);storageWrite(raw);lastSaved=raw;saveError.hidden=true;
    }catch(error){assistantRestoreRows(plan.before);agentPreferences.intelligence=previous;throw error}
    if(plan.draft?.ticketId)assistantUpdatePlanMessage(plan);
    else if(plan.draft&&agentDraft===plan.draft){agentCommitReceipt(plan.destination,'查看已保存的安排',receipt.id,'calendar-check');updateAgentAnswer('已按核对内容保存，可以在变更记录中追溯或撤回。')}
    queueDelightCue('agent-commit',{destination:plan.destination,from:plan.from,label:'已保存'});
    assistantPlan=null;assistantCloseSheet();persist({reminders:false});syncReminders();render(false);notify('变更已保存');
  }
  function assistantUndoJournal(id){
    if(storageBlocked)throw Error('本机资料读取异常，未覆盖保存');
    const state=assistantState(),entry=state.journal.find(item=>item.id===id);if(!entry||entry.rolledBackAt)throw Error('这组变更已撤回或不存在');
    const rows=assistantRows(),before=assistantClone(rows);
    for(const delta of entry.deltas){const list=rows[delta.collection],index=list.findIndex((item,i)=>(item.id||'legacy:'+delta.collection+':'+i)===delta.id),current=index<0?null:list[index];if(assistantStable(current)!==assistantStable(delta.after))throw Error('其中一项后来又改过，不能覆盖。请先核对最新记录。');if(delta.before){if(index<0)list.push(assistantClone(delta.before));else list[index]=assistantClone(delta.before)}else if(index>=0)list.splice(index,1)}
    assistantRestoreRows(rows);const prior=entry.rolledBackAt;entry.rolledBackAt=new Date().toISOString();
    try{const raw=JSON.stringify(snapshot());checkData(JSON.parse(raw),false);storageWrite(raw);lastSaved=raw}catch(error){assistantRestoreRows(before);entry.rolledBackAt=prior;throw error}
    syncReminders();assistantCloseSheet();render(false);notify('这一组变更已撤回');
  }
  const actionHtmlBeforeAssistant=agentActionHtml;
  agentActionHtml=function(action){if(action?.type==='tool_update_event'){const target=tasks.find(item=>item.id===action.taskId);return '<div class="xixu-agent-action"><strong>'+esc(target?.title||'事项已不存在')+'</strong><p>'+esc(Object.entries(action.patch).filter(([key])=>key!=='task_id').map(([key,value])=>key+'：'+value).join(' · '))+'</p><button data-action="agent-confirm" class="tide-primary">核对修改</button></div>'}return actionHtmlBeforeAssistant(action)};
  const settingsBeforeAssistantCore=renderSettings;
  const navigateBeforeAssistant=canNavigateBack;
  canNavigateBack=function(){return Boolean(assistantSheet)||navigateBeforeAssistant()};
  const backBeforeAssistant=window.XixuHandleSystemBack;
  window.XixuHandleSystemBack=()=>{if(assistantSheet){assistantCloseSheet();return true}return backBeforeAssistant?.()};
  renderSettings=function(){return settingsBeforeAssistantCore()+assistantWorkSettingsHtml()+'<div class="tide-section"><h2>助手记录</h2></div><div class="xixu-setting-actions"><button data-action="assistant-journal">'+icon('git-compare-arrows')+'<span>日程变更记录</span>'+icon('chevron-right')+'</button><button data-action="assistant-traces">'+icon('activity')+'<span>处理记录</span>'+icon('chevron-right')+'</button><button data-action="assistant-private-terms">'+icon('shield-check')+'<span>发送前隐藏词表</span>'+icon('chevron-right')+'</button></div>'};
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
    try{
      if(['agent-confirm','agent-dismiss','agent-choice','agent-view-result','assistant-temporal-review','assistant-start-web'].includes(action))assistantBindMessageResult(button);
      if(action==='assistant-close'){event.preventDefault();event.stopImmediatePropagation();assistantCloseSheet()}
      else if(action==='agent-dismiss'){
        const state=assistantState(),ticketId=agentDraft?.ticketId;
        if(ticketId)assistantEngine.control(ticketId,'dismiss');else delete state.pendingSlots[activeConversationId()];
      }
      else if(action==='agent-confirm'&&agentDraft&&['create_task','create_note','complete_task','plan_task','append_note','delete_task','delete_note','delete_course','tool_update_event','reschedule_lesson','swap_schedule'].includes(agentDraft.action?.type)){
        event.preventDefault();event.stopImmediatePropagation();if(readAgentActionFields(agentDraft.action,button.closest('.xixu-agent-action')))assistantPreviewPlan(agentDraft.action,button);
      }else if(action==='assistant-plan-apply'){event.preventDefault();event.stopImmediatePropagation();assistantApplyPlan().catch(error=>notify(error.message||'尚未保存'))}
      else if(action==='assistant-journal'){assistantShowSheet('日程变更记录',assistantState().journal.slice().reverse().map(item=>'<article class="xixu-journal-row"><time>'+esc(item.at)+'</time>'+assistantDiffHtml(item.deltas)+(item.rolledBackAt?'<p>已撤回：'+esc(item.rolledBackAt)+'</p>':'<button class="tide-secondary" data-action="assistant-journal-review" data-id="'+esc(item.id)+'">核对并撤回</button>')+'</article>').join('')||'<p>尚无通过助手核对保存的变更。</p>')}
      else if(action==='assistant-journal-review'){const item=assistantState().journal.find(entry=>entry.id===button.dataset.id);if(item)assistantShowSheet('核对撤回',assistantDiffHtml(item.deltas.map(delta=>({...delta,before:delta.after,after:delta.before})))+'<p>仅在当前资料仍与保存后版本一致时撤回。</p><button class="tide-primary tide-full" data-action="assistant-journal-undo" data-id="'+esc(item.id)+'">确认撤回这一组</button>')}
      else if(action==='assistant-journal-undo')assistantUndoJournal(button.dataset.id);
      else if(action==='assistant-traces'){assistantShowSheet('本机处理记录','<p>只记录路径、工具、片段数和耗时；不保存问题正文、片段正文或密钥。这里的耗时是单次记录，不是性能评测。</p><ol class="xixu-traces">'+assistantState().traces.slice().reverse().map(item=>'<li><time>'+esc(item.at)+'</time><strong>'+esc(item.route)+' · '+esc(item.tool||'回答')+'</strong><span>'+item.elapsedMs+' ms · '+item.sourceCount+' 个片段 · '+esc(item.outcome)+'</span></li>').join('')+'</ol>')}
    }catch(error){event.preventDefault();event.stopImmediatePropagation();notify(error.message||'未保存，请重新核对')}
  },true);
