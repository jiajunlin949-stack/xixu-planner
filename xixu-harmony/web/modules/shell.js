(() => {
  const root = document.getElementById('tide-planner');
  const main = root.querySelector('#tide-main');
  const nav = root.querySelector('#tide-nav');
  const toast = root.querySelector('#tide-toast');
  const localDay = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let DEMO_DAY = localDay(), DEMO_NOW = Date.now();
  const courses = [];
  const types = {homework:'作业 DDL',exam:'考试',meeting:'会议',task:'每日任务'};
  Object.defineProperty(types,'summary',{value:'每周总结'});
  let tasks = [];
  const blocks = [
    {period:'1–2',start:'08:30',end:'09:55',label:'上午'},
    {period:'3–4',start:'10:15',end:'11:40',label:'上午'},
    {period:'6–7',start:'14:00',end:'15:25',label:'下午'},
    {period:'8–9',start:'15:45',end:'17:10',label:'下午'},
    {period:'11–12',start:'19:00',end:'20:20',label:'晚上'},
    {period:'13–14',start:'20:30',end:'21:50',label:'晚上'},
    {period:'5',start:'11:45',end:'12:25',label:'中午'}
  ];
  const blockPeriods=[[1,2],[3,4],[6,7],[8,9],[11,12],[13,14],[5]];
  const schedulePresets={
    sztu:{name:'深圳技术大学（14 节）',count:14,periods:[['08:30','09:10'],['09:15','09:55'],['10:15','10:55'],['11:00','11:40'],['11:45','12:25'],['14:00','14:40'],['14:45','15:25'],['15:45','16:25'],['16:30','17:10'],['17:15','17:55'],['19:00','19:40'],['19:40','20:20'],['20:30','21:10'],['21:10','21:50']]}
  };
  const copySchedule=(preset='sztu')=>{const value=schedulePresets[preset]||schedulePresets.sztu;return {preset,count:value.count,periods:value.periods.map(([start,end])=>({start,end}))}};
  let scheduleSettings=copySchedule('sztu');
  let scheduleDraft=null;
  function lessonPeriodNumbers(lesson){
    const explicit=String(lesson?.period||'').match(/\d+/g)?.map(Number).filter(value=>value>=1&&value<=24)||[];
    if(explicit.length){const from=Math.min(...explicit),to=Math.max(...explicit);return Array.from({length:to-from+1},(_,index)=>from+index)}
    const indexes=Array.isArray(lesson?.spans)&&lesson.spans.length?lesson.spans:[lesson?.block];
    return [...new Set(indexes.flatMap(index=>blockPeriods[index]||[]))].sort((a,b)=>a-b);
  }
  const periodInfo=number=>scheduleSettings.periods[number-1]||{start:'待确认',end:'待确认'};
  const lessonStart=lesson=>periodInfo(lessonPeriodNumbers(lesson)[0]||1).start;
  const lessonEnd=lesson=>periodInfo(lessonPeriodNumbers(lesson).at(-1)||1).end;
  function lessonOnDate(lesson,date){
    if(lesson.dateOverride)return lesson.dateOverride===date?{lesson,isRescheduledIn:true,isRescheduledOut:false}:null;
    const weekdayIndex=(new Date(date+'T12:00:00Z').getUTCDay()+6)%7,teachingWeek=1+Math.floor((Date.parse(date)-Date.parse(TERM_MONDAY))/604800000);
    if(lesson.day!==weekdayIndex||!lesson.weeks.includes(teachingWeek))return null;
    return {lesson,isRescheduledIn:false,isRescheduledOut:Array.isArray(lesson.cancelledDates)&&lesson.cancelledDates.includes(date)};
  }
  const lessonsOnDate=(date,{includeRescheduledOut=true}={})=>lessons.map(lesson=>lessonOnDate(lesson,date)).filter(item=>item&&(includeRescheduledOut||!item.isRescheduledOut));
  const weekRange = (from,to) => Array.from({length:to-from+1},(_,i)=>from+i);
  const allWeeks = weekRange(1,18), evenWeeks = allWeeks.filter(w=>w%2===0), oddWeeks = allWeeks.filter(w=>w%2===1);
  let TERM_MONDAY = '2026-08-31';
  const lessons = [];
  let page = 'today', panel = null, previousPanel = null, selectedDay = DEMO_DAY;
  let week = Math.max(1,Math.min(20,1+Math.floor((Date.parse(DEMO_DAY)-Date.parse(TERM_MONDAY))/604800000))), day = (new Date(DEMO_DAY+'T12:00:00Z').getUTCDay()+6)%7, tableMode = 'week', agendaMode = 'all';
  let undo = null, undoMotionTarget=null, toastTimer = null, uploadedTimetable = null, reviewLesson = 0;
  const design = {palette:'雾海蓝',radius:22,mascot:true};
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => '<i data-lucide="'+name+'" aria-hidden="true"></i>';
  const course = id => courses.find(c=>c.id===id);
  const roomLabel = value => ['教室待确认','教室待定'].includes(String(value||''))?'教室待确认':String(value||'');
  // Name-based tones also work for PDF/Excel IDs. Allocate distinct hues within
  // the current course list; rendering and switching weeks never change them.
  let courseToneKey='',courseTones=new Map();
  function courseTone(id){
    const names=[...new Set(courses.map(c=>c.name.trim().normalize('NFKC')))].sort();
    const key=JSON.stringify(names);
    if(key!==courseToneKey){
    const used=new Set(),tones=new Map(),hues=[205,270,155,35,335,180,235,85,15,295,125,55];
    names.forEach(name=>{
      let hash=2166136261;for(const ch of name)hash=Math.imul(hash^ch.codePointAt(0),16777619)>>>0;
      let slot=hash%hues.length;
      if(used.size<hues.length){while(used.has(slot))slot=(slot+1)%hues.length}else slot=used.size;
      used.add(slot);tones.set(name,slot<hues.length?hues[slot]:(slot*137.508)%360);
    });
    courseToneKey=key;courseTones=tones;
    }
    const hue=courseTones.get(course(id)?.name.trim().normalize('NFKC'))??205;
    return '--course-fill:hsl('+hue+' 34% 88%);--course-wash:hsl('+hue+' 32% 95%);--course-edge:hsl('+hue+' 24% 57%);--course-ink:hsl('+hue+' 25% 30%)';
  }
  const getTask = id => tasks.find(t=>t.id===id);
  const addDays = (date,n) => new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const due = t => Date.parse(t.date+'T'+(t.time||'23:59')+':00+08:00');
  const sortTasks = list => list.slice().sort((a,b)=>due(a)-due(b));
  const shortWeekdays = ['周一','周二','周三','周四','周五','周六','周日'];
  const dateLabel = date => Number(date.slice(5,7))+'月'+Number(date.slice(8,10))+'日';
  const weekday = date => '周'+'日一二三四五六'[new Date(date+'T12:00:00Z').getUTCDay()];
  const lessonRuleLabel = lesson => {
    const weeks=lesson.weeks||[],range=compactRange(weeks),rule=String(lesson.rule||'');
    const label='第 '+range+' 周';
    if(lesson.dateOverride)return label+' · '+dateLabel(lesson.dateOverride)+' · 调课';
    return label+(/AI 图片校对/.test(rule)?' · AI 图片校对':/PDF 导入/.test(rule)?' · PDF 导入':/图片识别/.test(rule)?' · 图片识别':/手动核对/.test(rule)?' · 手动核对':'');
  };
  const isDeadline = t => t.type!=='task';
  const timingWord = t => ['exam','meeting'].includes(t.type)?'开始':'截止';
  const repeatLabel = value => value==='daily'?'每天':value==='weekly'?'每周同一天':'不重复';
  const active = () => sortTasks(tasks.filter(t=>isDeadline(t)&&!t.done));
  const uid = () => 'u'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  const empty = message => '<div class="tide-empty">'+icon('leaf')+esc(message)+'</div>';
  function relative(t) {
    const h = (due(t)-DEMO_NOW)/3600000;
    if(h<0) return '已逾期';
    if(h<1) return '不足 1 小时';
    if(h<24) return '剩 '+Math.floor(h)+' 小时';
    return '剩 '+Math.floor(h/24)+' 天';
  }
  function icons() { globalThis.lucide?.createIcons({attrs:{width:16,height:16}}); }
  function notify(message,undoAction) {
    clearTimeout(toastTimer); undo=undoAction||null;if(!undo)undoMotionTarget=null;
    toast.innerHTML='<span>'+esc(translateFixedChrome(message))+'</span>'+(undo?'<button data-action="undo">撤销</button>':'<button data-action="dismiss-toast" aria-label="关闭提示">知道了</button>');
    toast.hidden=false; toastTimer=setTimeout(()=>{toast.hidden=true;undo=null;undoMotionTarget=null},12000);
  }
  function heading(title,sub,buddy) {
    return '<header class="tide-heading"><div><div class="tide-eyebrow">'+esc(sub)+'</div><h1>'+esc(title)+'</h1></div><span class="xixu-heading-rule" aria-hidden="true"></span></header>';
  }
  function top(title) {return '<div class="tide-page-top"><button class="tide-icon" data-action="back" aria-label="返回">'+icon('arrow-left')+'</button><h1>'+esc(title)+'</h1></div>';}
  function canNavigateBack() { return Boolean(panel)||page!=='today'||Boolean(window.XixuHasTransientPanel?.()); }
  window.XixuHandleSystemBack=()=>{
    if(window.XixuCloseTransientPanel?.())return true;
    if(panel){panel=previousPanel;previousPanel=null;render();return true;}
    if(page!=='today'){page='today';render();return true;}
    return false;
  };
  function taskRow(t) {
    return '<div class="tide-task '+(t.done?'is-done':'')+'"><label class="tide-task-label"><input type="checkbox" data-toggle="'+esc(t.id)+'" '+(t.done?'checked':'')+' aria-label="'+esc((t.done?'取消完成：':'完成：')+t.title)+'"><span class="tide-task-copy"><span class="tide-task-name">'+esc(t.title)+'</span><span class="tide-task-meta">'+(isDeadline(t)?esc(dateLabel(t.date)+' '+t.time+' '+timingWord(t)):esc(course(t.course)?.name||'给自己的一点小安排'))+'</span></span></label><button class="tide-icon" data-action="task-detail" data-id="'+esc(t.id)+'" aria-label="'+esc('编辑或删除：'+t.title)+'">'+icon('ellipsis')+'</button></div>';
  }
  function courseActivityHtml(c) {
    const items=sortTasks(tasks.filter(t=>t.course===c.id&&!t.done));
    if(!items.length)return '';
    const rows=items.slice(0,8).map(t=>'<button class="xixu-course-activity-item" data-action="task-detail" data-id="'+esc(t.id)+'"><span class="xixu-course-activity-type '+(t.type==='exam'?'is-exam':t.type==='task'?'is-task':'')+'">'+esc(types[t.type])+'</span><span class="xixu-course-activity-copy"><strong>'+esc(t.title)+'</strong><small>'+esc(dateLabel(t.date)+' · '+(t.time||'待定')+(isDeadline(t)?' · '+relative(t):''))+'</small></span>'+icon('chevron-right')+'</button>').join('');
    return '<section class="xixu-course-activity"><div class="xixu-course-activity-head"><h2>课程动态</h2><span>'+items.length+' 项</span></div><div class="xixu-course-activity-list">'+rows+'</div></section>';
  }
  function deadlineRow(t) {
    const urgent = !t.done && due(t)-DEMO_NOW<86400000;
    return '<div class="tide-deadline-row is-'+esc(t.type)+(urgent?' is-urgent':'')+'" data-id="'+esc(t.id)+'"><input type="checkbox" data-toggle="'+esc(t.id)+'" '+(t.done?'checked':'')+' aria-label="'+esc((t.done?'取消完成：':'完成：')+t.title)+'"><button class="tide-deadline-body" data-action="task-detail" data-id="'+esc(t.id)+'"><strong>'+esc(t.title)+'</strong><small>'+esc(t.time+' · '+(course(t.course)?.name||types[t.type]))+(t.repeat!=='none'?' · '+esc(repeatLabel(t.repeat)):'')+'</small></button><span class="tide-pill tide-row-end '+(t.type==='exam'?'lilac':urgent?'urgent':'')+'">'+esc(t.done?'已完成':relative(t))+'</span></div>';
  }
  function renderAgenda() {
    const list=sortTasks(tasks.filter(t=>isDeadline(t)&&(agendaMode==='done'?t.done:!t.done)&&(agendaMode!=='exam'||t.type==='exam')));
    let html=heading('每个截止，都有着落。','',false);
    html+='<div class="xixu-agenda-overview"><strong>'+list.length+'</strong><span>'+(agendaMode==='done'?'项已完成':'项正在时间线上')+'</span><i aria-hidden="true"></i></div>';
    html+='<div class="tide-switch" aria-label="日程范围">'+[['all','待完成'],['exam','考试'],['done','已完成']].map(([k,v])=>'<button data-action="agenda-filter" data-value="'+k+'" aria-pressed="'+(agendaMode===k)+'">'+v+'</button>').join('')+'</div>';
    let lastDate='',stream='';
    list.forEach(t=>{if(t.date!==lastDate){stream+='<div class="tide-date-heading"><strong>'+esc(dateLabel(t.date))+'</strong> '+esc(weekday(t.date))+(t.date.slice(0,4)!=='2026'?' · '+esc(t.date.slice(0,4)):'')+'</div>';lastDate=t.date;}stream+=deadlineRow(t)});
    html+='<div class="xixu-agenda-stream">'+(stream||empty(agendaMode==='done'?'完成的事项会安静地留在这里。':'暂时没有这类事项。'))+'</div>';
    html+='<button class="tide-secondary tide-full xixu-add-deadline" data-action="add">'+icon('plus')+'添加截止事项或考试</button>';
    return html;
  }
  function renderTimetable() {
    let html=heading('课程有序，留白也有。',tableMode==='plan'?'连续日历 · 学习和以后工作都能用':'我的课表 · 按实际教学周显示',false);
    const monday=tableMode==='plan'?planMonday:addDays(TERM_MONDAY,(week-1)*7);
    html+='<div class="tide-weekbar"><button class="tide-icon" data-action="previous-week" aria-label="上一周" '+(tableMode!=='plan'&&week===1?'disabled':'')+'>'+icon('chevron-left')+'</button><div>'+(tableMode==='plan'?'<input type="date" id="xixu-plan-week-date" aria-label="选择计划周" value="'+planMonday+'"><small>'+dateLabel(monday)+' — '+dateLabel(addDays(monday,6))+' · 不受学期限制</small>':'<select id="tide-week-select" aria-label="教学周">'+weekRange(1,20).map(w=>'<option value="'+w+'" '+(w===week?'selected':'')+'>第 '+w+' 周 · '+(w%2?'单周':'双周')+'</option>').join('')+'</select><small>'+dateLabel(monday)+' — '+dateLabel(addDays(monday,6))+'</small>')+'</div><button class="tide-icon" data-action="next-week" aria-label="下一周" '+(tableMode!=='plan'&&week===20?'disabled':'')+'>'+icon('chevron-right')+'</button></div>';
    html+='<div class="tide-switch" aria-label="课表显示方式"><button data-action="table-mode" data-value="week" aria-pressed="'+(tableMode==='week')+'">一周课表</button><button data-action="table-mode" data-value="day" aria-pressed="'+(tableMode==='day')+'">按天看</button><button data-action="table-mode" data-value="plan" aria-pressed="'+(tableMode==='plan')+'">计划周</button></div>';
    const dayNumber=i=>Number(addDays(monday,i).slice(8,10)),now=new Date(DEMO_NOW),nowMinutes=now.getHours()*60+now.getMinutes(),clockMinutes=value=>{const parts=String(value||'').split(':').map(Number);return parts[0]*60+parts[1]},isLiveLesson=lesson=>(lesson.dateOverride||addDays(monday,lesson.day))===DEMO_DAY&&!lesson.cancelledDates?.includes(DEMO_DAY)&&nowMinutes>=clockMinutes(lessonStart(lesson))&&nowMinutes<clockMinutes(lessonEnd(lesson));
    if(tableMode==='week') {
      html+='<div class="tide-week-grid"><div style="grid-column:1;grid-row:1"></div>'+shortWeekdays.map((v,i)=>'<div class="tide-grid-head '+(addDays(monday,i)===DEMO_DAY?'is-today':'')+'" style="grid-column:'+(i+2)+';grid-row:1">'+v+'<b>'+dayNumber(i)+'</b></div>').join('');
      Array.from({length:scheduleSettings.count},(_,index)=>index+1).forEach(period=>{
        const info=periodInfo(period);html+='<div class="tide-grid-time" style="grid-column:1;grid-row:'+(period+1)+'"><b>'+period+'</b><span>'+info.start+'<br>'+info.end+'</span></div>';
        for(let d=0;d<7;d++){
          const occurrence=lessonsOnDate(addDays(monday,d)).find(item=>lessonPeriodNumbers(item.lesson).includes(period)),l=occurrence?.lesson;
          const shade=l?'xixu-course-tone':'';
          const periods=l?lessonPeriodNumbers(l).filter(value=>value<=scheduleSettings.count):[],first=l&&periods[0]===period;
          if(!l)html+='<div class="tide-grid-cell" style="grid-column:'+(d+2)+';grid-row:'+(period+1)+'" aria-hidden="true"></div>';
          else if(first){const span=Math.max(1,periods.at(-1)-period+1),range=periods.length>1?period+'至'+periods.at(-1):String(period),status=occurrence.isRescheduledIn?' 调入':occurrence.isRescheduledOut?' 已调出':'';html+='<button class="tide-grid-cell '+shade+(isLiveLesson(l)?' is-now':'')+(occurrence.isRescheduledIn?' is-rescheduled-in':'')+(occurrence.isRescheduledOut?' is-rescheduled-out':'')+'" style="'+courseTone(l.course)+';grid-column:'+(d+2)+';grid-row:'+(period+1)+' / span '+span+'" data-action="lesson" data-index="'+lessons.indexOf(l)+'" aria-label="'+esc(course(l.course).name+'，'+shortWeekdays[d]+'，第'+range+'节，'+l.room+status)+'"><strong>'+esc(course(l.course).name)+'</strong><small>'+esc(l.room)+(status?' · '+status:'')+'</small></button>'}
        }
      });
      html+='</div>';
    } else if(tableMode==='day') {
      html+='<div class="tide-daystrip">'+shortWeekdays.map((v,i)=>'<button data-action="table-day" data-value="'+i+'" aria-pressed="'+(day===i)+'">'+v+'<strong>'+dayNumber(i)+'</strong></button>').join('')+'</div>';
      const dayLessons=lessonsOnDate(addDays(monday,day)).sort((a,b)=>lessonStart(a.lesson).localeCompare(lessonStart(b.lesson)));
      html+=dayLessons.length?dayLessons.map(({lesson:l,isRescheduledIn,isRescheduledOut})=>'<div class="tide-lesson xixu-course-tone '+(isLiveLesson(l)?'is-now':'')+(isRescheduledIn?' is-rescheduled-in':'')+(isRescheduledOut?' is-rescheduled-out':'')+'" style="'+courseTone(l.course)+'"><div class="tide-lesson-time">'+lessonStart(l)+'<small>'+lessonEnd(l)+'</small></div><button data-action="lesson" data-index="'+lessons.indexOf(l)+'"><strong>'+esc(course(l.course).name)+'</strong><small>'+esc(l.room)+' · '+lessonPeriodNumbers(l).join('–')+' 节'+(isRescheduledIn?' · 调入':isRescheduledOut?' · 已调出':'')+'</small></button></div>').join(''):empty('这一天没有课，留给自己安排。');
    } else html+=renderPlanWeek(monday);
    if(tableMode==='plan'){
      html+='<div class="tide-section"><button class="tide-link" data-action="plan-this-week">'+icon('locate-fixed')+'回到本周</button><button class="tide-link" data-action="plan-slot" data-date="'+DEMO_DAY+'" data-time="19:00">'+icon('plus')+'添加计划</button></div>';
      return html;
    }
    html+='<div class="tide-section"><button class="tide-link" data-action="import">'+icon('scan-line')+'导入 / 更新课表</button><button class="tide-link" data-action="nav" data-page="courses">'+icon('book-open')+'课程档案</button><button class="tide-link" data-action="week-difference">本周变化 '+icon('arrow-up-right')+'</button></div>';
    if(!lessons.length)html+='<div class="tide-note">还没有课表。点击导入，添加自己的学期课表。</div>';
    return html;
  }
  function renderCourses() {
    let html=heading('每一门课的小档案。','课程 · 考核方式 · 作业与原图',true);
    const visibleCourses=linkableCourses();
    if(!visibleCourses.length)return html+'<div class="xixu-ocr-card"><div class="xixu-ocr-heading">'+icon('book-plus')+'<div><strong>先添加第一门课程</strong><span>保存后会直接进入课程档案，再上传考核说明图片。</span></div></div><form id="xixu-course-form" class="tide-form"><label class="tide-field">课程名称<input name="courseName" required maxlength="80" placeholder="输入课程名称"></label><button class="tide-primary tide-full" type="submit">'+icon('plus')+'添加并填写考核方式</button></form></div>';
    html+='<div class="tide-course-list">'+visibleCourses.map(c=>{const n=tasks.filter(t=>t.course===c.id&&!t.done&&isDeadline(t)).length,a=Array.isArray(c.assessment)?c.assessment.length:0;return '<button class="tide-course-card" data-action="course" data-id="'+c.id+'"><span class="tide-course-mark">'+c.mark+'</span><span class="tide-grow"><strong>'+esc(c.name)+'</strong><small>'+(a?'已记录 '+a+' 项考核方式':'可上传图片识别考核方式')+' · '+n+' 项待截止</small></span>'+icon('chevron-right')+'</button>'}).join('')+'</div><div class="tide-section"><h2>新增课程</h2></div><form id="xixu-course-form" class="tide-form"><label class="tide-field">课程名称<input name="courseName" required maxlength="80" placeholder="输入课程名称"></label><button class="tide-secondary tide-full" type="submit">'+icon('plus')+'添加课程</button></form>';
    return html;
  }
  function renderDetail(t) {
    if(!t) return top('事项')+empty('这条事项已删除。');
    let html=top('事项详情')+'<span class="tide-pill '+(t.type==='exam'?'lilac':'')+'">'+types[t.type]+'</span><div class="tide-detail-title">'+esc(t.title)+'</div><div class="tide-detail-due">'+icon('calendar-clock')+esc(dateLabel(t.date)+' '+weekday(t.date)+(t.time?' · '+t.time:''))+'</div>';
    html+='<div class="tide-surface"><div class="tide-detail-row"><span>关联课程</span><span>'+esc(course(t.course)?.name||'个人安排')+'</span></div><div class="tide-detail-row"><span>计划哪天做</span><span>'+esc(t.plan?dateLabel(t.plan):'尚未安排')+'</span></div><div class="tide-detail-row"><span>重复</span><span>'+esc(t.repeat==='weekly'?'每'+weekday(t.date)+' · '+t.time:repeatLabel(t.repeat))+'</span></div><div class="tide-detail-row"><span>提醒计划</span><span>'+esc(t.reminders.map(h=>h===24?'提前一天':'提前一小时').join('、')||'无')+'</span></div></div>';
    if(t.note) html+='<div class="tide-note" style="white-space:pre-wrap">'+esc(t.note)+'</div>';
    html+=savedAttachmentsHtml(t.images,'任务图片');
    html+='<div class="tide-detail-actions"><button class="tide-secondary" data-action="edit" data-id="'+esc(t.id)+'">'+icon('pencil')+'编辑</button><button class="tide-primary" data-action="toggle" data-id="'+esc(t.id)+'">'+icon(t.done?'undo-2':'check')+(t.done?'取消完成':'标记完成')+'</button></div>';
    if(isDeadline(t)&&!t.done)html+='<button class="tide-link tide-full" data-action="plan" data-id="'+esc(t.id)+'">'+icon('calendar-plus')+(t.plan===DEMO_DAY?'已安排今天':'安排今天做，保留原定时间')+'</button>';
    html+='<button class="tide-delete" data-action="delete" data-id="'+esc(t.id)+'">'+(t.repeat!=='none'?'删除这一次事项':'删除事项')+'</button>';
    return html;
  }
  function renderEditor(id,kind) {
    const old=id?getTask(id):null;
    const editorKey=old?.id||'__new';if(taskImageDraftKey!==editorKey){taskImageDraftKey=editorKey;taskImageDraft=normalizeAttachments(old?.images)}
    const chosenDate=panel.prefillDate||(kind==='task'?selectedDay:DEMO_DAY);
    const t=old||{type:kind||'homework',title:panel.prefillTitle||'',course:panel.course||'',date:chosenDate,time:panel.prefillTime||(kind==='summary'?'20:00':kind==='task'?'':(course(panel.course)?.defaultTime||'23:59')),plan:kind==='task'?chosenDate:'',repeat:kind==='summary'?'weekly':'none',reminders:kind==='task'?[]:[24,1],note:panel.prefillNote||'',images:[]};
    const linked=Boolean(t.course&&course(t.course));
    const selectableCourses=linkableCourses(),coursePicker=selectableCourses.length?'<label class="tide-field" id="tide-course-picker" '+(linked?'':'hidden')+'>选择课程<select name="course">'+selectableCourses.map(c=>'<option value="'+c.id+'" '+(t.course===c.id?'selected':'')+'>'+esc(c.name)+'</option>').join('')+'</select></label>':'<div class="tide-note" id="tide-course-picker" '+(linked?'':'hidden')+'>还没有可关联的完整课程。请先在课表页重新导入并核对课程名称。</div>';
    return top(old?'编辑事项':'添加一件事')+'<form id="tide-form" class="tide-form"><label class="tide-field">事项类型<select name="type" id="tide-type" data-last-type="'+esc(t.type)+'">'+Object.entries(types).map(([k,v])=>'<option value="'+k+'" '+(t.type===k?'selected':'')+'>'+v+'</option>').join('')+'</select></label><label class="tide-field">名称<input name="title" placeholder="填写事项名称" required maxlength="100" value="'+esc(t.title)+'"></label><label class="tide-field">是否关联课程<select name="courseRelation" id="tide-course-relation"><option value="none" '+(linked?'':'selected')+'>不关联课程</option><option value="linked" '+(linked?'selected':'')+'>关联课程</option></select></label>'+coursePicker+'<div class="tide-form-row"><label class="tide-field"><span id="tide-date-label">'+(t.type==='task'?'完成日期':'截止 / 活动日期')+'</span><input type="date" name="date" required value="'+esc(t.date)+'"></label><label class="tide-field" id="tide-time-field">'+(t.type==='task'?'计划时间（可选）':'时间')+'<input type="time" name="time" '+(t.type==='task'?'':'required')+' value="'+esc(t.time||'')+'"></label></div><label class="tide-field" id="tide-plan-field" '+(t.type==='task'?'hidden':'')+'>计划哪天开始做（可留空）<input type="date" name="plan" value="'+esc(t.plan)+'"></label><label class="tide-field">重复<select name="repeat"><option value="none" '+(t.repeat==='none'?'selected':'')+'>不重复</option><option value="daily" '+(t.repeat==='daily'?'selected':'')+'>每天</option><option value="weekly" '+(t.repeat==='weekly'?'selected':'')+'>每周同一天</option></select></label><div id="tide-reminder-field" '+(t.type==='task'?'hidden':'')+'><div class="tide-field" style="margin-bottom:6px">提醒我</div><div class="tide-reminder-options"><label><input name="r24" type="checkbox" '+(t.reminders.includes(24)?'checked':'')+'>提前一天</label><label><input name="r1" type="checkbox" '+(t.reminders.includes(1)?'checked':'')+'>提前一小时</label></div></div><label class="tide-field">备注<textarea name="note" placeholder="提交要求、考点或想记住的事" maxlength="1000">'+esc(t.note)+'</textarea></label><div class="xixu-attachment-field"><span>相关图片（可选）</span><label class="xixu-attachment-add">'+icon('image-plus')+'添加图片<input id="xixu-task-images" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden></label></div><div id="xixu-task-image-list" class="xixu-attachment-grid">'+attachmentDraftHtml(taskImageDraft,'task')+'</div><div id="tide-form-error" class="tide-error" role="alert" hidden></div><button class="tide-primary tide-full" type="submit">'+icon('check')+'保存事项</button><div class="tide-sub">每日任务没有截止时间，只需选择完成日期；计划时间可以不设置。DDL、会议和考试会按时间进入鸿蒙系统提醒。</div></form>';
  }

  function renderCreateHub() {
    return top('添加与管理')+'<div class="xixu-create-intro"><small>PLACE IT RIGHT</small><strong>把一件事，放进正确的位置。</strong><span>先选择它是什么，汐序会保留相应的时间与提醒逻辑。</span></div><div class="xixu-setting-actions xixu-create-actions"><button data-action="create-homework">'+icon('flag')+'<span><strong>添加 DDL / 作业</strong><small>截止日期、课程和提醒</small></span>'+icon('arrow-up-right')+'</button><button data-action="create-exam">'+icon('graduation-cap')+'<span><strong>考试</strong><small>考试时间与课程</small></span>'+icon('arrow-up-right')+'</button><button data-action="create-task" aria-label="添加每日任务">'+icon('check-square')+'<span><strong>每日任务</strong><small>完成日期与可选计划时间</small></span>'+icon('arrow-up-right')+'</button><button data-action="create-meeting">'+icon('users')+'<span><strong>会议</strong><small>开始时间与提醒</small></span>'+icon('arrow-up-right')+'</button><button data-action="new-memory">'+icon('notebook-pen')+'<span><strong>笔记</strong><small>想法、经历与会议记录</small></span>'+icon('arrow-up-right')+'</button><button data-action="manage-items">'+icon('list-checks')+'<span><strong>管理已有事项</strong><small>查看、完成、修改或删除</small></span>'+icon('arrow-up-right')+'</button></div><button class="xixu-agent-hub" data-action="agent-open">'+icon('sparkles')+'<span><small>需要快速录入时</small><strong>告诉汐序秘书一件事</strong><em>只整理信息，确认后才会写入</em></span>'+icon('chevron-right')+'</button>';
  }
  function renderCourse(c) {
    if(!c)return top('课程档案')+empty('这门课程已经不存在。');
    const list=sortTasks(tasks.filter(t=>t.course===c.id&&!t.done&&isDeadline(t)));
    return top('课程档案')+'<div class="tide-detail-title">'+esc(c.name)+'</div><div class="tide-sub">我的课程 · 已保存在本机</div><button class="tide-link tide-full" data-action="edit-course" data-id="'+c.id+'">'+icon('pencil-line')+'修改课程名称</button><div class="tide-section"><h2>考核方式</h2><span class="tide-pill">可修改</span></div>'+assessmentSummaryHtml(c)+'<div id="xixu-assessment-review">'+assessmentReviewHtml(c.id)+'</div><div class="tide-section"><h2>考核说明原图</h2><span class="tide-pill">已保存</span></div>'+(c.image?'<img class="tide-image" src="'+esc(c.image)+'" alt="'+esc(c.name)+'考核说明"><button class="tide-link tide-full" data-action="remove-image" data-id="'+c.id+'">移除原图</button>':'')+'<label class="xixu-image-import xixu-assessment-upload">'+icon('scan-text')+'<strong>'+(c.image?'重新选择图片并识别':'选择图片并识别')+'</strong><span>上传考核说明或成绩截图，确认后再保存。</span><input type="file" id="tide-course-image" accept="image/jpeg,image/png,image/webp" data-course="'+c.id+'"></label>'+(assessmentPending&&assessmentDraft?.courseId===c.id?'<div class="xixu-ocr-progress">'+icon('scan-text')+'<div><strong>正在读取考核方式……</strong><span>请稍等，尚未上传。</span></div></div>':'')+courseActivityHtml(c)+'<button class="tide-link tide-full" data-action="course-add" data-id="'+c.id+'">'+icon('plus')+'添加课程事项</button>';
  }
  function renderLesson() {
     const l=lessons[panel.index];if(!l)return top('课程安排')+empty('这节课已经不存在。');const c=course(l.course), b=blocks[l.block];
     if(!c||!b)return top('课程安排')+empty('这节课已经不存在。');
     return top('课程安排')+'<span class="tide-pill">'+shortWeekdays[l.day]+' · 第 '+lessonPeriodNumbers(l).join('、')+' 节</span><div class="tide-detail-title">'+esc(c.name)+'</div><div class="tide-detail-due">'+icon('map-pin')+esc(roomLabel(l.room))+'</div><div class="tide-surface"><div class="tide-detail-row"><span>上课时间</span><span>'+esc(lessonStart(l)+' — '+lessonEnd(l))+'</span></div><div class="tide-detail-row"><span>教学周</span><span>'+esc(lessonRuleLabel(l))+'</span></div><div class="tide-detail-row"><span>来源</span><span>'+(/图片识别|AI 图片校对/.test(String(l.rule||''))?'图片导入':'本机课表')+'</span></div></div>'+courseActivityHtml(c)+'<div class="tide-detail-actions"><button class="tide-secondary" data-action="course" data-id="'+c.id+'">'+icon('book-open')+'课程档案</button><button class="tide-primary" data-action="edit-lesson" data-index="'+panel.index+'">'+icon('pencil')+'修改排课</button></div>';
  }
  function renderLessonEdit(){
     const l=lessons[panel.index],c=l&&course(l.course);if(!l||!c)return top('修改课程安排')+empty('这节课已经不存在。');
    const matches=String(l.period||blocks[l.block].period).match(/\d+/g)||[],start=Number(matches[0])||1,end=Number(matches.at(-1))||start,weeks=(l.weeks||[]).join('、');
    const periodCount=Math.max(scheduleSettings.count,start,end);
    return top('修改课程安排')+'<form id="xixu-lesson-form" class="tide-form"><label class="tide-field">课程名称<input name="lessonCourseName" required maxlength="80" value="'+esc(c.name)+'"></label><label class="tide-field">教室<input name="lessonRoom" required maxlength="80" value="'+esc(roomLabel(l.room))+'"></label><label class="tide-field">星期<select name="lessonDay">'+Array.from({length:7},(_,i)=>'<option value="'+i+'" '+(i===l.day?'selected':'')+'>'+shortWeekdays[i]+'</option>').join('')+'</select></label><div class="tide-form-row"><label class="tide-field">开始节次<select name="lessonStart">'+Array.from({length:periodCount},(_,i)=>'<option value="'+(i+1)+'" '+(i+1===start?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></label><label class="tide-field">结束节次<select name="lessonEnd">'+Array.from({length:periodCount},(_,i)=>'<option value="'+(i+1)+'" '+(i+1===end?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></div><label class="tide-field">教学周<input name="lessonWeeks" required maxlength="80" value="'+esc(weeks)+'" placeholder="例如：1-16 或 1、3、5"></label><button class="tide-primary tide-full" type="submit">'+icon('check')+'保存修改</button><button class="tide-delete tide-full" type="button" data-action="delete-lesson" data-index="'+panel.index+'">删除这节课</button></form>';
  }
   function renderCourseEdit(){const c=course(panel.id);if(!c)return top('修改课程名称')+empty('这门课程已经不存在。');return top('修改课程名称')+'<form id="xixu-course-edit-form" class="tide-form"><label class="tide-field">课程名称<input name="courseEditName" required maxlength="80" value="'+esc(c.name)+'"></label><button class="tide-primary tide-full" type="submit">'+icon('check')+'保存课程名称</button><button class="tide-delete tide-full" type="button" data-action="delete-course" data-id="'+esc(c.id)+'">删除课程及其排课</button></form>'}
  function renderImport() {
    return top('导入 / 更新课表')+'<div class="xixu-import-intro"><h2>把课表带入汐序。</h2><p>选择学校课表文件，核对内容后再更新。</p></div><section class="xixu-file-card" aria-label="导入学校课表文件"><label class="xixu-file-picker"><span class="xixu-file-symbol" aria-hidden="true">'+icon('file-up')+'</span><strong id="xixu-file-name">选择课表文件</strong><span class="xixu-file-description" id="xixu-file-description">PDF、Excel 或汐序 JSON · 最大 20 MB</span><span class="xixu-file-cta" aria-hidden="true">浏览文件 '+icon('arrow-up-right')+'</span><input type="file" id="xixu-import" aria-label="课表文件" aria-describedby="xixu-file-description" accept=".pdf,.xls,.xlsx,.json,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/json"></label><div class="xixu-import-assurance">'+icon('shield-check')+'<span>仅在本机读取 · 确认后才会保存</span></div></section><div id="xixu-import-review" aria-live="polite"></div><div class="xixu-import-divider"><span>也可以从图片开始</span></div><div class="xixu-ocr-card"><div class="xixu-ocr-heading">'+icon('scan-text')+'<div><strong>扫描课表截图</strong><span>读取教学周、课程、节次和教室</span></div></div><label class="xixu-image-import">'+icon('image-up')+'<strong>选择截图或照片</strong><span>包含星期、节次、课程和教室的完整截图，识别效果更好。</span><input type="file" id="xixu-ocr-image" aria-label="选择课表截图或照片" accept="image/*"></label><div id="xixu-ocr-review" aria-live="polite"></div><div class="xixu-local-note">'+icon('shield-check')+'默认在本机识别；只有主动选择 AI 校对时才会发送图片。</div></div>';
  }
  function renderSchool() {
    return top('学校课表更新')+'<div class="tide-surface"><div class="tide-inline">'+icon('school')+'<h2>深圳技术大学</h2></div><div class="tide-detail-row"><span>连接状态</span><span class="tide-pill warm">未连接</span></div><div class="tide-detail-row"><span>同步内容</span><span>课程、教室、节次和教学周</span></div><div class="tide-detail-row"><span>更新方式</span><span>手动</span></div></div><div class="tide-note">这里是学校课表连接入口的预览。完整版本需要学校登录和验证流程；当前不会收集学号或密码。</div><button class="tide-primary tide-full" data-action="school-preview">'+icon('refresh-cw')+'查看更新流程</button><div id="tide-school-flow" hidden class="tide-surface" style="margin-top:16px"><div class="tide-detail-row"><span>01</span><span>在学校登录页面完成验证</span></div><div class="tide-detail-row"><span>02</span><span>读取本学期课程与单双周安排</span></div><div class="tide-detail-row"><span>03</span><span>核对变化后更新课表</span></div><div class="tide-sub">此预览不会连接学校系统。</div></div>';
  }
  function renderPhotoImport() {
    return top('图片导入')+'<label class="tide-field">选择课表截图或照片<input id="tide-timetable-image" type="file" accept="image/jpeg,image/png,image/webp"></label>'+(uploadedTimetable?'<img class="tide-image" src="'+esc(uploadedTimetable)+'" alt="已选择的课表图片"><div class="tide-note">图片已选择。当前原型不会在这里执行图片识别，下面展示的是用已有课表模拟的核对流程。</div>':'<div class="tide-note">可以体验图片 → 核对 → 课表的流程。示例结果使用当前课表，不会假装识别了新图片。</div>')+'<button class="tide-primary tide-full" data-action="review-import">'+icon('list-checks')+'查看示例结果</button>';
  }
  function renderReview() {
    const l=lessons[reviewLesson],c=course(l.course),b=blocks[l.block];
    return top('核对识别结果')+'<div class="tide-sub">示例结果 · 可以逐项编辑课程和教室</div><label class="tide-field" style="margin:16px 0">核对项目<select id="tide-review-select">'+lessons.map((v,i)=>'<option value="'+i+'" '+(reviewLesson===i?'selected':'')+'>'+esc(course(v.course).short)+' · '+shortWeekdays[v.day]+' · 第 '+blocks[v.block].period+' 节</option>').join('')+'</select></label><form id="tide-review-form" class="tide-form"><label class="tide-field">课程名称<input name="name" value="'+esc(c.name)+'" required maxlength="80"></label><label class="tide-field">教室<input name="room" value="'+esc(roomLabel(l.room))+'" required maxlength="80"></label><div class="tide-surface"><div class="tide-detail-row"><span>星期与节次</span><span>'+shortWeekdays[l.day]+' · '+b.period+'</span></div><div class="tide-detail-row"><span>上课时间</span><span>'+esc(b.start+' — '+b.end)+'</span></div><div class="tide-detail-row"><span>教学周</span><span>'+esc(lessonRuleLabel(l))+'</span></div></div><div class="tide-note">此示例使用已有课表；上传图片不会在这里再次识别。教学周按学校课表显示。</div><button class="tide-primary tide-full" type="submit">保存修改并查看课表</button></form>';
  }
  function renderDifference() {
    const added=lessons.filter(l=>l.weeks.includes(week)&&!l.weeks.includes(week-1));
    const removed=lessons.filter(l=>!l.weeks.includes(week)&&l.weeks.includes(week-1));
    const rows=(items,label)=>items.map(l=>'<div class="tide-detail-row"><span>'+label+'<br>'+shortWeekdays[l.day]+' · 节次 '+(l.period||blocks[l.block].period)+'</span><span>'+esc(course(l.course).name)+'<br>'+esc(roomLabel(l.room))+'</span></div>').join('');
    return top('本周课表变化')+'<div class="tide-sub">'+(week===1?'第 1 周 · 开学课表':'第 '+week+' 周，与第 '+(week-1)+' 周对比')+'</div><div class="tide-surface" style="margin-top:18px">'+(rows(added,'本周新增课程')+rows(removed,'本周没有课程')||empty('与上周课表相同。'))+'</div><div class="tide-note">按教学周规则进行对比，临时停课仍以最新通知为准。</div>';
  }
  function cloudStatusHtml(){
    let state='local-only';
    try{if(window.XixuStore?.cloudStatus)state=window.XixuStore.cloudStatus()}catch(_){}
    if(state==='synced')return '<span class="tide-pill">已同步</span>';
    if(state==='ready')return '<span class="tide-pill">已连接</span>';
    if(state==='waiting')return '<span class="tide-pill warm">等待同步</span>';
    return '<span class="tide-pill warm">仅此设备</span>';
  }
  function renderScheduleSettings(){
    const value=scheduleDraft||cleanScheduleSettings(scheduleSettings);
    const rows=Array.from({length:value.count},(_,index)=>{const item=value.periods[index]||{start:'08:00',end:'08:45'};return '<div class="xixu-period-row"><strong>第 '+(index+1)+' 节</strong><label>开始<input type="time" name="periodStart" required value="'+esc(item.start)+'"></label><span>—</span><label>结束<input type="time" name="periodEnd" required value="'+esc(item.end)+'"></label></div>'}).join('');
    return top('课程节次与时间')+'<div class="tide-note">完整导入课表后会自动识别节次数量和时间。可以在这里微调；增删节次不会清空已有数据。</div><form id="xixu-schedule-form" class="tide-form"><input type="hidden" name="count" value="'+value.count+'"><div class="xixu-period-list">'+rows+'</div><div class="xixu-schedule-actions"><button class="tide-secondary" type="button" data-action="schedule-add-period">'+icon('plus')+'添加一节</button><button class="tide-secondary" type="button" data-action="schedule-remove-period" '+(value.count<=1?'disabled':'')+'>'+icon('minus')+'删除最后一节</button></div><button class="tide-primary tide-full" type="submit">'+icon('check')+'保存课程时间</button></form><div class="tide-section"><h2>课表数据</h2></div><div class="xixu-setting-actions"><button data-action="clear-timetable-range">'+icon('calendar-x')+'<span><strong>按日期清理课表</strong><small>只清理选定日期的课程，节次时间保留</small></span>'+icon('chevron-right')+'</button></div>';
  }
  function renderClearTimetable(){
    const end=addDays(TERM_MONDAY,139);
    return top('按日期清理课表')+'<div class="tide-note">只会清理选定日期中的课程，课程档案、作业、笔记和节次时间都会保留。</div><form id="xixu-clear-timetable-form" class="tide-form"><div class="tide-form-row"><label class="tide-field">开始日期<input type="date" name="from" required value="'+esc(TERM_MONDAY)+'"></label><label class="tide-field">结束日期<input type="date" name="to" required value="'+esc(end)+'"></label></div><button class="tide-delete tide-full" type="submit">清理这段日期的课程</button></form>';
  }
  function renderSettings() {
    return top('设置与数据')+'<div class="tide-surface"><div class="tide-detail-row"><span>版本</span><span>汐序 0.8.11 内测版</span></div><div class="tide-detail-row"><span>本地数据</span><span class="tide-pill">已自动保存</span></div><div class="tide-detail-row"><span>云空间</span>'+cloudStatusHtml()+'</div><div class="tide-detail-row"><span>系统提醒</span>'+reminderStatusHtml()+'</div></div><div class="tide-note">课程、事项、碎片和笔记会先保存在本机。鸿蒙云备份和设备迁移取决于华为账号、云空间与系统设置。</div>'+(reminderState.state==='disabled'?'<button class="tide-primary tide-full" data-action="enable-reminders">'+icon('bell-ring')+'允许提醒</button>':'')+(reminderState.message?'<div class="tide-note">'+esc(reminderState.message)+'</div>':'')+'<div class="tide-section"><h2>课表设置</h2></div><div class="xixu-setting-actions"><button data-action="schedule-settings">'+icon('clock-3')+'<span><strong>课程节次与时间</strong><small>'+scheduleSettings.count+' 节，可添加、删除或调整时间</small></span>'+icon('chevron-right')+'</button></div><div class="tide-section"><h2>智能记录</h2></div><div class="xixu-setting-actions"><button data-action="ai-settings">'+icon('sparkles')+'<span><strong>DeepSeek</strong><small>添加 API Key，用一句话整理安排</small></span>'+icon('chevron-right')+'</button></div><div class="tide-section"><h2>保持井然有序</h2></div><div class="xixu-setting-actions"><button data-action="widget-preview">'+icon('layout-dashboard')+'<span><strong>鸿蒙桌面卡片</strong><small>从桌面添加事项或记录想法</small></span>'+icon('chevron-right')+'</button><button data-action="feedback">'+icon('message-square-heart')+'<span><strong>内测反馈</strong><small>复制问题报告给开发者</small></span>'+icon('chevron-right')+'</button></div><div class="tide-section"><h2>手动备份</h2></div><div class="tide-note">可以随时导出独立备份，包含课表、事项、碎片、笔记、图片和考核方式。不会包含 DeepSeek API Key。</div><div class="tide-detail-actions"><button class="tide-secondary" data-action="export-backup">'+icon('download')+'导出全部数据</button><button class="tide-secondary" data-action="import-backup">'+icon('upload')+'恢复备份</button></div><input id="xixu-backup-import" type="file" accept=".json,application/json" hidden><div class="tide-section"><h2>添加课程</h2></div><form id="xixu-course-form" class="tide-form"><label class="tide-field">课程名称<input name="courseName" required maxlength="80" placeholder="输入课程名称"></label><button class="tide-primary" type="submit">保存课程</button></form>';
  }
  // Keep the fixed chrome in the product language even when a legacy module
  // still supplies an English fallback. User-created titles and notes are
  // left untouched because only exact UI phrases are replaced.
  function translateFixedChrome(value){
    const map={
      'Settings & data':'设置与资料','Version':'版本','Xixu 0.8.11 Beta':'汐序 0.8.11 内测版','Local data':'本机资料','Autosaved':'已自动保存','Cloud space':'云空间','System reminders':'系统提醒','Classes, tasks, quick notes and notes are saved on this device first. HarmonyOS cloud backup and device transfer depend on your Huawei Account, cloud space and system settings.':'课程、事项、碎片和笔记会先保存在本机。鸿蒙云备份与换机恢复取决于华为帐号、云空间和系统设置。','Allow reminders':'允许系统提醒','Timetable settings':'课表设置','Class periods & times':'上课节次与时间','periods; add, remove or adjust times':'节，可添加、删除或调整时间','Smart capture':'智能速记','Add your API key to capture plans in a sentence':'填写 API Key，用一句话记录安排','Keep things close':'不遗漏工具','HarmonyOS widget':'鸿蒙桌面卡片','Add tasks or capture thoughts from your home screen':'从桌面添加事项或记录想法','Beta feedback':'内测反馈','Copy an issue report for the developer':'复制问题说明给开发者','Manual backup':'手动备份','Export all':'导出全部','Restore backup':'恢复备份','Add a class':'添加课程','Class name':'课程名称','Enter a class name':'输入课程名称','Save class':'保存课程','Timetable data':'课表数据','Add period':'添加一节','Remove last period':'删除最后一节','Save class times':'保存节次时间','Clear classes by date range':'按日期范围清除课程','Only classes in the selected dates; period times stay':'只清除所选日期内的课程，节次时间保留','Start date':'开始日期','End date':'结束日期','Clear classes in this date range':'清除这个日期范围内的排课','Class meeting':'课程安排','This class meeting no longer exists.':'这节课已经不存在。','Class time':'上课时间','Teaching weeks':'教学周','Source':'来源','Imported image':'图片导入','Local timetable':'本机课表','Class library':'课程档案','Edit meeting':'修改排课','Edit class meeting':'修改课程安排','Room':'教室','Day':'星期','Start period':'开始节次','End period':'结束节次','Teaching weeks':'教学周','e.g. 1-16 or 1, 3, 5':'例如：1-16 或 1、3、5','Save changes':'保存修改','Delete this meeting':'删除这节课','Rename class':'修改课程名称','Save class name':'保存课程名称','Delete this class and its meetings':'删除课程及其排课','Import / update timetable':'导入 / 更新课表','Bring your timetable into Xixu.':'把课表导入汐序','Choose a file from your school, review it, then update.':'选择学校课表文件，核对后再更新。','Import school timetable file':'导入学校课表文件','Choose timetable file':'选择课表文件','PDF, Excel or Xixu JSON · up to 20 MB':'PDF、Excel 或汐序 JSON · 最大 20 MB','Browse files':'浏览文件','Read on this device · saved only after you confirm':'仅在本机读取 · 确认后才会保存','Or start with an image':'或从图片开始','Scan timetable screenshot':'扫描课表截图','Reads teaching weeks, classes, periods and rooms':'读取教学周、课程、节次和教室','Choose screenshot or photo':'选择截图或照片','A complete view of weekdays, periods, classes and rooms gives the best result.':'包含星期、节次、课程和教室的完整截图效果最好。','Scanned on this device by default; the image is sent only if you choose AI review.':'默认在本机识别；只有你选择 AI 校对时才会发送图片。','Image import':'图片导入','Selected timetable image':'已选择的课表图片','Review recognition':'核对识别结果','Review item':'核对项目','Day & periods':'星期与节次','Time':'时间','Save correction & view timetable':'保存修改并查看课表','School timetable update':'学校课表更新','Connection':'连接状态','Not connected':'未连接','Syncs':'同步内容','Update mode':'更新方式','Manual':'手动','View update flow':'查看更新流程','Weekly wrap-up':'每周总结','Export a separate backup whenever you like. It includes timetables, tasks, quick notes, notes, images and assessments. Your DeepSeek API key is never included.':'你可以随时导出独立备份，包含课表、事项、碎片、笔记、图片和考核方式，不会包含 DeepSeek Key。','New chat':'新对话','Chats':'对话','Back':'返回','New chat':'新对话','Message options':'消息操作','Reply options':'回复操作','Edit message':'编辑消息','Delete message':'删除消息','Also removes its reply. You can undo this.':'同时移除对应回复，可撤销','YOUR DAY, IN ONE PLACE':'你的日程，一处掌握','What can I help you with today?':'今天想让汐序帮你做什么？','Start anywhere. Your classes, plans and notes are connected.':'从一句话开始，课程、安排和笔记都能关联。','Today at a glance':'今天一览','Classes & tasks':'课程与事项','Sort my thoughts':'整理我的想法','Capture first, decide later':'先记下来，再决定','Upcoming deadlines':'即将到来的截止事项','Find the next step':'找到下一步','Pick up a note':'继续一条笔记','Keep the thought going':'继续处理','Thinking with your notes…':'正在结合你的资料思考……','Organizing on this device…':'正在本机整理……','Sources':'相关资料','Quick thought':'碎片','Class':'课程','Not now':'暂不处理','Confirm action':'确认执行','Confirm deletion':'确认删除','Review action':'核对操作','Add to agenda':'加入日程','Title':'标题','Date':'日期','Type':'类型','Time':'时间','Cancel':'取消','Editing your message':'正在修改已发送的内容','Ask Xixu anything…':'和汐序说点什么……','Send again':'重新发送','Send':'发送','I’ll ask before changing anything.':'任何写入都会先确认。','Add an item':'添加一件事','Read text from an image':'从图片读取文字','Delete note':'删除笔记','New note':'新建笔记','Search notes':'搜索笔记','Create a new note':'新建笔记','Search all content':'搜索全部内容','No course':'不关联课程','Link a course':'关联课程','Start writing…':'从这里开始写……','Draft saved':'草稿已保存','Note images (optional)':'笔记图片（可选）','Add image':'添加图片','Organize with Xixu':'让汐序整理','Save':'保存','Delete this note':'删除这条笔记','Review':'请核对','Your plan, organized':'整理后的安排','Try another request':'换一种说法','Add to agenda':'加入日程','Not connected':'未连接','Testing':'测试中','Connected':'已连接','Connection failed':'连接失败','Saved · not tested':'已保存 · 未测试'
    };
    const extra={
      'Settings &amp; data':'设置与资料','Edit class meeting':'修改课程安排','Class name':'课程名称','Room':'教室','Day':'星期','Start period':'开始节次','End period':'结束节次','Teaching weeks':'教学周','Save changes':'保存修改','Delete this meeting':'删除这节课','e.g. 1-16 or 1, 3, 5':'例如 1-16 或 1、3、5','Timetable file':'课表文件','Choose timetable screenshot or photo':'选择课表截图或照片',
      'Bring your timetable into Xixu.':'把课表带入汐序。','Choose a file from your school, review it, then update.':'选择学校课表文件，核对后再更新。','Choose timetable file':'选择课表文件','Browse files':'浏览文件','Or start with an image':'或从图片开始','Scan timetable screenshot':'扫描课表截图','Choose screenshot or photo':'选择截图或照片','School timetable update':'学校课表更新','Connection':'连接状态','Not connected':'未连接','Syncs':'同步内容','Update mode':'更新方式','Manual':'手动','View update flow':'查看更新流程','Image import':'图片导入','Review recognition':'核对识别结果','Review item':'核对项目','Day & periods':'星期与节次','Time':'时间','Save correction & view timetable':'保存修改并查看课表','This week’s class changes':'本周课表变化','Classes this week':'本周有课','No class this week':'本周无课','Same timetable as last week.':'与上周课表相同。','Clear timetable by date':'按日期清除课表','Start date':'开始日期','End date':'结束日期','Clear classes in this date range':'清除这个日期范围内的课程','Class periods & times':'上课节次与时间','Add period':'添加一节','Remove last period':'删除最后一节','Save class times':'保存节次时间','Timetable data':'课表数据','Clear classes by date range':'按日期范围清除课程','Only classes in the selected dates; period times stay':'只清除所选日期内的课程，节次时间保留','Period':'节次','Start':'开始','End':'结束','Choose a class you have already added.':'请选择已添加的课程。','Enter a name and completion date.':'请输入名称和完成日期。','Enter a name, date and time.':'请输入名称、日期和时间。','Done for now. The next occurrence is ready.':'这次已完成，下一次已准备好。','One less thing on your mind.':'少一件挂心的事。','Marked open again':'已恢复为待完成','Undo available':'可以撤销','Deleted “':'已删除“','” and its meetings':'”及其排课','Planned for today. Due time stays ':'已安排到今天，截止时间保持为 ','Assessment image removed':'已移除考核说明图片','Class meeting deleted':'已删除这节课','Deleted ':'已删除','Class meeting updated':'课程安排已更新','Class details corrected':'课程信息已修正','Changes saved':'修改已保存','Added ':'已添加',' to new free slots':'到新的空闲时间段','Moved ':'已移动 ',' unfinished study ':' 个未完成的学习时段',' session':' 个时段',' sessions':' 个时段','Image selected. You can continue to the sample review.':'图片已选择，可以继续核对示例','Original assessment image added':'已添加考核说明原图','Could not read the image. Choose it again.':'图片读取失败，请重新选择。','Check each period’s start and end times':'请检查每节课的开始和结束时间','Check the start and end dates':'请检查开始和结束日期','No classes in the selected date range':'所选日期范围内没有课程','A class with this name already exists. Try another name.':'已有同名课程，请换一个名称。','Class renamed':'课程名称已修改','Check the class name, room, day, periods and teaching weeks':'请检查课程名称、教室、星期、节次和教学周','Choose a JPG, PNG or WebP image under 10 MB':'请选择 10 MB 以内的 JPG、PNG 或 WebP 图片','Check the format of ':'请检查','Fill in the ':'请填写','required field':'必填内容','This device only':'仅本机保存','Available in the app':'可在应用内使用','Note files':'笔记文件','Import note files':'导入笔记文件','Preview text or images before saving':'保存前预览文字或图片','Search & connections':'搜索与关联','Search everything':'搜索全部内容','Find courses, tasks, and notes together':'同时查找课程、事项和笔记','A space for a thought worth keeping':'留存值得记录的想法'
    };
    const escapePattern=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const entries=Object.entries({...map,...extra}).sort((a,b)=>b[0].length-a[0].length);
    // Replace only fixed copy. Boundary checks avoid lookbehind so this also
    // works in older ArkWeb runtimes.
    const replaceFixedText=input=>entries.reduce((text,[from,to])=>{
      const source=String(from),needsLeft=/^[A-Za-z0-9_]/.test(source),needsRight=/[A-Za-z0-9_]$/.test(source);
      const pattern=(needsLeft?'(^|[^A-Za-z0-9_])':'')+escapePattern(source)+(needsRight?'(?=$|[^A-Za-z0-9_])':'');
      return text.replace(new RegExp(pattern,'g'),(match,left)=>String(needsLeft?left||'':'')+String(to));
    },String(input??''));
    const source=String(value??'');
    // `render()` passes an HTML fragment. Translate text runs and the small
    // set of visible/accessibility attributes only; never touch `id`, `name`,
    // `data-*`, class names, tag names, or user-entered values.
    if(!/<[^<>]*>/.test(source))return replaceFixedText(source);
    return source
      .replace(/<[^<>]*>|[^<>]+/g,token=>token.startsWith('<')?token:replaceFixedText(token))
      .replace(/\b(aria-label|placeholder|title)\s*=\s*(["'])(.*?)\2/gi,(match,attribute,quote,text)=>attribute+'='+quote+replaceFixedText(text)+quote);
  }
  function render(save=true) {
    let html;
    if(panel?.kind==='detail') html=renderDetail(getTask(panel.id));
    else if(panel?.kind==='edit') html=renderEditor(panel.id,panel.type);
    else if(panel?.kind==='course') html=renderCourse(course(panel.id));
    else if(panel?.kind==='lesson') html=renderLesson(panel.index);
    else if(panel?.kind==='lesson-edit') html=renderLessonEdit();
    else if(panel?.kind==='course-edit') html=renderCourseEdit();
    else if(panel?.kind==='import') html=renderImport();
    else if(panel?.kind==='school') html=renderSchool();
    else if(panel?.kind==='photo') html=renderPhotoImport();
    else if(panel?.kind==='review') html=renderReview();
    else if(panel?.kind==='difference') html=renderDifference();
    else if(panel?.kind==='settings') html=renderSettings();
    else if(panel?.kind==='schedule-settings') html=renderScheduleSettings();
    else if(panel?.kind==='clear-timetable') html=renderClearTimetable();
    else if(panel?.kind==='smart') html=renderSmartInput();
    else if(panel?.kind==='ai-settings') html=renderAiSettings();
    else if(panel?.kind==='widget-preview') html=renderWidgetPreview();
    else if(panel?.kind==='feedback') html=renderFeedback();
    else if(panel?.kind==='planner') html=renderPlanner(getTask(panel.id));
    else if(panel?.kind==='search') html=renderSearch();
    else if(panel?.kind==='scratch') html=renderScratch();
    else if(panel?.kind==='scratch-detail') html=renderScratchDetail(panel.id);
    else if(panel?.kind==='memory') html=renderMemory(panel.id);
    else if(panel?.kind==='note-import') html=renderNoteImport();
    else if(panel?.kind==='note-import-help') html=renderNoteImportHelp();
    else if(panel?.kind==='archive-import') html=renderArchiveImport();
    else if(panel?.kind==='agent') html=renderAgent();
    else if(panel?.kind==='create') html=renderCreateHub();
    else html=({today:renderToday,agenda:renderAgenda,timetable:renderTimetable,courses:renderCourses,notes:renderNotes})[page]();
     paintMain(translateFixedChrome(html));
    main.querySelectorAll('form').forEach(form=>{form.noValidate=true});
    paintNav();
    icons();
    main.querySelectorAll('.xixu-scratch-composer textarea,.xixu-agent-composer textarea').forEach(fitComposer);
    if(typeof hydrateNoteArchive==='function')hydrateNoteArchive();
    if(save)persist();
  }
  function openPanel(next) {
    if(next?.kind==='edit'){const old=next.id?getTask(next.id):null;taskImageDraftKey=old?.id||'__new';taskImageDraft=normalizeAttachments(old?.images)}
    if(next?.kind==='memory'){const old=next.id?notes.find(note=>note.id===next.id):null;noteImageDraftKey=old?.id||'__new';noteImageDraft=normalizeAttachments(old?.images)}
    previousPanel=panel;panel=next;render();
  }
  window.XixuOpenQuickRecord=route=>{page=route==='memory'?'notes':'today';previousPanel=null;if(route==='memory'){panel=null}else{taskImageDraftKey='__new';taskImageDraft=[];panel={kind:'edit',type:'task'}}render();return true;};
  function toggle(id) {
    const t=getTask(id);if(!t)return;
    const wasDone=t.done;t.done=!t.done;
    if(!wasDone&&motionAllowed()){const source=[...root.querySelectorAll('[data-toggle]')].find(item=>item.dataset.toggle===id),rect=source?.getBoundingClientRect();if(rect){const burst=document.createElement('div');burst.className='xixu-complete-burst';burst.style.left=(rect.left+rect.width/2)+'px';burst.style.top=(rect.top+rect.height/2)+'px';burst.innerHTML='<i></i>'+icon('check');document.body.append(burst);icons();setTimeout(()=>burst.remove(),560)}}
    let createdId=null;
    if(t.done&&(t.repeat==='daily'||t.repeat==='weekly')) {
      const step=t.repeat==='daily'?1:7,nextDate=addDays(t.date,step);
      if(!tasks.some(x=>x.series===(t.series||t.id)&&x.date===nextDate)) {
        createdId=uid();tasks.push({...t,id:createdId,series:t.series||t.id,date:nextDate,plan:t.plan?addDays(t.plan,step):'',done:false,generated:true});
      }
    }
    if(panel?.kind==='detail')panel=null;
    const todayItems=tasks.filter(item=>item.plan===selectedDay||item.type==='task'&&item.date===selectedDay),allDone=t.done&&todayItems.length>0&&todayItems.every(item=>item.done);
    queueDelightCue('complete',{id,allDone});undoMotionTarget={kind:'task',id};
    render();
    notify(t.done?(createdId?'Done for now. The next occurrence is ready.':'One less thing on your mind.'):'Marked open again',()=>{const live=getTask(id);if(live)live.done=wasDone;if(createdId)tasks=tasks.filter(x=>x.id!==createdId||!x.generated);render();});
  }
  function removeTask(id) {
    const index=tasks.findIndex(t=>t.id===id);if(index<0)return;
    const removed=tasks.splice(index,1)[0],from=captureMotionBox(motionItem(id));undoMotionTarget={kind:'task',id:removed.id};queueDelightCue('delete',{from,label:'Undo available'});
    panel=null;previousPanel=null;render();
    notify('已删除“'+removed.title+'”',()=>{if(!getTask(removed.id))tasks.splice(Math.min(index,tasks.length),0,removed);render()});
  }
  root.addEventListener('submit',event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement))return;
    const invalid=[...form.elements].find(field=>field instanceof HTMLElement&&typeof field.checkValidity==='function'&&!field.checkValidity());
    if(!invalid)return;
    event.preventDefault();event.stopImmediatePropagation();invalid.classList.add('xixu-invalid');
    const names={courseName:'class name',title:'name',date:'date',time:'time',noteText:'note',question:'message',description:'issue description',key:'API key',name:'class name',room:'room'};
    const label=names[invalid.getAttribute('name')]||invalid.getAttribute('aria-label')||'required field';
      notify(invalid.validity?.typeMismatch?'请检查'+label+'的格式':'请填写'+label);invalid.focus();
  },true);
  root.addEventListener('input',event=>{if(event.target?.classList?.contains('xixu-invalid'))event.target.classList.remove('xixu-invalid')});
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');if(!button||!root.contains(button))return;
    const action=button.dataset.action,id=button.dataset.id;
    if(action==='nav'){page=button.dataset.page;panel=null;previousPanel=null;render()}
    else if(action==='add')openPanel({kind:'create'});
    else if(action==='add-task')openPanel({kind:'edit',type:'task'});
    else if(action==='create-homework')openPanel({kind:'edit',type:'homework'});
    else if(action==='create-exam')openPanel({kind:'edit',type:'exam'});
    else if(action==='create-task')openPanel({kind:'edit',type:'task'});
    else if(action==='create-meeting')openPanel({kind:'edit',type:'meeting'});
    else if(action==='manage-items'){page='agenda';panel=null;previousPanel=null;render();}
    else if(action==='course-add')openPanel({kind:'edit',type:'homework',course:id});
    else if(action==='plan-slot'){selectedDay=button.dataset.date;openPanel({kind:'edit',type:'task',prefillDate:button.dataset.date,prefillTime:button.dataset.time});}
    else if(action==='task-detail')openPanel({kind:'detail',id});
    else if(action==='edit')openPanel({kind:'edit',id});
    else if(action==='course')openPanel({kind:'course',id});
    else if(action==='lesson')openPanel({kind:'lesson',index:Number(button.dataset.index)});
    else if(action==='edit-lesson')openPanel({kind:'lesson-edit',index:Number(button.dataset.index)});
    else if(action==='edit-course')openPanel({kind:'course-edit',id});
    else if(action==='delete-lesson'){
      const index=Number(button.dataset.index),removed=lessons[index];if(!removed)return;lessons.splice(index,1);const c=course(removed.course),linked=lessons.some(l=>l.course===removed.course)||tasks.some(t=>t.course===removed.course)||notes.some(n=>n.course===removed.course)||Boolean(c?.image)||(Array.isArray(c?.assessment)&&c.assessment.length);if(c?.source==='ocr'&&!linked)courses.splice(courses.indexOf(c),1);panel=null;previousPanel=null;page='timetable';render();notify('已删除这节课');
    }
    else if(action==='delete-course'){
      const c=course(id),courseIndex=courses.indexOf(c);if(!c||courseIndex<0)return;const removedLessons=lessons.filter(item=>item.course===id),taskIds=tasks.filter(item=>item.course===id).map(item=>item.id),noteIds=notes.filter(item=>item.course===id).map(item=>item.id);
      lessons.splice(0,lessons.length,...lessons.filter(item=>item.course!==id));tasks.forEach(item=>{if(item.course===id)item.course=''});notes.forEach(item=>{if(item.course===id)item.course=''});courses.splice(courseIndex,1);panel=null;previousPanel=null;page='courses';render();notify('已删除“'+c.name+'”及其排课',()=>{courses.splice(Math.min(courseIndex,courses.length),0,c);lessons.push(...removedLessons);tasks.forEach(item=>{if(taskIds.includes(item.id))item.course=id});notes.forEach(item=>{if(noteIds.includes(item.id))item.course=id});render()});
    }
    else if(action==='settings')openPanel({kind:'settings'});
    else if(action==='schedule-settings'){scheduleDraft=cleanScheduleSettings(scheduleSettings);openPanel({kind:'schedule-settings'});}
    else if(action==='schedule-add-period'||action==='schedule-remove-period'){
      const form=button.closest('form'),data=new FormData(form),starts=data.getAll('periodStart'),ends=data.getAll('periodEnd'),delta=action==='schedule-add-period'?1:-1,count=Math.max(1,Math.min(24,starts.length+delta)),periods=Array.from({length:Math.min(starts.length,count)},(_,index)=>({start:String(starts[index]||'08:00'),end:String(ends[index]||'08:45')}));
      if(count>periods.length){const last=periods.at(-1)||{start:'08:00',end:'08:45'},minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),clock=value=>String(Math.floor(value/60)%24).padStart(2,'0')+':'+String(value%60).padStart(2,'0'),start=Math.min(23*60,minutes(last.end)+5),duration=Math.max(30,minutes(last.end)-minutes(last.start));periods.push({start:clock(start),end:clock(Math.min(23*60+59,start+duration))})}
      scheduleDraft={preset:'custom',count,periods};render();
    }
    else if(action==='clear-timetable-range')openPanel({kind:'clear-timetable'});
    else if(action==='import')openPanel({kind:'import'});
    else if(action==='school')openPanel({kind:'school'});
    else if(action==='photo-import')openPanel({kind:'photo'});
    else if(action==='review-import')openPanel({kind:'review'});
    else if(action==='week-difference')openPanel({kind:'difference'});
    else if(action==='school-preview'){main.querySelector('#tide-school-flow').hidden=false;icons()}
    else if(action==='show-second-week'){week=3;page='timetable';panel=null;render()}
    else if(action==='back')window.XixuHandleSystemBack()
    else if(action==='agenda-filter'){agendaMode=button.dataset.value;render()}
    else if(action==='table-mode'){const nextMode=button.dataset.value;if(nextMode==='plan'&&tableMode!=='plan')planMonday=mondayOf(DEMO_DAY);tableMode=nextMode;render()}
    else if(action==='table-day'){day=Number(button.dataset.value);render()}
    else if(action==='previous-week'){if(tableMode==='plan')planMonday=addDays(planMonday,-7);else week=Math.max(1,week-1);render()}
    else if(action==='next-week'){if(tableMode==='plan')planMonday=addDays(planMonday,7);else week=Math.min(20,week+1);render()}
    else if(action==='plan-this-week'){planMonday=mondayOf(DEMO_DAY);render()}
    else if(action==='toggle')toggle(id);
    else if(action==='delete')removeTask(id);
    else if(action==='plan'){
      const t=getTask(id);if(!t)return;const old=t.plan;t.plan=DEMO_DAY;t.generated=false;queueDelightCue('plan',{id});undoMotionTarget={kind:'task',id};render();
      notify('Planned for today. Due time stays '+dateLabel(t.date)+' '+t.time,()=>{t.plan=old;render()});
    }else if(action==='remove-image'){
      const c=course(id),old=c.image;c.image=null;render();notify('Assessment image removed',()=>{c.image=old;render()});
    }else if(action==='undo'){const fn=undo,target=undoMotionTarget;undo=null;undoMotionTarget=null;toast.hidden=true;clearTimeout(toastTimer);if(target)queueDelightCue('restore',target);if(fn)fn()}
    else if(action==='dismiss-toast'){toast.hidden=true;undo=null;undoMotionTarget=null;clearTimeout(toastTimer)}
  });
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.dataset.toggle){toggle(el.dataset.toggle);return}
    if(el.id==='tide-plan-date'){if(el.value)selectedDay=el.value;render()}
    if(el.id==='tide-review-select'){reviewLesson=Number(el.value);render()}
    if(el.id==='tide-type'){
      const simple=el.value==='task';
    main.querySelector('#tide-date-label').textContent=simple?'完成日期':'截止 / 活动日期';
      main.querySelector('#tide-time-field').hidden=false;
      main.querySelector('#tide-time-field').firstChild.textContent=simple?'计划时间（可选）':'时间';
      const timeInput=main.querySelector('#tide-time-field input');if(timeInput){timeInput.required=!simple;if(simple&&el.dataset.lastType!=='task'){timeInput.value='';const trigger=timeInput.parentElement?.querySelector('.xixu-control-trigger span');if(trigger)trigger.textContent='不设置时间'}}
      ['tide-plan-field','tide-reminder-field'].forEach(id=>main.querySelector('#'+id).hidden=simple);
      if(el.value==='summary') main.querySelector('[name=repeat]').value='weekly';
      el.dataset.lastType=el.value;
    }
    if(el.id==='tide-course-relation'){
      const picker=main.querySelector('#tide-course-picker');if(picker)picker.hidden=el.value!=='linked';
    }
    if(el.id==='tide-week-select'){week=Number(el.value);render()}
    if(el.id==='xixu-plan-week-date'&&el.value){planMonday=mondayOf(el.value);render()}
    if(el.id==='tide-timetable-image'){
      const file=el.files?.[0];if(!file)return;
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024){notify('请选择 10 MB 以内的 JPG、PNG 或 WebP 图片');return}
      const courseId=el.dataset.course,isCourse=el.id==='tide-course-image';
      const reader=new FileReader();reader.onload=()=>{
        if(isCourse)course(courseId).image=String(reader.result);else uploadedTimetable=String(reader.result);
        render();notify(isCourse?'已添加考核说明原图':'图片已选择，可以继续核对示例');
      };reader.onerror=()=>notify('图片读取失败，请重新选择。');reader.readAsDataURL(file);
    }
  });
  root.addEventListener('submit',event=>{
    if(event.target.id==='xixu-schedule-form'){
      event.preventDefault();const data=new FormData(event.target),starts=data.getAll('periodStart'),ends=data.getAll('periodEnd'),count=Number(data.get('count'));
      if(!Number.isInteger(count)||count<1||count>24||starts.length<count||ends.length<count||starts.slice(0,count).some((start,index)=>!start||!ends[index]||String(start)>=String(ends[index]))){notify('请检查每节课的开始和结束时间');return}
      const next=cleanScheduleSettings({preset:'custom',count,periods:Array.from({length:count},(_,index)=>({start:String(starts[index]||''),end:String(ends[index]||'')}))});
      scheduleSettings=next;scheduleDraft=null;panel={kind:'settings'};previousPanel=null;render();notify('课程节次和时间已保存');return;
    }
    if(event.target.id==='xixu-clear-timetable-form'){
      event.preventDefault();const data=new FormData(event.target),from=String(data.get('from')),to=String(data.get('to'));if(!from||!to||from>to){notify('请检查开始和结束日期');return}
      let removed=0;const kept=[];
      lessons.forEach(lesson=>{const weeks=lesson.weeks.filter(value=>{const actual=addDays(TERM_MONDAY,(value-1)*7+lesson.day),remove=actual>=from&&actual<=to;if(remove)removed++;return !remove});if(weeks.length)kept.push({...lesson,weeks,rule:'第 '+compactRange(weeks)+' 周'})});
      lessons.splice(0,lessons.length,...kept);panel=null;previousPanel=null;page='timetable';render();notify(removed?'已清理 '+removed+' 节课程，节次时间保留。':'所选日期范围内没有课程');return;
    }
    if(event.target.id==='xixu-course-edit-form'){
      event.preventDefault();const c=course(panel.id),name=String(new FormData(event.target).get('courseEditName')||'').trim();if(!c||!name)return;const duplicate=courses.find(item=>item!==c&&item.name===name);if(duplicate){notify('已有同名课程，请换一个名称。');return}c.name=name;c.short=name;c.mark=name.slice(0,1);panel={kind:'course',id:c.id};previousPanel=null;render();notify('课程名称已修改');return;
    }
    if(event.target.id==='xixu-lesson-form'){
      event.preventDefault();const l=lessons[panel.index],oldCourse=l&&course(l.course),data=new FormData(event.target),name=String(data.get('lessonCourseName')||'').trim(),room=String(data.get('lessonRoom')||'').trim(),day=Number(data.get('lessonDay')),start=Number(data.get('lessonStart')),end=Math.max(start,Number(data.get('lessonEnd'))||start),weeks=expandNumberExpression(data.get('lessonWeeks'),20);if(!l||!oldCourse||!name||!room||!weeks.length||day<0||day>6||start<1||end>14){notify('请检查课程名称、教室、星期、节次和教学周');return}
      const target=courses.find(item=>item.name===name);if(target&&target!==oldCourse)l.course=target.id;else {oldCourse.name=name;oldCourse.short=name;oldCourse.mark=name.slice(0,1)}const used=[...new Set(Array.from({length:end-start+1},(_,offset)=>periodBlockIndex(start+offset)).filter(Number.isInteger))];l.day=day;l.block=periodBlockIndex(start);l.spans=used.length>1?used:undefined;l.end=periodEnd(end);l.period=start===end?String(start):start+'–'+end;l.room=['教室待确认','教室待定'].includes(l.room)&&room==='Room to confirm'?l.room:room;l.weeks=weeks;l.rule='第 '+compactRange(weeks)+' 周 · 手动核对';const oldLinked=lessons.some(item=>item.course===oldCourse.id)||tasks.some(t=>t.course===oldCourse.id)||notes.some(n=>n.course===oldCourse.id)||Boolean(oldCourse.image)||(Array.isArray(oldCourse.assessment)&&oldCourse.assessment.length);if(target&&target!==oldCourse&&oldCourse.source==='ocr'&&!oldLinked)courses.splice(courses.indexOf(oldCourse),1);panel={kind:'lesson',index:panel.index};previousPanel=null;render();notify('课程安排已更新');return;
    }
    if(event.target.id==='tide-review-form'){
      event.preventDefault();const f=new FormData(event.target),l=lessons[reviewLesson],c=course(l.course);
      if(!String(f.get('name')).trim()||!String(f.get('room')).trim())return;
      c.name=String(f.get('name')).trim();l.room=['教室待确认','教室待定'].includes(l.room)&&String(f.get('room')).trim()==='Room to confirm'?l.room:String(f.get('room')).trim();panel=null;previousPanel=null;page='timetable';render();notify('课程信息已修正');return;
    }
    if(event.target.id!=='tide-form')return;
    event.preventDefault();
    const f=new FormData(event.target),old=panel.id?getTask(panel.id):null,type=String(f.get('type'));
    const title=String(f.get('title')).trim(),date=String(f.get('date')),time=String(f.get('time'));
    const error=main.querySelector('#tide-form-error');
    if(!title||!date||(type!=='task'&&!time)){error.textContent=type==='task'?'请输入名称和完成日期。':'请输入名称、日期和时间。';error.hidden=false;return}
    const linkedCourse=String(f.get('courseRelation'))==='linked'?String(f.get('course')||''):'';
    if(String(f.get('courseRelation'))==='linked'&&!course(linkedCourse)){error.textContent='请选择已经添加的课程。';error.hidden=false;return}
    const t={id:old?.id||uid(),type,title,course:linkedCourse,date,time,plan:type==='task'?date:String(f.get('plan')),repeat:String(f.get('repeat')),note:String(f.get('note')).trim(),images:normalizeAttachments(taskImageDraft),done:old?.done||false,reminders:type==='task'?[]:[...(f.has('r24')?[24]:[]),...(f.has('r1')?[1]:[])],generated:false,estimateMinutes:Number(f.get('estimateMinutes'))||old?.estimateMinutes||0,sessions:Array.isArray(old?.sessions)?old.sessions:[]};
    if(old?.series)t.series=old.series;
    if(old)tasks[tasks.indexOf(old)]=t;else tasks.push(t);
    if(!old&&panel.sourceScratchId)scratchEntries=scratchEntries.filter(item=>item.id!==panel.sourceScratchId);
    if(course(t.course)&&isDeadline(t)&&t.time)course(t.course).defaultTime=t.time;
    if(t.type==='task'){page='today';selectedDay=date}else page='agenda';
    const motionFrom=captureMotionBox(event.target.querySelector('button[type="submit"]'));taskImageDraft=[];taskImageDraftKey='';panel=null;previousPanel=null;agendaMode='all';
    queueDelightCue(old?'plan':'task-created',{id:t.id,from:motionFrom,page:t.type==='task'?'today':'agenda',label:old?'修改已保存':'已加入'+(t.type==='task'?'今天':'日程')});render();notify(old?'修改已保存':'已添加“'+t.title+'”');
  });

  function applyDesign(){
    const palettes={'雾海蓝':['#487786','#315f70','#dfedef'],'青瓷绿':['#577d77','#38655f','#dfebe6'],'月光蓝':['#617a99','#455f80','#e3eaf3']};
    design.palette={'Sea mist':'雾海蓝','Celadon':'青瓷绿','Moonlight blue':'月光蓝'}[design.paletteName]||design.palette;
    const p=palettes[design.palette];root.style.setProperty('--tide-accent',p[0]);root.style.setProperty('--tide-deep',p[1]);root.style.setProperty('--tide-soft',p[2]);root.style.setProperty('--tide-radius',design.radius+'px');render();
  }
  loadSaved();
  const deferredSessions=deferOverdueSessions();
  if(deferredSessions){lastSaved='';persist();setTimeout(()=>notify('已将 '+deferredSessions+' 个未完成学习时段移到新的空闲时间'),0)}
  readReminderStatus();
  syncReminders();
  render();
  let visibleClockBucket=Math.floor(DEMO_NOW/300000);
  setInterval(()=>{if(document.hidden)return;const now=Date.now(),changedDay=localDay()!==DEMO_DAY,bucket=Math.floor(now/300000);DEMO_NOW=now;if(changedDay){DEMO_DAY=localDay();selectedDay=DEMO_DAY}if(!panel&&(changedDay||((page==='today'||page==='agenda')&&bucket!==visibleClockBucket)))render();visibleClockBucket=bucket},60000);
  if(globalThis.Tweak){
    const tweak=new Tweak({container:root,onChange:applyDesign});
    tweak.addSelect(design,'paletteName',{label:'主题配色',options:['Sea mist','Celadon','Moonlight blue']});
    tweak.addSlider(design,'radius',{label:'卡片圆角',min:14,max:28,unit:'px'});
    tweak.addToggle(design,'mascot',{label:'小陪伴'});
  }
})();





