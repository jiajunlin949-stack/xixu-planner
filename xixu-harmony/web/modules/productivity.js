  let plannerDraft=null,memoryDraft=null,noteEditorDraft=null,noteDraftTimer=null,searchQuery='',noteSearch='',noteImportDraft=[],noteImportError='',scratchInputDraft='',scratchDockExpanded=false;
  try{noteEditorDraft=JSON.parse(localStorage.getItem('xixu-note-editor-draft')||'null')}catch(_){noteEditorDraft=null}
  const minuteOf=time=>{const [h,m]=String(time||'00:00').split(':').map(Number);return h*60+m};
  const clockOf=value=>String(Math.floor(value/60)).padStart(2,'0')+':'+String(value%60).padStart(2,'0');
  const dayIndexOf=date=>(new Date(date+'T12:00:00Z').getUTCDay()+6)%7;
  const teachingWeekOf=date=>1+Math.floor((Date.parse(date)-Date.parse(TERM_MONDAY))/604800000);
  const dateTime=(date,time='23:59')=>Date.parse(date+'T'+time+':00+08:00');

  function workloadDays(from=DEMO_DAY,days=14){
    const result=[];
    for(let offset=0;offset<days;offset++){
      const date=addDays(from,offset),items=tasks.filter(t=>!t.done&&isDeadline(t)&&t.date===date);
      const weight=items.reduce((sum,t)=>sum+(t.type==='exam'?2:1),0),minutes=items.reduce((sum,t)=>sum+(Number(t.estimateMinutes)||0),0);
      if(items.length>=3||weight>=4||minutes>=300)result.push({date,items,minutes});
    }
    return result;
  }
  function workloadWarningHtml(){
    const busy=workloadDays()[0];if(!busy)return '';
    return '<button class="xixu-workload" data-action="search-prefill" data-query="'+esc(busy.date)+'">'+icon('triangle-alert')+'<span><strong>'+esc(dateLabel(busy.date)+'任务较集中')+'</strong><small>'+busy.items.length+' 项截止'+(busy.minutes?'，预计 '+Math.ceil(busy.minutes/60)+' 小时':'')+'，建议提前安排</small></span>'+icon('chevron-right')+'</button>';
  }
  function plannerTimeMinute(value,allowDayEnd=false){
    const match=String(value||'').trim().match(/^(\d{1,2}):(\d{2})$/);if(!match)return NaN;
    const hour=Number(match[1]),minute=Number(match[2]);
    return minute<60&&(hour<24||(allowDayEnd&&hour===24&&minute===0))?hour*60+minute:NaN;
  }
  function busyIntervals(date,excludeTaskId){
    const values=[],append=(start,end)=>{
      if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return;
      const from=Math.max(0,start),to=Math.min(1440,end);if(to>from)values.push([from,to]);
    };
    lessonsOnDate(date,{includeRescheduledOut:false}).forEach(({lesson})=>append(plannerTimeMinute(lessonStart(lesson)),plannerTimeMinute(lessonEnd(lesson),true)));
    tasks.forEach(t=>{
      if((excludeTaskId!=null&&t.id===excludeTaskId)||t.done)return;
      (Array.isArray(t.sessions)?t.sessions:[]).filter(s=>s&&s.date===date&&!s.done).forEach(s=>{
        const start=plannerTimeMinute(s.time),minutes=Number(s.minutes);if(Number.isFinite(minutes)&&minutes>0)append(start,start+minutes);
      });
      // Until explicit event end times exist, use the same conservative one-hour
      // estimate as ordinary tasks. A homework deadline is a point, not a slot.
      if(['task','meeting','exam'].includes(t.type)&&t.date===date){const start=plannerTimeMinute(t.time);append(start,start+60)}
    });
    const merged=[];
    values.sort((a,b)=>a[0]-b[0]||a[1]-b[1]).forEach(([start,end])=>{
      const previous=merged.at(-1);if(previous&&start<previous[1])previous[1]=Math.max(previous[1],end);else merged.push([start,end]);
    });
    return merged;
  }
  function freeSegments(date,excludeTaskId){
    const windows=[[540,720],[840,1080],[1140,1320]],busy=busyIntervals(date,excludeTaskId),result=[];
    for(const [start,end] of windows){let cursor=start;for(const [bs,be] of busy){if(be<=cursor||bs>=end)continue;if(bs>cursor)result.push([cursor,Math.min(bs,end)]);cursor=Math.max(cursor,be);if(cursor>=end)break}if(cursor<end)result.push([cursor,end])}
    if(date===DEMO_DAY){const now=new Date(DEMO_NOW),current=now.getHours()*60+now.getMinutes()+30;return result.map(([a,b])=>[Math.max(a,current),b]).filter(([a,b])=>b-a>=30)}
    return result.filter(([a,b])=>b-a>=30);
  }
  function proposeSessions(task,minutes){
    let remaining=minutes,result=[],date=DEMO_DAY,guard=0;
    const end=task.date||addDays(DEMO_DAY,14);
    while(remaining>0&&date<=end&&guard++<120){
      for(const [start,finish] of freeSegments(date,task.id)){
        if(date===end&&task.time&&start>=minuteOf(task.time))continue;
        const limit=date===end&&task.time?Math.min(finish,minuteOf(task.time)):finish,available=limit-start;if(available<30)continue;
        const length=Math.min(remaining,available,120);if(length<30)continue;
        result.push({id:uid(),date,time:clockOf(start),minutes:length,done:false});remaining-=length;if(remaining<=0)break;
      }
      date=addDays(date,1);
    }
    return {taskId:task.id,total:minutes,remaining,sessions:result};
  }
  function deferOverdueSessions(){
    let moved=0;
    tasks.filter(task=>!task.done&&Array.isArray(task.sessions)).forEach(task=>{
      task.sessions.filter(session=>!session.done&&session.date<DEMO_DAY).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).forEach(session=>{
        const minutes=Math.max(30,Number(session.minutes)||30),deadline=task.date>=DEMO_DAY?task.date:addDays(DEMO_DAY,14);
        let date=DEMO_DAY,slot=null,guard=0;
        while(!slot&&date<=deadline&&guard++<30){
          for(const [start,end] of freeSegments(date)){
            const latest=date===task.date&&task.time?Math.min(end,minuteOf(task.time)):end;
            if(latest-start>=minutes){slot={date,time:clockOf(start)};break}
          }
          if(!slot)date=addDays(date,1);
        }
        if(slot){
          const previous={date:session.date,time:session.time};
          session.date=slot.date;session.time=slot.time;session.deferredFrom=previous;session.deferredAt=new Date(DEMO_NOW).toISOString();
          moved++;
        }
      });
    });
    return moved;
  }
  function renderPlanner(task){
    if(!task)return top('自动安排')+empty('这条事项已经不存在。');
    const estimate=Number(task.estimateMinutes)||120;if(!plannerDraft||plannerDraft.taskId!==task.id)plannerDraft=proposeSessions(task,estimate);
    let html=top('自动安排')+'<div class="xixu-planner-hero">'+icon('calendar-range')+'<div><small>截止 '+esc(dateLabel(task.date)+' '+(task.time||'23:59'))+'</small><strong>'+esc(task.title)+'</strong><span>预计 '+Math.round(estimate/60*10)/10+' 小时</span></div></div>';
    const planningEnd=String(task.date||addDays(DEMO_DAY,14)),lastPlanningDate=planningEnd<addDays(DEMO_DAY,119)?planningEnd:addDays(DEMO_DAY,119);
    if(tasks.some(item=>item.id!==task.id&&!item.done&&['meeting','exam'].includes(item.type)&&item.date>=DEMO_DAY&&item.date<=lastPlanningDate&&Number.isFinite(plannerTimeMinute(item.time))))html+='<div class="tide-note">未设置结束时间的会议/考试暂按1小时占用，请核对。</div>';
    if(plannerDraft.sessions.length)html+='<div class="xixu-session-list">'+plannerDraft.sessions.map((s,i)=>'<div><span>'+esc(dateLabel(s.date)+' '+weekday(s.date))+'</span><strong>'+s.time+' · '+s.minutes+' 分钟</strong><button data-action="remove-plan-session" data-index="'+i+'" aria-label="移除这一段">'+icon('x')+'</button></div>').join('')+'</div>';
    if(plannerDraft.remaining>0)html+='<div class="tide-note">截止前的可用空档不足，还剩 '+plannerDraft.remaining+' 分钟未安排。可以先保存现有安排，再调整课程或任务。</div>';
    html+='<div class="tide-detail-actions"><button class="tide-secondary" data-action="rebuild-plan" data-id="'+esc(task.id)+'">'+icon('refresh-cw')+'重新计算</button><button class="tide-primary" data-action="confirm-plan" data-id="'+esc(task.id)+'" '+(!plannerDraft.sessions.length?'disabled':'')+'>'+icon('check')+'写入计划</button></div><div class="xixu-local-note">'+icon('shield-check')+'确认后才会写入；以后课表或日程冲突时可重新安排。</div>';
    return html;
  }
  function timelineItems(c){
    const items=[];
    tasks.filter(t=>t.course===c.id).forEach(t=>{
      items.push({when:dateTime(t.date,t.time),date:t.date,time:t.time||'',kind:t.done?'已完成':types[t.type],title:t.title,icon:t.done?'check-circle-2':t.type==='exam'?'graduation-cap':'flag',action:'task-detail',id:t.id,muted:t.done});
      (t.sessions||[]).forEach(s=>items.push({when:dateTime(s.date,s.time),date:s.date,time:s.time,kind:'学习计划',title:t.title+' · '+s.minutes+' 分钟',icon:'clock-3',action:'task-detail',id:t.id,muted:s.done}));
    });
    notes.filter(n=>n.course===c.id).forEach(n=>items.push({when:Date.parse(n.createdAt),date:n.createdAt.slice(0,10),time:n.createdAt.slice(11,16),kind:memoryCategoryLabel(n.category),title:n.title||n.text.slice(0,36),icon:'notebook-pen',action:'memory',id:n.id}));
    const startWeek=Math.max(1,teachingWeekOf(DEMO_DAY));
    lessons.filter(l=>l.course===c.id).forEach(l=>{const next=l.weeks.find(w=>w>=startWeek);if(next){const date=addDays(TERM_MONDAY,(next-1)*7+l.day);items.push({when:dateTime(date,lessonStart(l)),date,time:lessonStart(l),kind:'课程',title:roomLabel(l.room),icon:'book-open',action:'lesson',index:lessons.indexOf(l)})}});
    return items.sort((a,b)=>a.when-b.when);
  }
  courseActivityHtml=function(c){
    const items=timelineItems(c);if(!items.length)return '';
    return '<div class="tide-section"><h2>课程时间线</h2><span class="tide-pill">'+items.length+' 项</span></div><div class="xixu-timeline">'+items.map(item=>'<button class="'+(item.muted?'is-muted':'')+'" data-action="'+item.action+'" '+(item.id?'data-id="'+esc(item.id)+'"':'')+' '+(Number.isInteger(item.index)?'data-index="'+item.index+'"':'')+'><span class="xixu-timeline-dot">'+icon(item.icon)+'</span><span><small>'+esc(dateLabel(item.date)+' '+weekday(item.date)+(item.time?' · '+item.time:''))+'</small><strong>'+esc(item.title)+'</strong><em>'+esc(item.kind)+'</em></span>'+icon('chevron-right')+'</button>').join('')+'</div>';
  };

  function relatedSearchResults(query){
    const q=query.trim().toLowerCase();if(!q)return [];
    const result=[];
     courses.forEach(c=>{if(c.name.toLowerCase().includes(q))result.push({kind:'课程',title:c.name,sub:'课程详情与相关笔记',action:'course',id:c.id})});
     tasks.forEach(t=>{const c=course(t.course),hay=[t.title,t.note,c?.name,t.date].join(' ').toLowerCase();if(hay.includes(q))result.push({kind:types[t.type],title:t.title,sub:(c?.name||'个人安排')+' · '+t.date,action:'task-detail',id:t.id})});
     notes.forEach(n=>{const c=course(n.course),hay=[n.title,n.text,n.category,memoryCategoryLabel(n.category),c?.name,n.createdAt].join(' ').toLowerCase();if(hay.includes(q))result.push({kind:memoryCategoryLabel(n.category),title:n.title||n.text.slice(0,32),sub:(c?.name||'个人笔记')+' · '+n.createdAt.slice(0,10),action:'memory',id:n.id})});
     scratchEntries.forEach(item=>{const hay=[item.text,item.createdAt,item.updatedAt].join(' ').toLowerCase();if(hay.includes(q))result.push({kind:'碎片',title:scratchTitle(item.text),sub:'记录于 · '+scratchTime(item.updatedAt||item.createdAt),action:'scratch-detail',id:item.id})});
    return result.slice(0,60);
  }
  function searchHighlight(value,query){
    const text=String(value||''),needle=String(query||'').trim();if(needle.length<2)return esc(text);
    const index=text.toLowerCase().indexOf(needle.toLowerCase());if(index<0)return esc(text);
    return esc(text.slice(0,index))+'<mark>'+esc(text.slice(index,index+needle.length))+'</mark>'+esc(text.slice(index+needle.length));
  }
  function renderSearch(){
    const found=relatedSearchResults(searchQuery);
    return top('搜索与关联')+'<form id="xixu-search-form" class="xixu-search-form"><label><span>'+icon('search')+'</span><input name="query" maxlength="80" value="'+esc(searchQuery)+'" placeholder="搜索课程、任务、碎片或笔记" aria-label="搜索内容"></label><button class="tide-primary" type="submit">搜索</button></form>'+(searchQuery?(found.length?'<div class="xixu-search-results">'+found.map(item=>'<button data-action="'+item.action+'" data-id="'+esc(item.id)+'"><span class="tide-pill">'+esc(item.kind)+'</span><strong>'+searchHighlight(item.title,searchQuery)+'</strong><small>'+searchHighlight(item.sub,searchQuery)+'</small>'+icon('chevron-right')+'</button>').join('')+'</div>':empty('没有找到相关内容。')):'<div class="tide-note">可以一起查找课程、任务、随手写下的碎片和正式笔记。</div>');
  }
   function scratchTitle(text){return String(text||'').split(/\r?\n/).map(line=>line.trim()).find(Boolean)?.slice(0,80)||'未命名碎片'}
  function scratchTime(value){
     const date=new Date(value),now=new Date();if(Number.isNaN(date.getTime()))return '刚刚';
    const sameDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(date)===new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(now);
     return date.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:sameDay?undefined:'short',day:sameDay?undefined:'numeric',hour:'numeric',minute:'2-digit',hour12:false});
  }
  function scratchComposer(compact=false){
    return '<form id="xixu-scratch-form" class="xixu-scratch-composer '+(compact?'is-compact':'')+'"><textarea name="scratchText" maxlength="5000" rows="'+(compact?'1':'3')+'" placeholder="记下一点想法…" aria-label="记录一条碎片" required>'+esc(scratchInputDraft)+'</textarea><div><button type="submit" aria-label="收下这条碎片">'+icon('arrow-up')+'</button></div></form>';
  }
  function scratchRows(limit=Infinity){
    const list=scratchEntries.slice().sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt))).slice(0,limit);
     if(!list.length)return '<div class="xixu-scratch-empty">给还没想清楚的念头留一点空间。</div>';
    return '<div class="xixu-scratch-stream">'+list.map(item=>'<button data-action="scratch-detail" data-id="'+esc(item.id)+'"><time>'+esc(scratchTime(item.updatedAt||item.createdAt))+'</time><span>'+esc(item.text)+'</span>'+icon('arrow-up-right')+'</button>').join('')+'</div>';
  }
  function renderScratchDock(){
    const expanded=scratchDockExpanded||Boolean(scratchInputDraft.trim());
    return '<section class="xixu-scratch-dock '+(expanded?'is-expanded':'')+'"><div class="xixu-scratch-head"><button class="xixu-scratch-toggle" data-action="scratch-toggle" aria-expanded="'+expanded+'"><span><small>碎片记录</small><h2>先记下来</h2></span><em>'+(scratchEntries.length?scratchEntries.length+' 条碎片':'')+'</em>'+icon(expanded?'chevron-up':'chevron-down')+'</button>'+(expanded?'<button data-action="scratch-open">查看全部 '+icon('arrow-up-right')+'</button>':'')+'</div>'+(expanded?scratchComposer(true)+(scratchEntries.length?scratchRows(2):''):'')+'</section>';
  }
  function renderScratch(){
    return top('碎片流')+'<div class="xixu-scratch-intro"><small>NO LABELS, NO PRESSURE</small><strong>还不知道它是什么，也可以先留下。</strong></div>'+scratchComposer()+scratchRows();
  }
  function renderScratchDetail(id){
     const item=scratchEntries.find(entry=>entry.id===id);if(!item)return top('碎片记录')+empty('这条碎片已经不存在了。');
    return top('编辑碎片')+'<form id="xixu-scratch-edit-form" class="xixu-scratch-editor" data-id="'+esc(item.id)+'"><time>'+esc(scratchTime(item.updatedAt||item.createdAt))+'</time><textarea name="scratchText" maxlength="5000" rows="8" required>'+esc(item.text)+'</textarea><button class="tide-primary" type="submit">'+icon('check')+'保存修改</button></form><div class="xixu-scratch-decide"><span>等你想清楚了，再把它放到合适的地方</span><div><button data-action="scratch-to-task" data-id="'+esc(item.id)+'">'+icon('circle-check-big')+'<strong>变成任务</strong></button><button data-action="scratch-to-note" data-id="'+esc(item.id)+'">'+icon('notebook-pen')+'<strong>收进笔记</strong></button><button data-action="scratch-to-agent" data-id="'+esc(item.id)+'">'+icon('sparkles')+'<strong>交给助手</strong></button></div></div><button class="tide-delete" data-action="scratch-delete" data-id="'+esc(item.id)+'">删除这条碎片</button>';
  }
  function categorizeMemory(text){if(/梦|醒来|睡/.test(text))return '梦境';if(/会议|开会|讨论/.test(text))return '会议';if(/想法|灵感|突然想到/.test(text))return '想法';if(/经历|今天|发生/.test(text))return '经历';return '笔记'}
  function memoryCategoryLabel(value,plural=false){
     const labels={'笔记':['笔记','笔记'],'想法':['想法','想法'],'会议':['会议','会议'],'经历':['经历','经历'],'梦境':['梦境','梦境']};
     return labels[value]?.[plural?1:0]||value||(plural?'笔记':'笔记');
  }
  function noteTimestamp(value,compact=false){
    const raw=String(value??'');if(!raw)return '未知';
    const calendar=raw.match(/^(\d{4}-\d{2}-\d{2})(?:$|[T ])/);if(!calendar)return '未知';
    const calendarDate=new Date(calendar[1]+'T12:00:00Z');if(Number.isNaN(calendarDate.getTime())||calendarDate.toISOString().slice(0,10)!==calendar[1])return '未知';
    if(/^\d{4}-\d{2}-\d{2}$/.test(raw)){
      return raw.replaceAll('-', '/')+'（未提供具体时间）';
    }
    const local=raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if(local){if(Number(local[2])>23||Number(local[3])>59||Number(local[4]||0)>59)return '未知';return local[1].replaceAll('-', '/')+' '+local[2]+':'+local[3]+(!compact&&local[4]?':'+local[4]:'')}
    if(!/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw))return '未知';
    const date=new Date(raw);if(Number.isNaN(date.getTime()))return '未知';
    const parts=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(compact?{}:{second:'2-digit'}),hourCycle:'h23'}).formatToParts(date),valueOf=type=>parts.find(part=>part.type===type)?.value||'';
    return valueOf('year')+'/'+valueOf('month')+'/'+valueOf('day')+' '+valueOf('hour')+':'+valueOf('minute')+(compact?'':':'+valueOf('second'));
  }
  function noteTimestampHtml(note,kind='edited',compact=false){
    const field=kind==='created'?'createdAt':kind==='imported'?'importedAt':'updatedAt',label=kind==='created'?'创建时间':kind==='imported'?'导入时间':'上次编辑',raw=String(note?.[field]??''),formatted=noteTimestamp(raw,compact),valid=formatted!=='未知';
    const zoneLabel=valid&&!compact&&!/^\d{4}-\d{2}-\d{2}$/.test(raw)?(/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)?'（北京时间）':'（源时区未提供）'):'';
    return '<time class="xixu-note-timestamp '+(compact?'is-compact':'')+'" data-note-timestamp="'+kind+'"'+(valid?' datetime="'+esc(raw)+'"':'')+(raw?' title="原始时间：'+esc(raw)+'"':'')+'>'+label+'：'+esc(formatted)+zoneLabel+'</time>';
  }
  function noteLinks(text){
    const values=String(text||'').match(/https?:\/\/[^\s<>"']+/gi)||[];
    return [...new Set(values.map(value=>value.replace(/[，。；：！？、,.!?;:）)】\]]+$/g,'')).filter(value=>{try{const url=new URL(value);return url.protocol==='http:'||url.protocol==='https:'}catch(_){return false}}))].slice(0,30);
  }
  function noteLinkLabel(value){try{const url=new URL(value);return (url.hostname||value)+(url.pathname&&url.pathname!=='/'?url.pathname:'')}catch(_){return value}}
  function noteLinksHtml(text){
    const links=noteLinks(text);if(!links.length)return '';
     return '<div class="tide-section"><h2>网页链接</h2><span class="tide-pill">'+links.length+' 个链接</span></div><div class="xixu-note-links">'+links.map(value=>'<button type="button" data-action="open-note-link" data-url="'+esc(value)+'">'+icon('external-link')+'<span><strong>'+esc(noteLinkLabel(value))+'</strong><small>'+esc(value)+'</small></span>'+icon('chevron-right')+'</button>').join('')+'</div>';
  }
  function renderNotes(){
    const query=noteSearch.trim().toLowerCase(),list=notes.slice().filter(note=>!query||[note.title,note.text,note.category,memoryCategoryLabel(note.category),course(note.course)?.name].join(' ').toLowerCase().includes(query)).sort((a,b)=>String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)));
    const categories=['笔记','想法','会议','经历','梦境'].map(name=>[name,notes.filter(note=>note.category===name).length]).filter(([,count])=>count).slice(0,4);
     let html='<header class="xixu-notes-head"><div><span>笔记索引</span><h1>全部笔记</h1><small>'+notes.length+' 条笔记，按最近更新排序</small></div><div class="xixu-notes-actions"><button class="tide-icon" data-action="search-open" aria-label="搜索全部内容">'+icon('search')+'</button><button class="tide-icon xixu-agent-entry" data-action="agent-open" aria-label="让汐序查找并整理笔记">'+icon('sparkles')+'</button></div></header>';
     if(categories.length)html+='<div class="xixu-note-index" aria-label="笔记分类">'+categories.map(([name,count])=>'<span><strong>'+count+'</strong>'+esc(memoryCategoryLabel(name,count!==1))+'</span>').join('')+'</div>';
     html+='<div class="xixu-notes-toolbar"><form id="xixu-note-search" class="xixu-note-search"><label>'+icon('search')+'<input name="noteSearch" value="'+esc(noteSearch)+'" maxlength="80" placeholder="搜索你的笔记" aria-label="搜索笔记"></label>'+(noteSearch?'<button type="button" data-action="clear-note-search">清除</button>':'')+'</form><button class="xixu-note-create" data-action="new-memory" aria-label="新建笔记">'+icon('plus')+'<span>新建笔记</span></button></div>';
     if(list.length)html+='<div class="xixu-note-list">'+list.map((note,index)=>'<button class="xixu-note-card" data-action="memory" data-id="'+esc(note.id)+'"><b aria-hidden="true">'+String(index+1).padStart(2,'0')+'</b><span><strong>'+esc(note.title||'未命名笔记')+'</strong><small>'+esc(memoryCategoryLabel(note.category))+(course(note.course)?' · '+esc(course(note.course).name):'')+(noteImageCount(note)?' · '+noteImageCount(note)+' 张图片':'')+'</small>'+noteTimestampHtml(note,'edited',true)+'<em>'+esc(note.text.replace(/\s+/g,' ').slice(0,88))+'</em></span>'+icon('arrow-up-right')+'</button>').join('')+'</div>';
     else html+=empty(noteSearch?'没有找到相关笔记。':'还没有笔记，先记下脑海里的想法吧。');
    return html;
  }
  function renderMemory(id){
    const selected=id?notes.find(n=>n.id===id):null;
    const editorKey=selected?.id||'__new';if(noteImageDraftKey!==editorKey){noteImageDraftKey=editorKey;noteImageDraft=normalizeAttachments(selected?.images)}
    const savedValue=selected||{title:'',text:'',category:'笔记',course:'',images:[]},value=noteEditorDraft?.key===editorKey?{...savedValue,title:noteEditorDraft.title,text:noteEditorDraft.text}:savedValue;
    const linked=Boolean(value.course&&course(value.course)),timestamps=selected?'<div class="xixu-note-timestamps">'+noteTimestampHtml(selected)+noteTimestampHtml(selected,'created')+(selected.importedAt?noteTimestampHtml(selected,'imported'):'')+'</div>':'';
     const selectableCourses=linkableCourses(),picker=selectableCourses.length?'<label id="xixu-note-course-picker" '+(linked?'':'hidden')+'>关联课程<select name="course">'+selectableCourses.map(c=>'<option value="'+c.id+'" '+(value.course===c.id?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label>':'<div class="tide-note" id="xixu-note-course-picker" hidden>暂时没有可关联的课程，请先导入并核对课表。</div>';
     return top(selected?'编辑笔记':'新建笔记')+'<form id="xixu-note-form" class="xixu-note-editor" data-id="'+esc(selected?.id||'')+'"><input class="xixu-note-title" name="noteTitle" value="'+esc(value.title)+'" placeholder="标题">'+timestamps+'<textarea class="xixu-note-body" name="noteText" maxlength="50000" placeholder="从这里开始写…">'+esc(value.text)+'</textarea><div class="xixu-note-save-state '+(noteEditorDraft?.key===editorKey?'is-saved':'')+'" aria-live="polite">'+(noteEditorDraft?.key===editorKey?'草稿已保存':'')+'</div><div class="xixu-attachment-field"><span>笔记图片（可选）</span><label class="xixu-attachment-add">'+icon('image-plus')+'添加图片<input id="xixu-note-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div><div id="xixu-note-image-list" class="xixu-attachment-grid">'+attachmentDraftHtml(noteImageDraft,'note')+'</div><div class="xixu-note-meta"><label>关联课程<select name="courseRelation" id="xixu-note-course-relation"><option value="none" '+(linked?'':'selected')+'>不关联课程</option><option value="linked" '+(linked?'selected':'')+'>关联课程</option></select></label>'+picker+'</div><div class="xixu-note-editor-actions"><button class="tide-secondary" type="button" data-action="note-to-agent" data-id="'+esc(selected?.id||'')+'">'+icon('wand-sparkles')+'让汐序整理</button><button class="tide-primary" type="submit">'+icon('check')+'保存</button></div></form>'+noteLinksHtml(value.text)+(selected?'<button class="tide-delete" data-action="delete-memory" data-id="'+esc(selected.id)+'">删除这条笔记</button>':'');
  }

  function decodeNoteFile(buffer){
    const bytes=new Uint8Array(buffer);if(bytes.length>=2&&bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    if(bytes.length>=2&&bytes[0]===254&&bytes[1]===255){const swapped=new Uint8Array(bytes.length-2);for(let index=2;index+1<bytes.length;index+=2){swapped[index-2]=bytes[index+1];swapped[index-1]=bytes[index]}return new TextDecoder('utf-16le').decode(swapped)}
    return new TextDecoder('utf-8').decode(bytes[0]===239&&bytes[1]===187&&bytes[2]===191?bytes.subarray(3):bytes);
  }
  function htmlNote(raw){
    const documentValue=new DOMParser().parseFromString(raw,'text/html');
    documentValue.querySelectorAll('script,style,noscript').forEach(node=>node.remove());
    documentValue.querySelectorAll('a[href]').forEach(anchor=>{const href=anchor.getAttribute('href')||'';if(/^https?:\/\//i.test(href)&&!String(anchor.textContent||'').includes(href))anchor.append(documentValue.createTextNode(' '+href))});
    return {title:String(documentValue.querySelector('title')?.textContent||'').trim(),text:String(documentValue.body?.innerText||documentValue.body?.textContent||'').replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim()};
  }
  function titleFromFile(fileName,text,preferred=''){
    const base=String(fileName||'').replace(/\.[^.]+$/,'').trim(),first=String(text||'').split(/\r?\n/).map(line=>line.trim()).find(Boolean)||'';
    return preferred?String(preferred):String(((!base||/^(note|notes|备忘录|新建备忘录|未命名)(?:[-_ ]?\d+)?$/i.test(base))?first:base)||first||'导入的笔记').slice(0,80);
  }
  function jsonNotes(value,fileName,lastModified,result=[]){
    if(result.length>=500)throw Error('每个 JSON 最多 500 条笔记，未截取或导入');
    if(Array.isArray(value)){value.forEach(item=>jsonNotes(item,fileName,lastModified,result));return result}
    if(!value||typeof value!=='object')return result;
    for(const key of ['notes','items','records','data']){if(Array.isArray(value[key])){jsonNotes(value[key],fileName,lastModified,result);return result}}
    const body=value.text??value.content??value.body??value.note??value.description;
    if(typeof body==='string'&&body.trim()){
      const parsed=/<(?:html|body|div|p|br|span|h[1-6]|a)\b/i.test(body)?htmlNote(body):{title:'',text:body};
      if(parsed.text)result.push({title:titleFromFile(fileName,parsed.text,String(value.title??value.name??value.subject??parsed.title??'')),text:parsed.text,createdAt:String(value.createdAt??''),updatedAt:String(value.updatedAt??value.modifiedAt??''),sourceFileModifiedAt:lastModified});
    }
    return result;
  }
  async function notesFromFile(file,index,selection){
    const extension=(file.name.split('.').pop()||'').toLowerCase(),sourceFileModifiedAt=file.lastModified?new Date(file.lastModified).toISOString():'',bytes=await archiveSelectedBytes(file,index,selection);
    selection.totalBytes=(selection.totalBytes||0)+bytes.length;if(selection.totalBytes>25*1024*1024)throw Error('所选文件实际总大小超过 25 MiB，未截断或新增笔记');
    if(extension==='json'){
      let value;try{value=JSON.parse(documentText(bytes))}catch(_){throw Error('“'+file.name+'” 不是有效的 JSON 文件')}
      const items=jsonNotes(value,file.name,sourceFileModifiedAt),originalHash=await archiveSha(bytes);await archiveStore(bytes,originalHash);
      for(const item of items){if(item.text.length>50000)throw Error('JSON 中有笔记超过 50000 字符，未截断导入');item.archive={version:2,format:'json',fileName:file.name,fileBytes:bytes.length,originalHash,textHash:await archiveSha(new TextEncoder().encode(item.text)),images:[],layout:[{kind:'text',text:item.text}],warnings:['此条是 JSON 的文字投影；完整 JSON 原文件可从本条导出。']}}
      return items;
    }
    const parsed=await parseArchiveDocument(bytes,file.name),archive=await archiveDocumentProjection(parsed,bytes);
    return [{title:parsed.title,text:parsed.text,images:[],createdAt:parsed.createdAt||'',updatedAt:parsed.updatedAt||'',sourceFileModifiedAt,archive}];
  }
  async function prepareNoteImport(fileList){
    if(noteImportBusy)return;
    const files=Array.from(fileList||[]);noteImportError='';noteImportDraft=[];
    if(!files.length)return;if(files.length>500){notify('一次最多选择 500 个文件。');return}
    if(files.reduce((sum,file)=>sum+file.size,0)>25*1024*1024){notify('所选文件总大小不能超过 25 MB。');return}
    const allowed=/\.(txt|md|markdown|csv|html?|json|docx|pdf|png|jpe?g|webp)$/i,unsupported=files.filter(file=>!allowed.test(file.name));
    if(unsupported.length){notify('支持 TXT、Markdown、CSV、HTML、JSON、DOCX、PDF 和图片；hdoc、旧版 DOC 暂未支持。');return}
    const selection={},generation=++noteImportGeneration;noteImportBusy=true;openPanel({kind:'note-import'});
    try{
      if(storageBlocked)throw Error('本机资料读取异常，未导入');
      const signature=item=>item.archive?item.archive.originalHash+'\n'+item.archive.fileName+'\n'+item.title+'\n'+item.text:item.title+'\n'+item.text;
      const groups=[];for(let index=0;index<files.length;index++){if(generation!==noteImportGeneration)return;groups.push(await notesFromFile(files[index],index,selection));await archiveYield()}
      if(generation!==noteImportGeneration)return;
      const items=groups.flat().filter(item=>item.text||noteImageCount(item));if(items.length+notes.length>5000)throw Error('导入后会超过 5000 条笔记，未截断或新增');
      const existing=new Set(notes.map(signature)),within=new Set();
      noteImportDraft=items.map((item,index)=>{const key=signature(item),duplicate=existing.has(key)||within.has(key);within.add(key);return {...item,index,duplicate}});
      if(!noteImportDraft.length){notify('这些文件中没有找到可导入的笔记或图片。');return}
      openPanel({kind:'note-import'});
    }catch(error){if(generation===noteImportGeneration){noteImportDraft=[];noteImportError=String(error?.message||error||'无法读取这些文件');openPanel({kind:'note-import'})}}
    finally{if(window.XixuFile&&selection.id!==undefined)window.XixuFile.finish(selection.id);if(generation===noteImportGeneration){noteImportBusy=false;if(panel?.kind==='note-import')render(false)}}
  }
  function renderNoteImport(){
    if(noteImportBusy)return top('读取文档')+'<p class="tide-note" role="status">正在核对文字、图片和原文件…确认前不会加入备忘录。可以返回取消。</p>';
    if(noteImportError)return top('导入笔记')+'<div class="tide-note warm" role="alert">'+esc(noteImportError)+'</div><button class="tide-primary tide-full" data-action="pick-note-import">重新选择文件</button><input id="xixu-note-import-files" type="file" multiple accept="'+NOTE_IMPORT_ACCEPT+'" hidden>';
    const available=noteImportDraft.filter(item=>!item.duplicate).length,duplicates=noteImportDraft.length-available;
    return top('核对笔记导入')+'<div class="xixu-import-summary"><strong>'+available+' 条待导入</strong><span>'+(duplicates?duplicates+' 条重复，已自动跳过':'没有发现重复')+'</span></div><div class="tide-note">原文件已在本机暂存并核对哈希，确认后才加入笔记。文字与图文视图用于阅读和检索，不代表完全重建原文档的排版。</div><form id="xixu-note-import-review" class="xixu-note-import-list">'+noteImportDraft.map((item,index)=>'<label class="'+(item.duplicate?'is-duplicate':'')+'"><input type="checkbox" name="noteImport" value="'+index+'" '+(item.duplicate?'disabled':'checked')+'><span><strong>'+esc(item.title)+'</strong><small>'+(item.duplicate?'已有相同原件':noteImageCount(item)+' 张图片 · 保留原件')+'</small><em>'+esc(item.text?item.text.replace(/\s+/g,' ').slice(0,100):noteImageCount(item)+' 张图片')+'</em>'+(item.archive?.warnings||[]).map(text=>'<small>'+esc(text)+'</small>').join('')+'</span></label>').join('')+'<div class="tide-detail-actions"><button class="tide-secondary" type="button" data-action="pick-note-import">重新选择</button><button class="tide-primary" type="submit" '+(!available?'disabled':'')+'>导入选中内容</button></div></form><input id="xixu-note-import-files" type="file" multiple accept="'+NOTE_IMPORT_ACCEPT+'" hidden><div class="tide-note">不会修改或删除原文件。请同时备份原件；JSON 索引备份不包含独立原件。</div>';
  }
  function renderNoteImportHelp(){return top('导入笔记文件')+'<div class="tide-note">支持 TXT、Markdown、CSV、HTML、JSON、DOCX、PDF 和 PNG/JPEG/WebP。单个原件最多 20 MiB、每批最多 25 MiB；PDF 最多 50 页。保存前核对提取结果，原文件完整保留。hdoc 和旧版 DOC 尚未解码。</div><button class="tide-primary tide-full" data-action="pick-note-import">选择笔记文件</button><input id="xixu-note-import-files" type="file" multiple accept="'+NOTE_IMPORT_ACCEPT+'" hidden>'}

  const baseImportReview=importReviewHtml;importReviewHtml=function(label){
    return baseImportReview(label);
  };

  function fitComposer(textarea){
    textarea.style.height='auto';textarea.style.height=Math.min(160,textarea.scrollHeight)+'px';
  }
  root.addEventListener('input',event=>{
    if(!event.target.matches('.xixu-scratch-composer textarea,.xixu-agent-composer textarea'))return;
    if(event.target.name==='scratchText')scratchInputDraft=event.target.value;
    fitComposer(event.target);
  });
  const baseDetail=renderDetail;renderDetail=function(t){let html=baseDetail(t);if(t&&isDeadline(t)&&!t.done){const hours=Math.round(t.estimateMinutes/60*10)/10;html=html.replace('<div class="tide-detail-actions">','<button class="xixu-auto-plan-button" data-action="auto-plan" data-id="'+esc(t.id)+'">'+icon('wand-sparkles')+'<span><strong>围绕空闲时间规划</strong><small>'+(t.estimateMinutes?'约 '+hours+' 小时':'先填写预计用时')+'</small></span>'+icon('chevron-right')+'</button><div class="tide-detail-actions">')}return html};
  const baseEditor=renderEditor;renderEditor=function(id,kind){const t=id?getTask(id):null,minutes=Number(t?.estimateMinutes)||0;return baseEditor(id,kind).replace('<label class="tide-field">Notes','<label class="tide-field" id="xixu-estimate-field">预计用时<select name="estimateMinutes"><option value="0">暂不估计</option>'+[30,60,90,120,180,240,360,480].map(value=>'<option value="'+value+'" '+(minutes===value?'selected':'')+'>'+ (value<60?value+' 分钟':value/60+' 小时')+'</option>').join('')+'</select></label><input type="hidden" name="editingId" value="'+esc(id||'')+'"><label class="tide-field">备注')};
  const baseWeekly=renderWeeklyWrap;renderWeeklyWrap=function(){const overdue=sortTasks(tasks.filter(t=>!t.done&&isDeadline(t)&&due(t)<Date.now()));return baseWeekly()+(overdue.length?'<div class="tide-section"><h2>仍待处理</h2><span class="tide-pill warm">'+overdue.length+' 项</span></div>'+overdue.slice(0,8).map(deadlineRow).join(''):'')};
  const baseSettings=renderSettings;renderSettings=function(){return baseSettings()+'<div class="tide-section"><h2>笔记文件</h2></div><div class="xixu-setting-actions"><button data-action="pick-note-import">'+icon('notebook-tabs')+'<span><strong>导入笔记文件</strong><small>保存前预览文字或图片</small></span>'+icon('chevron-right')+'</button></div><input id="xixu-note-import-files" type="file" multiple accept=".txt,.md,.markdown,.html,.htm,.json,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,text/html,application/json,image/png,image/jpeg,image/webp" hidden><div class="tide-section"><h2>搜索与关联</h2></div><div class="xixu-setting-actions"><button data-action="search-open">'+icon('search')+'<span><strong>搜索全部内容</strong><small>一起查找课程、事项和笔记</small></span>'+icon('chevron-right')+'</button><button data-action="memory">'+icon('brain')+'<span><strong>新建笔记</strong><small>留存值得记录的想法</small></span>'+icon('chevron-right')+'</button></div>'};

  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');if(!button)return;const action=button.dataset.action;
    if(action==='auto-plan'){const task=getTask(button.dataset.id);if(!task)return;if(!task.estimateMinutes){openPanel({kind:'edit',id:task.id});notify('先填写预计用时，我再帮你安排');return}plannerDraft=null;openPanel({kind:'planner',id:task.id})}
    else if(action==='remove-plan-session'&&plannerDraft){plannerDraft.sessions.splice(Number(button.dataset.index),1);render()}
    else if(action==='rebuild-plan'){plannerDraft=proposeSessions(getTask(button.dataset.id),Number(getTask(button.dataset.id)?.estimateMinutes)||120);render()}
    else if(action==='confirm-plan'&&plannerDraft){const task=getTask(plannerDraft.taskId);if(task){task.sessions=plannerDraft.sessions;task.plan=task.sessions[0]?.date||task.plan;plannerDraft=null;panel={kind:'detail',id:task.id};queueDelightCue('plan',{id:task.id});render();notify('学习时间已加入计划')}}
    else if(action==='search-open'){searchQuery='';openPanel({kind:'search'})}
    else if(action==='search-prefill'){searchQuery=button.dataset.query||'';openPanel({kind:'search'})}
    else if(action==='scratch-toggle'){scratchDockExpanded=!scratchDockExpanded;render();if(scratchDockExpanded){const textarea=main.querySelector('#xixu-scratch-form textarea');textarea?.focus();if(textarea)fitComposer(textarea)}}
    else if(action==='scratch-open'){openPanel({kind:'scratch'})}
    else if(action==='scratch-detail'){openPanel({kind:'scratch-detail',id:button.dataset.id})}
    else if(action==='scratch-to-task'){const item=scratchEntries.find(entry=>entry.id===button.dataset.id);if(item)openPanel({kind:'edit',type:'task',prefillTitle:scratchTitle(item.text),prefillNote:item.text,sourceScratchId:item.id})}
    else if(action==='scratch-to-note'){
      const index=scratchEntries.findIndex(entry=>entry.id===button.dataset.id);if(index>=0){const item=scratchEntries[index],now=new Date().toISOString(),note={id:uid(),title:scratchTitle(item.text),text:item.text,category:categorizeMemory(item.text),course:'',images:[],createdAt:item.createdAt||now,updatedAt:now};scratchEntries.splice(index,1);notes.unshift(note);panel={kind:'memory',id:note.id};previousPanel=null;queueDelightCue('note-saved',{id:note.id});render();notify('已保存到笔记',()=>{notes=notes.filter(entry=>entry.id!==note.id);scratchEntries.splice(Math.min(index,scratchEntries.length),0,item);panel={kind:'scratch-detail',id:item.id};render()})}
    }
    else if(action==='scratch-to-agent'){const item=scratchEntries.find(entry=>entry.id===button.dataset.id);if(item){agentDraft=null;agentInputDraft='我刚写下这些碎片，请帮我理清它，并告诉我适合继续保留、变成任务，还是整理成笔记。\n\n'+item.text;openPanel({kind:'agent'})}}
    else if(action==='scratch-delete'){
      const index=scratchEntries.findIndex(entry=>entry.id===button.dataset.id);if(index>=0){const removed=scratchEntries.splice(index,1)[0],from=captureMotionBox(button);undoMotionTarget={kind:'scratch',id:removed.id};queueDelightCue('delete',{from,label:'撤销'});panel=null;previousPanel=null;page='today';render();notify('已删除碎片',()=>{scratchEntries.splice(Math.min(index,scratchEntries.length),0,removed);render()})}
    }
    else if(action==='memory'){memoryDraft=null;openPanel({kind:'memory',id:button.dataset.id||''})}
    else if(action==='new-memory'){memoryDraft=null;openPanel({kind:'memory',id:''})}
    else if(action==='pick-note-import'){main.querySelector('#xixu-note-import-files')?.click()}
    else if(action==='note-import-help'){openPanel({kind:'note-import-help'})}
    else if(action==='open-note-link'){const value=button.dataset.url||'';if(window.XixuBrowser?.open){if(!window.XixuBrowser.open(value))notify('无法打开这条链接')}else window.open(value,'_blank','noopener')}
    else if(action==='clear-note-search'){noteSearch='';render()}
    else if(action==='note-to-agent'){const note=notes.find(item=>item.id===(button.dataset.id||'')),title=String(main.querySelector('[name="noteTitle"]')?.value||note?.title||'').trim(),text=String(main.querySelector('[name="noteText"]')?.value||note?.text||'').trim();agentDraft=null;agentInputDraft='帮我整理这条笔记，并根据内容自动判断分类。\n标题：'+(title||'未命名笔记')+'\n内容：'+text;openPanel({kind:'agent'})}
    else if(action==='discard-memory'){memoryDraft=null;render()}
    else if(action==='confirm-memory'&&memoryDraft){const now=new Date().toISOString();notes.push({...memoryDraft,id:uid(),createdAt:now,updatedAt:now});memoryDraft=null;render();notify('已保存到本机')}
    else if(action==='delete-memory'){const index=notes.findIndex(n=>n.id===button.dataset.id);if(index>=0){const removed=notes.splice(index,1)[0],from=captureMotionBox(button);noteEditorDraft=null;undoMotionTarget={kind:'note',id:removed.id};queueDelightCue('delete',{from,label:'撤销'});panel=null;previousPanel=null;page='notes';render();notify('已删除笔记',()=>{notes.splice(index,0,removed);render()})}}
  });
  root.addEventListener('input',event=>{
    const form=event.target.closest?.('#xixu-note-form');if(!form||!['noteTitle','noteText'].includes(event.target.name))return;
    const state=form.querySelector('.xixu-note-save-state'),key=form.dataset.id||'__new';if(state){state.textContent='正在保存草稿…';state.classList.remove('is-saved')}
    clearTimeout(noteDraftTimer);noteDraftTimer=setTimeout(()=>{noteEditorDraft={key,title:String(form.querySelector('[name="noteTitle"]')?.value||''),text:String(form.querySelector('[name="noteText"]')?.value||'')};try{localStorage.setItem('xixu-note-editor-draft',JSON.stringify(noteEditorDraft))}catch(_){}if(state?.isConnected){state.textContent='草稿已保存';state.classList.add('is-saved')}},650);
  });
  root.addEventListener('change',event=>{
    if(event.target.id==='xixu-note-import-files'){prepareNoteImport(event.target.files);event.target.value='';return}
    if(event.target.id!=='xixu-note-course-relation')return;
    const picker=main.querySelector('#xixu-note-course-picker');if(picker)picker.hidden=event.target.value!=='linked';
  });
  root.addEventListener('submit',async event=>{
    if(event.target.id==='tide-form'){
      const data=new FormData(event.target),editingId=String(data.get('editingId')||''),minutes=Number(data.get('estimateMinutes')||0);
      setTimeout(()=>{const task=editingId?getTask(editingId):tasks.slice().reverse().find(t=>t.title===String(data.get('title')).trim()&&t.date===String(data.get('date')));if(task){task.estimateMinutes=minutes;if(!Array.isArray(task.sessions))task.sessions=[];persist()}},0);
    }else if(event.target.id==='xixu-scratch-form'){
      event.preventDefault();const text=String(new FormData(event.target).get('scratchText')||'').trim();if(!text){notify('先写点内容');return}const now=new Date().toISOString(),item={id:uid(),text,createdAt:now,updatedAt:now};scratchEntries.push(item);scratchInputDraft='';scratchDockExpanded=false;const textarea=event.target.querySelector('textarea');if(textarea)textarea.value='';queueDelightCue('note-saved',{id:item.id,from:captureMotionBox(event.target.querySelector('button[type="submit"]'))});render();notify('碎片已保存');
    }else if(event.target.id==='xixu-scratch-edit-form'){
      event.preventDefault();const item=scratchEntries.find(entry=>entry.id===event.target.dataset.id),text=String(new FormData(event.target).get('scratchText')||'').trim();if(!item||!text)return;item.text=text;item.updatedAt=new Date().toISOString();panel={kind:'scratch'};previousPanel=null;render();notify('碎片已更新');
    }else if(event.target.id==='xixu-search-form'){
      event.preventDefault();searchQuery=String(new FormData(event.target).get('query')||'').trim();queueDelightCue('search',{query:searchQuery});render();
    }else if(event.target.id==='xixu-note-search'){
      event.preventDefault();noteSearch=String(new FormData(event.target).get('noteSearch')||'').trim();queueDelightCue('search',{query:noteSearch});render();
    }else if(event.target.id==='xixu-note-form'){
      event.preventDefault();const data=new FormData(event.target),text=String(data.get('noteText')||'');if(!text.trim()&&!noteImageDraft.length){notify('请添加文字或至少一张图片');return}
      const relation=String(data.get('courseRelation')||'none'),linkedCourse=relation==='linked'?String(data.get('course')||''):'';if(relation==='linked'&&!course(linkedCourse)){notify('请先选择课程');return}
      const id=String(event.target.dataset.id||''),existing=id?notes.find(note=>note.id===id):null,now=new Date().toISOString(),enteredTitle=String(data.get('noteTitle')||''),title=enteredTitle.trim()?enteredTitle:existing&&enteredTitle===existing.title?enteredTitle:text.split(/\r?\n/).find(line=>line.trim())?.trim().slice(0,80)||noteImageDraft[0]?.name?.replace(/\.[^.]+$/,'').slice(0,80)||'未命名笔记',images=normalizeAttachments(noteImageDraft),from=captureMotionBox(event.target),sameBody=existing&&String(existing.text).replace(/\r\n?/g,'\n')===text.replace(/\r\n?/g,'\n');
      const contentChanged=!existing||existing.title!==title||!sameBody||(existing.course||'')!==linkedCourse||JSON.stringify(existing.images||[])!==JSON.stringify(images);
      const note=contentChanged?{...existing,id:existing?.id||uid(),title,text:sameBody?existing.text:text,category:!existing||existing.title!==title||!sameBody?categorizeMemory(title+'\n'+text):existing.category||'笔记',course:linkedCourse,images,createdAt:existing?String(existing.createdAt??''):now,updatedAt:now}:existing;
      if(contentChanged&&note.archive&&!sameBody)note.archiveEdited=true;
      if(contentChanged){if(existing)notes[notes.indexOf(existing)]=note;else notes.push(note)}
      clearTimeout(noteDraftTimer);noteEditorDraft=null;try{localStorage.removeItem('xixu-note-editor-draft')}catch(_){}noteImageDraft=[];noteImageDraftKey='';panel=null;previousPanel=null;page='notes';if(contentChanged)queueDelightCue('note-saved',{id:note.id,from});render();notify(!contentChanged?'内容未变，上次编辑时间保持不变':existing?'笔记已更新':'笔记已保存');
    }else if(event.target.id==='xixu-note-import-review'){
      event.preventDefault();if(noteImportBusy)return;const selected=new Set(new FormData(event.target).getAll('noteImport').map(Number)),chosen=noteImportDraft.filter((item,index)=>selected.has(index)&&!item.duplicate);if(!chosen.length){notify('至少选择一条笔记');return}
      const generation=++noteImportGeneration;noteImportBusy=true;const button=event.target.querySelector('[type="submit"]');button.disabled=true;
      try{
        if(storageBlocked)throw Error('本机资料读取异常，未写入');
        await verifyNoteArchiveSources(chosen);if(generation!==noteImportGeneration)throw Error('导入已取消');
        const now=new Date().toISOString(),added=chosen.map(item=>({id:uid(),title:item.title,text:item.text,category:'笔记',course:'',images:normalizeAttachments(item.images),createdAt:String(item.createdAt??''),updatedAt:String(item.updatedAt??''),importedAt:now,...(item.archive?{archive:item.archive}:{}),...(item.sourceFileModifiedAt?{sourceFileModifiedAt:item.sourceFileModifiedAt}:{})})),oldNotes=notes,oldSaved=lastSaved;
        notes=[...notes,...added];try{const value=JSON.stringify(checkData(snapshot(),false));storageWrite(value);lastSaved=value;saveError.hidden=true}catch(error){notes=oldNotes;lastSaved=oldSaved;throw Error('笔记索引未保存，原有资料未替换；请检查可用空间')}
        noteImportDraft=[];noteImportError='';panel=null;previousPanel=null;page='notes';render(false);notify('已导入 '+added.length+' 条笔记');
      }catch(error){notify(error.message);if(button.isConnected)button.disabled=false}finally{if(generation===noteImportGeneration)noteImportBusy=false}
    }
  });
