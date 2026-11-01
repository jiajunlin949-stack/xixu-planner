  if(window.XixuStore)root.classList.add('xixu-native');
  const DATA_SCHEMA_VERSION = 10;
  let lastSaved = '', storageBlocked = false, importCandidate = null, importMode = 'file';
  let notes = [], scratchEntries = [], ocrCorrectionRules = {}, agentHistory = [], agentPreferences = {courses:true,tasks:true,notes:true,activeConversationId:'default',conversations:{},conversationDrafts:{}};
  let noteImageDraft=[],noteImageDraftKey='',taskImageDraft=[],taskImageDraftKey='',agentInputDraft='',agentEditingId='';
  let ocrPending = false, ocrVisionPending = false, ocrImageDataUrl = '', ocrWeek = week, assessmentPending = false, assessmentDraft = null;
  const mondayOf=value=>addDays(value,-((new Date(value+'T12:00:00Z').getUTCDay()+6)%7));
  let planMonday = mondayOf(DEMO_DAY);
  let reminderState = { state: window.XixuReminder ? 'checking' : 'preview', count: 0, message: '' };
  const saveError = document.getElementById('xixu-save-error');
  let validationNoticeOpen=false;
  const validationMessage=field=>{
    const name=String(field.name||'');
    if(name==='courseName')return '请先填写课程名称';
    if(name==='title')return '请先填写标题';
    if(name==='date')return '请选择日期';
    if(name==='time')return '请选择时间';
    if(name==='name')return '请先填写课程名称';
    if(name==='room')return '请填写教室';
    if(name==='description')return '请写下发生了什么';
    if(name==='sentence')return '请写下一句计划';
    if(name==='assessmentName')return '请填写成绩项目名称';
    if(name==='assessmentPercent')return '请输入 0 到 100 之间的比例';
    return '请填写此项';
  };
  root.addEventListener('invalid',event=>{
    event.preventDefault();
    const field=event.target;field.setAttribute('aria-invalid','true');
    if(validationNoticeOpen)return;
    validationNoticeOpen=true;notify(validationMessage(field));
    field.focus({preventScroll:true});field.scrollIntoView({block:'center',behavior:'smooth'});
    setTimeout(()=>{validationNoticeOpen=false},300);
  },true);
  root.addEventListener('input',event=>event.target?.removeAttribute?.('aria-invalid'),true);
  const storageRead = () => window.XixuStore ? window.XixuStore.read() : localStorage.getItem('xixu-v1');
  function storageWrite(value) {
    if(window.XixuStore) { if(!window.XixuStore.save(value))throw Error('write'); }
    else localStorage.setItem('xixu-v1',value);
  }
  const normalizedCourseName=value=>String(value||'').replace(/\s+/g,'').replace(/[＠@]/g,'@').trim();
  function looksLikeClassroomName(value){
    const name=normalizedCourseName(value).replace(/^@/,'').replace(/－/g,'-');
    return /^(?:[A-Za-z]{1,4}|[QO0]C)-?\d+(?:-\d*)?(?:机房|实验室|教室)?$/i.test(name)||/^\d{3,5}(?:机房|实验室|教室)$/.test(name)||/^(?:教室|机房|实验室)(?:待确认|\d+)$/.test(name);
  }
  function linkableCourses(){return courses.filter(item=>item?.linkable!==false&&!looksLikeClassroomName(item?.name))}
  function cleanScheduleSettings(value){
    if(!value||typeof value!=='object')return copySchedule('sztu');
    const count=Math.max(1,Math.min(24,Math.round(Number(value.count)||14))),fallback=copySchedule('sztu');
    const periods=Array.from({length:count},(_,index)=>{
      const item=Array.isArray(value.periods)?value.periods[index]:null,start=String(item?.start||fallback.periods[index]?.start||'08:00'),end=String(item?.end||fallback.periods[index]?.end||'08:45');
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(start)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(end)&&start<end?{start,end}:{...(fallback.periods[index]||{start:'08:00',end:'08:45'})};
    });
    return {preset:value.preset==='sztu'?'sztu':'custom',count,periods};
  }
  function repairLegacyOcrCourses(value){
    const repaired={...value,courses:Array.isArray(value.courses)?value.courses.map(item=>({...item})):[],lessons:Array.isArray(value.lessons)?value.lessons.map(item=>({...item,weeks:Array.isArray(item.weeks)?item.weeks.slice():[]})):[]};
    const courseOrder=new Map(repaired.courses.map((item,index)=>[item.id,index]));
    let courseMap=new Map(repaired.courses.map(item=>[item.id,item])),repairCount=0;
    const isLegacyOcr=lesson=>/图片识别/.test(String(lesson?.rule||''))||courseMap.get(lesson?.course)?.source==='ocr';
    const groups=new Map();
    repaired.lessons.forEach((lesson,index)=>{
      if(!isLegacyOcr(lesson))return;
      const key=[lesson.day,lesson.block,(lesson.weeks||[]).join(','),String(lesson.rule||'').match(/第\s*\d+\s*周/)?.[0]||''].join('|');
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push({lesson,index,course:courseMap.get(lesson.course)});
    });
    const removedLessonIndexes=new Set(),removedCourseIds=new Set();
    for(const entries of groups.values()){
      const unique=[];
      entries.slice().sort((a,b)=>(courseOrder.get(a.course?.id)??9999)-(courseOrder.get(b.course?.id)??9999)).forEach(entry=>{if(entry.course&&!unique.some(item=>item.course.id===entry.course.id))unique.push(entry)});
      if(unique.length<2){
        const only=unique[0];if(only&&looksLikeClassroomName(only.course.name)){only.course.linkable=false;repairCount++}
        continue;
      }
      const nameParts=[],roomParts=[];let readingRoom=false;
      unique.forEach(entry=>{
        const part=normalizedCourseName(entry.course.name);
        if(looksLikeClassroomName(part)||/^@?(?:[QO0]?C|AC)-?\d/i.test(part)){readingRoom=true;roomParts.push(part.replace(/^@/,''));return}
        if(readingRoom&&part.length<=4){roomParts.push(part);return}
        nameParts.push(part);
      });
      const mergedName=nameParts.join('').replace(/(.)\1{3,}/g,'$1').slice(0,80);
      if(mergedName.length<2){unique.forEach(entry=>{entry.course.linkable=false});repairCount+=unique.length;continue}
      const primaryEntry=unique.find(entry=>nameParts.includes(normalizedCourseName(entry.course.name)))||unique[0],primary=primaryEntry.course;
      const mergedIds=new Set(unique.map(entry=>entry.course.id));
      primary.name=mergedName;primary.short=mergedName;primary.mark=mergedName.slice(0,1);primary.source='ocr';primary.linkable=true;primary.repairedFromOCR=true;
      const keptLesson=primaryEntry.lesson;keptLesson.course=primary.id;keptLesson.confidence=Math.min(Number(keptLesson.confidence)||.6,.7);keptLesson.rule=String(keptLesson.rule||'图片识别')+' · 已自动合并旧版碎片';
      const existingRoom=unique.map(entry=>String(entry.lesson.room||'').trim()).find(room=>room&&room!=='教室待确认');
      if(existingRoom)keptLesson.room=existingRoom;else if(roomParts.length)keptLesson.room=roomParts.join('').replace(/^@/,'').replace(/－/g,'-').slice(0,80);
      unique.forEach(entry=>{if(entry.lesson!==keptLesson)removedLessonIndexes.add(entry.index);if(entry.course!==primary)removedCourseIds.add(entry.course.id)});
      if(Array.isArray(repaired.tasks))repaired.tasks.forEach(task=>{if(mergedIds.has(task.course))task.course=primary.id});
      if(Array.isArray(repaired.notes))repaired.notes.forEach(note=>{if(mergedIds.has(note.course))note.course=primary.id});
      repairCount+=Math.max(1,unique.length-1);
    }
    repaired.lessons=repaired.lessons.filter((_,index)=>!removedLessonIndexes.has(index));
    const remainingCourseIds=new Set(repaired.lessons.map(lesson=>lesson.course));
    repaired.courses=repaired.courses.filter(item=>{
      if(!removedCourseIds.has(item.id))return true;
      return (repaired.tasks||[]).some(task=>task.course===item.id)||(repaired.notes||[]).some(note=>note.course===item.id)||remainingCourseIds.has(item.id)||Boolean(item.image)||(Array.isArray(item.assessment)&&item.assessment.length);
    });
    const seenLessons=new Map();
    repaired.lessons=repaired.lessons.filter(lesson=>{
      const key=[lesson.course,lesson.day,lesson.block,(lesson.weeks||[]).join(',')].join('|'),old=seenLessons.get(key);
      if(!old){seenLessons.set(key,lesson);return true}
      if((!old.room||old.room==='教室待确认')&&lesson.room)old.room=lesson.room;
      repairCount++;return false;
    });
    for(const item of repaired.courses)if(looksLikeClassroomName(item.name)){item.linkable=false;repairCount++}
    repaired.ocrRepairCount=repairCount;
    return repaired;
  }
  function normalizeAttachments(value){
    if(!Array.isArray(value))return [];
    return value.slice(0,6).filter(item=>item&&typeof item.dataUrl==='string'&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(item.dataUrl)&&item.dataUrl.length<=2500000).map(item=>({id:String(item.id||uid()),name:String(item.name||'image').slice(0,120),type:String(item.type||item.dataUrl.slice(5,item.dataUrl.indexOf(';'))).slice(0,40),dataUrl:item.dataUrl}));
  }
  function normalizeAgentHistory(value){
    if(!Array.isArray(value))return [];
    // Limit only the retrieval/display window, never the stored conversation.
    // Payload validation fails explicitly if an item exceeds the storage contract.
    return value.map(item=>{
      if(!item||!['user','assistant'].includes(item.role)||typeof item.text!=='string')throw Error('Agent 对话记录无效，原始资料未修改。');
      return {...item,id:String(item.id||uid()),conversationId:String(item.conversationId||'default'),role:item.role,text:item.text,source:item.source==='deepseek'?'deepseek':'local',createdAt:String(item.createdAt||new Date().toISOString())};
    });
  }
  function normalizeAgentPreferences(value){
    const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    const conversations=Object.create(null),conversationDrafts=Object.create(null);
    const validId=id=>Boolean(id)&&id.length<=80&&!['__proto__','prototype','constructor'].includes(id);
    for(const [id,item] of Object.entries(input.conversations||{})){
      if(!validId(id)||!item||typeof item!=='object'||Array.isArray(item))throw Error('对话资料无效，原始资料未修改。');
      const title=String(item.title||''),createdAt=String(item.createdAt||''),updatedAt=String(item.updatedAt||createdAt);
      if(title.length>200)throw Error('对话名称过长，原始资料未修改。');
      conversations[id]={title,createdAt,updatedAt};
    }
    for(const [id,text] of Object.entries(input.conversationDrafts||{})){
      if(!validId(id)||typeof text!=='string'||text.length>128000)throw Error('对话草稿无效，原始资料未修改。');
      conversationDrafts[id]=text;
    }
    const activeConversationId=String(input.activeConversationId||'default');
    if(!validId(activeConversationId))throw Error('对话 ID 无效，原始资料未修改。');
    return {...input,courses:true,tasks:true,notes:true,activeConversationId,conversations,conversationDrafts};
  }
  function normalizeScratchEntries(value){
    if(!Array.isArray(value))return [];
    return value.slice(-2000).filter(item=>item&&typeof item.text==='string'&&item.text.trim()).map(item=>({id:String(item.id||uid()),text:String(item.text).normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').trim().slice(0,5000),createdAt:String(item.createdAt||new Date().toISOString()),updatedAt:String(item.updatedAt||item.createdAt||new Date().toISOString())}));
  }
  function migrateData(value,timetableOnly){
    if(!value||typeof value!=='object')throw Error('文件格式无效。');
    const expected=timetableOnly?'xixu-timetable':'xixu-backup';
    if(value.format!==expected)throw Error('文件格式无效。');
    const version=Number(value.schemaVersion||1);
    if(version<1||version>DATA_SCHEMA_VERSION)throw Error('此备份由更新版本的汐序创建，请先更新应用。');
    let migrated={...value,schemaVersion:DATA_SCHEMA_VERSION};
    if(!timetableOnly){
      migrated.tasks=Array.isArray(value.tasks)?value.tasks.map(task=>({...task,time:String(task.time||''),images:normalizeAttachments(task.images),estimateMinutes:Number(task.estimateMinutes)||0,sessions:Array.isArray(task.sessions)?task.sessions:[]})):[];
      migrated.notes=Array.isArray(value.notes)?value.notes.map(note=>({
        ...note,
        title:note.title!==undefined&&note.title!==null?String(note.title):String(note.text||'').split(/\n/)[0].slice(0,80),
        category:String(note.category||'笔记').slice(0,20),
        course:String(note.course||''),
        // A missing source edit time is unknown, not the time of migration.
        createdAt:String(note.createdAt??''),
        updatedAt:String(note.updatedAt??note.modifiedAt??''),
        images:normalizeAttachments(note.images)
      })):[];
      migrated.scratchEntries=normalizeScratchEntries(value.scratchEntries);
      migrated.ocrCorrectionRules=value.ocrCorrectionRules&&typeof value.ocrCorrectionRules==='object'&&!Array.isArray(value.ocrCorrectionRules)?value.ocrCorrectionRules:{};
      migrated.agentHistory=normalizeAgentHistory(value.agentHistory);
      migrated.agentPreferences=normalizeAgentPreferences(value.agentPreferences);
      if(version<5){
        const removable=new Set((Array.isArray(migrated.courses)?migrated.courses:[]).filter(item=>{
          if(String(item?.name||'').trim()!=='软件工程')return false;
          const linkedLesson=(Array.isArray(migrated.lessons)?migrated.lessons:[]).some(lesson=>lesson.course===item.id);
          const linkedTask=migrated.tasks.some(task=>task.course===item.id);
          const linkedNote=migrated.notes.some(note=>note.course===item.id);
          const hasCourseData=Boolean(item.image)||(Array.isArray(item.assessment)&&item.assessment.length>0);
          return !linkedLesson&&!linkedTask&&!linkedNote&&!hasCourseData;
        }).map(item=>item.id));
        if(removable.size)migrated.courses=migrated.courses.filter(item=>!removable.has(item.id));
      }
      if(version<6){
        const ocrCourseIds=new Set((Array.isArray(migrated.lessons)?migrated.lessons:[]).filter(lesson=>/图片识别/.test(String(lesson?.rule||''))).map(lesson=>lesson.course));
        migrated.courses=(Array.isArray(migrated.courses)?migrated.courses:[]).map(item=>ocrCourseIds.has(item.id)?{...item,source:item.source||'ocr'}:item);
      }
      if(version<7)migrated=repairLegacyOcrCourses(migrated);
      if(version<8){
        const linked=new Set([...(migrated.lessons||[]).map(item=>item.course),...migrated.tasks.map(item=>item.course),...migrated.notes.map(item=>item.course)].filter(Boolean));
        migrated.courses=(migrated.courses||[]).filter(item=>linked.has(item.id)||Boolean(item.image)||(Array.isArray(item.assessment)&&item.assessment.length)||item.source==='manual');
      }
      migrated.scheduleSettings=cleanScheduleSettings(value.scheduleSettings);
    }
    return migrated;
  }
  function validNoteArchive(value){
    if(value===undefined)return true;
    if(!value||![1,2].includes(value.version)||!/^[a-f0-9]{64}$/.test(value.originalHash)||!/^[a-f0-9]{64}$/.test(value.textHash)||typeof value.fileName!=='string'||!value.fileName||value.fileName.length>1000||!Number.isInteger(value.fileBytes)||value.fileBytes<1||!Number.isSafeInteger(value.fileBytes)||!Array.isArray(value.images)||value.images.length>500||!Array.isArray(value.layout)||value.layout.length>10000)return false;
    if(value.projectionStatus!==undefined&&!['original-only','partial','text'].includes(value.projectionStatus))return false;
    if(value.version===2&&(!['txt','md','markdown','csv','html','htm','json','docx','pdf','png','jpg','jpeg','webp','hdoc','doc','bin'].includes(value.format)||!Array.isArray(value.warnings)||value.warnings.length>40||value.warnings.some(text=>typeof text!=='string'||text.length>500)))return false;
    if(value.images.some(image=>!image||!/^[a-f0-9]{64}$/.test(image.hash)||!['image/jpeg','image/png','image/webp'].includes(image.mime)||!Number.isInteger(image.bytes)||image.bytes<1||!Number.isSafeInteger(image.bytes)))return false;
    if(value.images.some(image=>image.width!==undefined&&(!Number.isFinite(image.width)||!Number.isFinite(image.height)||image.width<=0||image.height<=0||image.width>100000||image.height>100000)))return false;
    if(value.images.reduce((sum,image)=>sum+image.bytes,0)>(value.version===1?value.fileBytes:value.format==='pdf'?Number.MAX_SAFE_INTEGER:64*1024*1024))return false;
    let depth=0,characters=0,imageIndex=0;
    for(const item of value.layout){
      if(!item||!['text','break','open','close','image','checkbox'].includes(item.kind))return false;
      if(item.kind==='checkbox'&&typeof item.checked!=='boolean')return false;
      if(item.kind==='text'){if(typeof item.text!=='string')return false;characters+=item.text.length;if(characters>50000)return false}
      if(item.kind==='open'&&++depth>200)return false;
      if(item.kind==='close'&&--depth<0)return false;
      if(item.kind==='image'&&(!Number.isInteger(item.index)||item.index!==imageIndex++||item.index>=value.images.length))return false;
    }
    return depth===0&&imageIndex===value.images.length;
  }
  function checkData(input, timetableOnly) {
    const value=migrateData(input,timetableOnly);
    if(!Array.isArray(value.courses)||value.courses.length>300||!Array.isArray(value.lessons)||value.lessons.length>3000)throw Error('课程数据不完整。');
    const ids=new Set();
    for(const c of value.courses){
      if(!c||typeof c.id!=='string'||!c.id||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80)throw Error('课程名称或 ID 无效。');
      ids.add(c.id);
      if(c.image!==null&&c.image!==undefined&&(typeof c.image!=='string'||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(c.image)))throw Error('图片格式无效。');
      if(c.assessment!==undefined&&(!Array.isArray(c.assessment)||c.assessment.length>30||c.assessment.some(item=>!item||typeof item.name!=='string'||item.name.length>40||!Number.isFinite(item.percent)||item.percent<0||item.percent>100)))throw Error('成绩数据无效。');
    }
    for(const l of value.lessons){
      if(!ids.has(l.course)||!Number.isInteger(l.day)||l.day<0||l.day>6||!Number.isInteger(l.block)||!blocks[l.block]||typeof l.room!=='string'||!Array.isArray(l.weeks)||!l.weeks.length||l.weeks.some(w=>!Number.isInteger(w)||w<1||w>20))throw Error('课程周次或节次数据无效。');
      if(l.spans&&(!Array.isArray(l.spans)||l.spans.some(b=>!Number.isInteger(b)||!blocks[b])||!l.spans.includes(l.block)))throw Error('连续节次数据无效。');
      if(l.end&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(l.end))throw Error('结束时间无效。');
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value.termStart)||Number.isNaN(Date.parse(value.termStart))||new Date(value.termStart+'T12:00:00Z').getUTCDay()!==1)throw Error('学期开始日期必须是周一。');
    if(!timetableOnly&&(!Array.isArray(value.tasks)||value.tasks.some(t=>!t||!types[t.type]||typeof t.id!=='string'||typeof t.title!=='string'||!Array.isArray(t.reminders)||typeof t.done!=='boolean'||!Number.isFinite(t.estimateMinutes)||t.estimateMinutes<0||t.estimateMinutes>60000||!Array.isArray(t.sessions)||!Array.isArray(t.images))))throw Error('事项数据无效。');
    if(!timetableOnly&&(!Array.isArray(value.notes)||value.notes.length>5000||value.notes.some(n=>!n||typeof n.id!=='string'||typeof n.text!=='string'||n.text.length>50000||typeof n.createdAt!=='string'||typeof n.updatedAt!=='string'||!Array.isArray(n.images)||!validNoteArchive(n.archive))))throw Error('备忘录数据无效。');
    if(!timetableOnly&&(!Array.isArray(value.scratchEntries)||value.scratchEntries.length>2000||value.scratchEntries.some(item=>!item||typeof item.id!=='string'||typeof item.text!=='string'||!item.text.trim()||item.text.length>5000||typeof item.createdAt!=='string'||typeof item.updatedAt!=='string')))throw Error('碎片数据无效。');
    if(!timetableOnly&&(!Array.isArray(value.agentHistory)||value.agentHistory.some(item=>!item||typeof item.id!=='string'||!['user','assistant'].includes(item.role)||typeof item.text!=='string'||item.text.length>128000||typeof item.conversationId!=='string'||item.conversationId.length>80)))throw Error('Agent 对话记录无效，原始资料未修改。');
    if(!timetableOnly)value.scheduleSettings=cleanScheduleSettings(value.scheduleSettings);
    return value;
  }
  function snapshot(){return {format:'xixu-backup',schemaVersion:DATA_SCHEMA_VERSION,termStart:TERM_MONDAY,scheduleSettings,courses,lessons,tasks,notes,scratchEntries,ocrCorrectionRules,agentHistory,agentPreferences};}
  function reminderPayload(){
    const names=new Map(courses.map(item=>[item.id,item.name]));
    const reminderTasks=tasks.map(item=>({id:item.id,type:item.type,title:item.title,courseName:names.get(item.course)||'',date:item.date,time:item.time||'',repeat:item.repeat||'none',reminders:item.reminders||[],done:item.done}));
    return JSON.stringify({tasks:reminderTasks});
  }
  function readReminderStatus(){
    if(!window.XixuReminder)return;
    try{const value=JSON.parse(window.XixuReminder.status());reminderState={state:value.enabled?'enabled':'disabled',count:Number(value.count)||0,message:''}}
    catch(_){reminderState={state:'error',count:0,message:'无法读取提醒状态。'}}
  }
  function syncReminders(){
    if(!window.XixuReminder)return;
    reminderState={...reminderState,state:reminderState.state==='disabled'?'disabled':'syncing'};
    try{if(!window.XixuReminder.sync(reminderPayload()))throw Error('sync')}
    catch(_){reminderState={state:'error',count:0,message:'提醒同步失败。'};return false}
    return true;
  }
  function reminderStatusHtml(){
    if(reminderState.state==='preview')return '<span class="tide-pill warm">应用内可用</span>';
    if(reminderState.state==='disabled')return '<span class="tide-pill warm">允许通知</span>';
    if(reminderState.state==='error')return '<span class="tide-pill warm">重试</span>';
    if(reminderState.state==='syncing'||reminderState.state==='checking')return '<span class="tide-pill">同步中</span>';
    return '<span class="tide-pill">'+(reminderState.count?reminderState.count+' 条已安排':'已启用')+'</span>';
  }
  window.XixuReceiveReminder=(state,count,message)=>{
    reminderState={state:String(state||'error'),count:Number(count)||0,message:String(message||'')};
    if(panel?.kind==='settings')render();
  };
  function renderWidgetPreview() {
    const first=active()[0],todayLesson=lessons.filter(l=>l.day===(new Date(DEMO_DAY+'T12:00:00Z').getUTCDay()+6)%7&&l.weeks.includes(week)).sort((a,b)=>lessonStart(a).localeCompare(lessonStart(b)))[0];
    return top('鸿蒙桌面卡片')+'<div class="xixu-widget"><div class="xixu-widget-top"><span>'+icon('waves')+' 汐序</span><small>'+dateLabel(DEMO_DAY)+' · '+weekday(DEMO_DAY)+'</small></div><div class="xixu-widget-focus"><small>下一个截止事项</small><strong>'+(first?esc(first.title):'今天没有待办')+'</strong><span>'+(first?esc(dateLabel(first.date)+' '+first.time+' · '+relative(first)):'给自己留一点从容时间')+'</span></div><div class="xixu-widget-line"><span>下一节课</span><strong>'+(todayLesson?esc(lessonStart(todayLesson)+' '+course(todayLesson.course).short):'今天没有更多课程')+'</strong></div></div><div class="tide-note">这是汐序桌面卡片的预览，当前页面只展示设计，暂未启用卡片支持。</div>';
  }
  function renderPlanWeek(monday){
    const rows=[['上午','09:00',0,12],['下午','14:00',12,18],['晚上','19:00',18,24]];
    const teachingWeekFor=date=>1+Math.floor((Date.parse(date)-Date.parse(TERM_MONDAY))/604800000);
    const inHours=(time,start,end)=>{const hour=Number(String(time||'23:59').slice(0,2));return hour>=start&&hour<end};
    const renderSlot=(date,dayIndex,fallback,start,end)=>{
      const items=tasks.filter(t=>!t.done&&(t.type==='task'?t.date:t.plan)===date&&inHours(t.time||fallback,start,end)).sort((a,b)=>(a.time||fallback).localeCompare(b.time||fallback));
      const teachingWeek=teachingWeekFor(date);
      const classes=teachingWeek>=1&&teachingWeek<=20?lessons.filter(l=>l.day===dayIndex&&l.weeks.includes(teachingWeek)&&inHours(lessonStart(l),start,end)).sort((a,b)=>lessonStart(a).localeCompare(lessonStart(b))):[];
      if(!items.length&&!classes.length)return '<button class="xixu-plan-cell is-empty" data-action="plan-slot" data-date="'+date+'" data-time="'+fallback+'" aria-label="为 '+date+' 添加计划">'+icon('plus')+'</button>';
      return '<div class="xixu-plan-cell-stack" data-date="'+date+'">'+classes.map(l=>'<button class="xixu-plan-chip is-course" data-action="lesson" data-index="'+lessons.indexOf(l)+'"><small>'+lessonStart(l)+'</small><strong>'+esc(course(l.course).short)+'</strong></button>').join('')+items.map(item=>'<button class="xixu-plan-chip '+(item.type==='task'?'':'is-deadline')+'" data-action="task-detail" data-id="'+esc(item.id)+'"><small>'+(item.time||fallback)+'</small><strong>'+esc(item.title)+'</strong></button>').join('')+'<button class="xixu-plan-slot-add" data-action="plan-slot" data-date="'+date+'" data-time="'+fallback+'" aria-label="为 '+date+' 添加其他计划">'+icon('plus')+'</button></div>';
    };
    let html='<div class="xixu-plan-key"><span><i class="is-course"></i>课程</span><span><i></i>我的计划</span><span><i class="is-deadline"></i>预留给截止事项的时间</span></div><div class="xixu-plan-grid"><div></div>'+['周一','周二','周三','周四','周五'].map((name,index)=>{const date=addDays(monday,index);return '<div class="xixu-plan-head '+(date===DEMO_DAY?'is-today':'')+'"><span>'+name+'</span><strong>'+dateLabel(date)+'</strong></div>'}).join('');
    rows.forEach(([label,fallback,start,end])=>{
      html+='<div class="xixu-plan-time"><strong>'+label+'</strong><span>'+fallback+'</span></div>';
      for(let i=0;i<5;i++)html+=renderSlot(addDays(monday,i),i,fallback,start,end);
    });
    html+='</div><div class="xixu-plan-weekend">'+[5,6].map(index=>{
      const date=addDays(monday,index),teachingWeek=teachingWeekFor(date),items=tasks.filter(t=>!t.done&&(t.type==='task'?t.date:t.plan)===date).sort((a,b)=>(a.time||'23:59').localeCompare(b.time||'23:59')),classes=teachingWeek>=1&&teachingWeek<=20?lessons.filter(l=>l.day===index&&l.weeks.includes(teachingWeek)).sort((a,b)=>lessonStart(a).localeCompare(lessonStart(b))):[];
      return '<section data-date="'+date+'"><div class="xixu-plan-weekend-head"><div><span>'+['周六','周日'][index-5]+'</span><strong>'+dateLabel(date)+'</strong></div><button data-action="plan-slot" data-date="'+date+'" data-time="10:00" aria-label="为 '+date+' 添加计划">'+icon('plus')+'</button></div>'+classes.map(l=>'<button class="xixu-plan-weekend-item is-course" data-action="lesson" data-index="'+lessons.indexOf(l)+'"><span>'+lessonStart(l)+'</span><strong>'+esc(course(l.course).short)+'</strong></button>').join('')+(items.length?items.map(item=>'<button class="xixu-plan-weekend-item '+(item.type==='task'?'':'is-deadline')+'" data-action="task-detail" data-id="'+esc(item.id)+'"><span>'+(item.time||'待定')+'</span><strong>'+esc(item.title)+'</strong></button>').join(''):(classes.length?'':'<button class="xixu-plan-weekend-empty" data-action="plan-slot" data-date="'+date+'" data-time="10:00">添加周末计划</button>'))+'</section>';
    }).join('')+'</div>';
    return html+'<div class="tide-sub">课程、事项和截止安排共享日期，计划周会延续到学期结束以后。</div>';
  }
  function persist(options={}) {
    if(storageBlocked)return false;
    try{
      // Keep the existing atomic snapshot format. Each save serializes once;
      // metadata-only agent transitions must not rebuild system reminders.
      const data=JSON.stringify(snapshot());if(data===lastSaved)return true;
      storageWrite(data);lastSaved=data;saveError.hidden=true;
    }catch(_){saveError.textContent='这次修改还没有保存，请检查可用存储空间后再关闭汐序。';saveError.hidden=false;return false}
    if(options.scope!=='assistant'&&options.reminders!==false)syncReminders();
    return true;
  }
  function loadSaved() {
    try {
      const raw=storageRead();if(!raw)return;
      const data=checkData(JSON.parse(raw),false),repairCount=Number(data.ocrRepairCount)||0;
      courses.push(...data.courses);lessons.push(...data.lessons);tasks=data.tasks;notes=data.notes;scratchEntries=data.scratchEntries;ocrCorrectionRules=data.ocrCorrectionRules;agentHistory=data.agentHistory;agentPreferences=data.agentPreferences;scheduleSettings=data.scheduleSettings;TERM_MONDAY=data.termStart;
      const currentTeachingWeek=1+Math.floor((Date.parse(DEMO_DAY)-Date.parse(TERM_MONDAY))/604800000);
      week=Math.max(1,Math.min(20,currentTeachingWeek));if(currentTeachingWeek<1||currentTeachingWeek>20)tableMode='plan';
      lastSaved=JSON.stringify(snapshot());
      if(Number(JSON.parse(raw).schemaVersion||1)<DATA_SCHEMA_VERSION){lastSaved='';persist();notify(repairCount?'已清理 '+repairCount+' 条旧识别碎片，请检查课表中的课程名称。':'本地数据已安全升级，原有记录仍然保留。')}
    }catch(_){storageBlocked=true;saveError.textContent='无法读取本地数据，汐序已停止覆盖保存。请保留现有数据并联系开发者。';saveError.hidden=false;}
  }
  function renderFeedback(){
    return top('内测反馈')+'<div class="xixu-feedback-hero">'+icon('message-square-heart')+'<div><strong>哪里不顺手？写下来。</strong><span>反馈只保存在本机，准备好后复制发送。</span></div></div><form id="xixu-feedback-form" class="tide-form"><label class="tide-field">问题类型<select name="category"><option value="界面或动效">界面或动效</option><option value="课表或识别">课表或识别</option><option value="提醒">提醒</option><option value="数据或其他">数据或其他</option></select></label><label class="tide-field">发生在哪里？<select name="location"><option value="今天">今天</option><option value="日程">日程</option><option value="添加">添加</option><option value="课表">课表</option><option value="课程">课程</option><option value="设置">设置</option></select></label><label class="tide-field">发生了什么？<textarea name="description" required maxlength="1200" placeholder="例如：从周视图切换到日视图时会闪一下"></textarea></label><label class="tide-field">怎样会更舒服？<textarea name="expected" maxlength="600" placeholder="可选，例如：像底部导航一样流畅的过渡"></textarea></label><button class="tide-primary tide-full" type="submit">'+icon('copy')+'复制反馈</button></form><div id="xixu-feedback-result"></div><div class="xixu-local-note">'+icon('shield-check')+'只会包含版本、屏幕尺寸和你的描述，不会包含课表数据、API 密钥或校园账号密码。</div>';
  }
  function feedbackText(form){
    const data=new FormData(form),lines=['汐序 0.8.11 内测反馈','时间：'+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),'问题类型：'+data.get('category'),'位置：'+data.get('location'),'问题：'+String(data.get('description')||'').trim()];
    const expected=String(data.get('expected')||'').trim();if(expected)lines.push('期望：'+expected);
    lines.push('屏幕：'+innerWidth+' × '+innerHeight,'环境：'+(window.XixuStore?'鸿蒙应用':'桌面预览'));
    return lines.join('\n');
  }




