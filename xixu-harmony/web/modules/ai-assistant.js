  let aiCandidate=null,aiPending=false,aiTestState='untested',aiTestMessage='';
  const aiHasKey=()=>{try{return Boolean(window.XixuAI?.hasKey?.())}catch(_){return false}};
  function renderSmartInput(){
    const status=window.XixuAI?(aiHasKey()?'本机整理简单请求，DeepSeek 处理复杂请求':'简单请求可离线完成；填写 DeepSeek Key 可处理更多内容。'):'简单请求可直接在本机完成';
    let html=top('智能速记')+'<div class="xixu-ai-hero">'+icon('sparkles')+'<div><strong>现在想记下什么？</strong><span>先核对内容，确认后再保存。</span></div></div><form id="xixu-smart-form" class="tide-form"><label class="tide-field">描述你的安排<textarea name="sentence" required maxlength="500" placeholder="告诉汐序你想记住或安排什么……"></textarea></label><button class="tide-primary tide-full" type="submit" '+(aiPending?'disabled':'')+'>'+icon(aiPending?'loader-circle':'wand-sparkles')+(aiPending?'正在整理……':'帮我整理')+'</button></form><div class="xixu-ai-status">'+icon(window.XixuAI&&aiHasKey()?'shield-check':'info')+'<span>'+esc(status)+'</span></div><div id="xixu-ai-result">';
    if(aiCandidate)html+=renderAiCandidate(aiCandidate);
    html+='</div><button class="tide-link tide-full" data-action="manual-add">'+icon('pencil-line')+'自己添加</button>';
    return html;
  }
  function renderAiSettings(){
    const installed=Boolean(window.XixuAI),connected=installed&&aiHasKey();
    const stateLabel=!connected?'Not connected':aiTestState==='testing'?'Testing':aiTestState==='ok'?'Connected':aiTestState==='failed'?'Connection failed':'Saved · not tested',stateClass=connected&&aiTestState!=='failed'?'':'warm';
    return top('DeepSeek 连接')+'<div class="tide-surface"><div class="tide-detail-row"><span>状态</span><span class="tide-pill '+stateClass+'">'+({'Not connected':'未连接',Testing:'测试中',Connected:'已连接','Connection failed':'连接失败','Saved · not tested':'已保存 · 未测试'}[stateLabel]||stateLabel)+'</span></div><div class="tide-detail-row"><span>模型</span><span>DeepSeek V4.1 Flash</span></div><div class="tide-detail-row"><span>保存</span><span>确认后才会写入</span></div></div>'+(aiTestMessage?'<div class="tide-note">'+esc(aiTestMessage)+'</div>':'')+'<form id="xixu-ai-key-form" class="tide-form"><label class="tide-field">DeepSeek API Key<input name="apiKey" type="password" autocomplete="off" maxlength="300" placeholder="sk-…"></label><button class="tide-primary tide-full" type="submit">'+icon('key-round')+(connected?'替换并测试 Key':'保存并测试 Key')+'</button></form>'+(connected?'<button class="tide-secondary tide-full" data-action="test-ai-key" '+(aiTestState==='testing'?'disabled':'')+'>'+icon('plug-zap')+'测试连接</button><button class="tide-delete tide-full" data-action="delete-ai-key">移除已保存的 Key</button>':'')+'<div class="tide-note">Key 会保存在本机安全存储中，不会进入备份。保存时会发送一条简短测试请求；只有你选择 AI 校对时，课表图片才会发送。</div>'+(installed?'':'<div class="tide-note">正在连接安全存储，你现在可以先填写 Key。</div>');
  }
  function testAiConnection(){
    if(!window.XixuAI?.testConnection){aiTestState='failed';aiTestMessage='请更新汐序后再测试连接。';render();return}
    aiTestState='testing';aiTestMessage='正在向 DeepSeek 发送简短测试请求……';render();try{if(!window.XixuAI.testConnection()){aiTestState='failed';aiTestMessage='测试没有开始，请检查 Key 后重试。';render()}}catch(_){aiTestState='failed';aiTestMessage='测试没有开始，请重新打开汐序后重试。';render()}
  }
  window.XixuReceiveAITest=(ok,status,body)=>{
    if(ok){aiTestState='ok';aiTestMessage='DeepSeek 已响应，Key 可以使用。'}else{let message=body;try{message=JSON.parse(body).error?.message||body}catch(_){}aiTestState='failed';aiTestMessage=status===401?'Key 无效或账户没有可用额度。':status===429?'请求过于频繁，请稍后重试。':'连接失败：'+String(message||'未知错误')}
    if(panel?.kind==='ai-settings')render();notify(aiTestState==='ok'?'DeepSeek 已连接':'无法连接 DeepSeek');
  };
  function renderAiCandidate(item){
    if(item.needsClarification)return '<div class="xixu-ai-review needs-help">'+icon('message-circle-question')+'<div><strong>还需要一点信息</strong><span>'+esc(item.question||'你想安排在哪一天、几点？')+'</span></div></div>';
    const isLesson=item.kind==='lesson',courseName=item.courseName||'个人安排';
    const details=isLesson?[['周一','周二','周三','周四','周五','周六','周日'][item.weekday],item.startTime+(item.endTime?' — '+item.endTime:''),item.room||'教室待确认']:[types[item.type]||'任务',dateLabel(item.date)+(item.time?' '+item.time:''),repeatLabel(item.repeat)];
    return '<div class="xixu-ai-review"><div class="xixu-ai-review-head"><span>'+icon(isLesson?'calendar-days':'sparkles')+'整理后的安排</span><span class="tide-pill">请核对</span></div><h3>'+esc(item.title||courseName)+'</h3><p>'+esc(courseName)+'</p><div class="xixu-ai-chips">'+details.map(value=>'<span>'+esc(value)+'</span>').join('')+'</div>'+(!isLesson&&item.type!=='task'?'<div class="xixu-ai-reminder">'+icon('bell-ring')+'提前 1 天和 1 小时提醒</div>':'')+'<button class="tide-primary tide-full" data-action="confirm-ai">'+icon('check')+'加入日程</button><button class="tide-link tide-full" data-action="clear-ai">换一种说法</button></div>';
  }
  function nextWeekday(target,nextWeek){
    const today=(new Date(DEMO_DAY+'T12:00:00Z').getUTCDay()+6)%7;
    let delta=(target-today+7)%7;if(delta===0)delta=7;if(nextWeek)delta+=7;
    return addDays(DEMO_DAY,delta);
  }
  function localAiPreview(text){
    const normalized=text.trim(),weekdayChars='一二三四五六日天',explicit=normalized.match(/(?:(\d{4})[年./-])?(\d{1,2})[月./-](\d{1,2})(?:日|号)?/);let date=DEMO_DAY;
    if(explicit){let year=Number(explicit[1]||DEMO_DAY.slice(0,4)),candidate=year+'-'+String(Number(explicit[2])).padStart(2,'0')+'-'+String(Number(explicit[3])).padStart(2,'0');if(!explicit[1]&&candidate<DEMO_DAY)candidate=(year+1)+'-'+candidate.slice(5);if(Number.isNaN(Date.parse(candidate)))return {needsClarification:true,question:'这个日期似乎不存在，请再确认一下。'};date=candidate}
    else if(/后天/.test(normalized))date=addDays(DEMO_DAY,2);else if(/明天|明晚/.test(normalized))date=addDays(DEMO_DAY,1);else {
      const wm=normalized.match(/(下周|周)([一二三四五六日天])/);if(wm)date=nextWeekday(Math.min(6,weekdayChars.indexOf(wm[2])),wm[1]==='下周');
    }
    const hasDate=Boolean(explicit||/今天|今晚|明天|明晚|后天|(?:下周|周)[一二三四五六日天]/.test(normalized));
     if(!hasDate)return {needsClarification:true,question:'你说的是哪一天？可以说“明天”或直接说日期。'};
    let hour=23,minute=59;const clock=normalized.match(/(?:^|\D)([01]?\d|2[0-3])[:：]([0-5]\d)(?:\D|$)/),tm=normalized.match(/(上午|中午|下午|晚上|今晚|明晚)?\s*([零一二三四五六七八九十两\d]{1,3})[点时](半|[零一二三四五六七八九十\d]{1,2}分?)?/);
    const cn={'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
    const toNum=value=>/^\d+$/.test(value)?Number(value):(value.length===1?cn[value]:value==='十'?10:value.startsWith('十')?10+(cn[value[1]]||0):value.endsWith('十')?(cn[value[0]]||0)*10:(cn[value[0]]||0)*10+(cn[value[1]]||0));
    if(clock){hour=Number(clock[1]);minute=Number(clock[2])}else if(tm){hour=toNum(tm[2]);minute=tm[3]==='半'?30:(tm[3]?toNum(tm[3].replace('分','')):0);if(/下午|晚上|今晚|明晚/.test(tm[1]||'')&&hour<12)hour+=12;}
    const type=/雅思|考试|期末|考/.test(normalized)?'exam':/会议|开会/.test(normalized)?'meeting':/作业|报告|ddl|截止|交/.test(normalized)?'homework':'task';
    const hasTime=Boolean(clock||tm);
    const time=type==='task'&&!hasTime?'':String(Math.min(23,hour)).padStart(2,'0')+':'+String(Math.min(59,minute)).padStart(2,'0');
    const matched=courses.find(c=>normalized.includes(c.name)||normalized.includes(c.short));
    let title=normalized.replace(/^(明天|后天|今天|今晚|明晚|下周[一二三四五六日天]|周[一二三四五六日天])\s*/,'').replace(/^(上午|下午|晚上|中午)?[零一二三四五六七八九十两\d]{1,3}[点时](半|[零一二三四五六七八九十\d]{1,2}分?)?\s*/,'').replace(/[，,]?(每周重复|每周|提醒我).*$/,'').trim();
    if(!title)title=types[type];
    return {kind:'item',type,title,courseName:matched?.name||'',date,time,plan:type==='task'?date:'',repeat:/每天|每日/.test(normalized)?'daily':/每周|每星期/.test(normalized)?'weekly':'none',reminders:type==='task'?[]:[24,1],note:'',needsClarification:false,question:''};
  }
  function normalizeAi(value){
    const item=value?.item||value;if(!item||typeof item!=='object')throw Error('没有识别到可安排的内容。');
    const kind=item.kind==='lesson'?'lesson':'item';
     if(item.needsClarification)return {needsClarification:true,question:String(item.question||'请补充日期或时间。')};
    if(kind==='lesson'){
       const weekday=Number(item.weekday);if(!Number.isInteger(weekday)||weekday<0||weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.startTime||'')))throw Error('请补充上课日期和时间。');
      return {kind,courseName:String(item.courseName||'').slice(0,80),title:String(item.title||item.courseName||'课程').slice(0,100),weekday,startTime:String(item.startTime),endTime:/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.endTime||''))?String(item.endTime):'',room:String(item.room||'').slice(0,80),weeks:Array.isArray(item.weeks)?item.weeks.map(Number).filter(w=>Number.isInteger(w)&&w>=1&&w<=20):[],needsClarification:false};
    }
     const type=['homework','exam','meeting','task'].includes(item.type)?item.type:'task',date=String(item.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))throw Error('请补充日期。');
    const time=/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.time||''))?String(item.time):(type==='task'?'':'23:59');
    return {kind,type,title:String(item.title||types[type]).slice(0,100),courseName:String(item.courseName||'').slice(0,80),date,time,plan:/^\d{4}-\d{2}-\d{2}$/.test(String(item.plan||''))?String(item.plan):(type==='task'?date:''),repeat:['daily','weekly'].includes(item.repeat)?item.repeat:'none',reminders:type==='task'?[]:[24,1],note:String(item.note||'').slice(0,1000),needsClarification:false};
  }
  function aiPayload(text){
    const schema='{"item":{"kind":"item或lesson","type":"homework或exam或meeting或task","title":"名称","courseName":"课程名或空字符串","date":"YYYY-MM-DD","time":"HH:mm或空字符串","plan":"YYYY-MM-DD或空字符串","repeat":"none或daily或weekly","reminders":[24,1],"note":"备注","weekday":0,"startTime":"HH:mm","endTime":"HH:mm","room":"教室","weeks":[1],"needsClarification":false,"question":""}}';
    const system='你是汐序校园日程解析器。只输出合法 JSON，不解释。把一句中文整理为一个待确认的课程、DDL、考试、会议、任务或计划。kind=lesson 只用于上课安排，星期一为 weekday 0；其他均为 kind=item。没有明确年份时以当前日期推算未来最近日期。学习总结属于普通 task，交作业属于 homework，雅思和期末属于 exam。DDL 默认提醒 [24,1]，日常 task 不提醒。信息不足时 needsClarification=true 并提出一个简短问题。JSON 格式必须为：'+schema;
    return JSON.stringify({model:'deepseek-flash',messages:[{role:'system',content:system},{role:'user',content:'当前时间：'+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})+'，时区 Asia/Shanghai；现有课程：'+(linkableCourses().map(c=>c.name).join('、')||'暂无')+'。用户输入：'+text}],response_format:{type:'json_object'},thinking:{type:'disabled'},temperature:0.1,max_tokens:900,stream:false});
  }
  window.XixuReceiveAI=(ok,status,body)=>{
    aiPending=false;
    try{
       if(!ok){let message=body;try{message=JSON.parse(body).error?.message||body}catch(_){}throw Error(status===401?'Key 无效或账户没有可用额度。':status===429?'请求过于频繁，请稍后重试。':message)}
       const response=JSON.parse(body),content=response.choices?.[0]?.message?.content;if(!content)throw Error('DeepSeek 没有返回结果。');
      aiCandidate=normalizeAi(JSON.parse(content.replace(/^```json\s*|\s*```$/g,'')));render();
     }catch(error){notify('暂时无法理解：'+error.message);render()}
  };
  function saveAiCandidate(){
    const item=aiCandidate;if(!item||item.needsClarification)return;
    if(item.kind==='lesson'){
       if(!item.courseName){notify('课程名称是什么？');return;}
      let c=courses.find(entry=>entry.name===item.courseName);if(!c){c={id:uid(),name:item.courseName,short:item.courseName,mark:item.courseName.slice(0,1),image:null,source:'manual'};courses.push(c)}
      const minute=value=>Number(value.slice(0,2))*60+Number(value.slice(3)),period=Array.from({length:scheduleSettings.count},(_,index)=>index+1).reduce((best,value)=>Math.abs(minute(periodInfo(value).start)-minute(item.startTime))<Math.abs(minute(periodInfo(best).start)-minute(item.startTime))?value:best,1),block=periodBlockIndex(period);
      const weeks=item.weeks.length?item.weeks:Array.from({length:21-week},(_,i)=>week+i);
      lessons.push({course:c.id,day:item.weekday,block,period:String(period),weeks,rule:'第 '+weeks.join('、')+' 周',room:item.room||'教室待定',end:item.endTime||periodInfo(period).end});
       aiCandidate=null;page='timetable';panel=null;render();notify('课程已加入课表');return;
    }
    let courseId='';if(item.courseName){let c=courses.find(entry=>entry.name===item.courseName);if(!c){c={id:uid(),name:item.courseName,short:item.courseName,mark:item.courseName.slice(0,1),image:null,source:'manual'};courses.push(c)}courseId=c.id;}
    tasks.push({id:uid(),type:item.type,title:item.title,course:courseId,date:item.date,time:item.time,plan:item.plan,repeat:item.repeat,reminders:item.reminders,note:item.note,done:false,estimateMinutes:0,sessions:[],images:[]});
     aiCandidate=null;page=item.type==='task'?'today':'agenda';panel=null;render();notify('已按默认提醒加入日程');
  }
  root.addEventListener('submit',event=>{
    if(event.target.id==='xixu-smart-form'){
      event.preventDefault();const text=String(new FormData(event.target).get('sentence')||'').trim();if(!text)return;aiPending=true;render();
       if(window.XixuAI&&aiHasKey()){if(!window.XixuAI.analyze(aiPayload(text))){aiPending=false;render();notify('请求没有开始，请重试。')}}
      else {setTimeout(()=>{try{aiCandidate=normalizeAi(localAiPreview(text))}catch(error){notify(error.message)}aiPending=false;render()},180)}
    } else if(event.target.id==='xixu-ai-key-form'){
       event.preventDefault();const key=String(new FormData(event.target).get('apiKey')||'').trim();if(key.length<12){notify('请输入完整的 API Key。');return}waitForNativeBridge('XixuAI').then(bridge=>{try{if(bridge?.saveKey?.(key)){aiTestState='untested';aiTestMessage='Key 已安全保存，正在测试连接……';render();notify('DeepSeek Key 已安全保存');testAiConnection()}else notify('安全存储尚未连接，请重新打开最新版本的汐序。')}catch(_){notify('Key 没有保存成功，请重新打开汐序后重试。')}});
    }
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');if(!button)return;
    const action=button.dataset.action;
    if(action==='ai-settings')openPanel({kind:'ai-settings'});
    else if(action==='test-ai-key')testAiConnection();
    else if(action==='manual-add')openPanel({kind:'edit',type:'homework'});
    else if(action==='ai-example'){const input=main.querySelector('[name="sentence"]');if(input){input.value=button.dataset.text;input.focus()}}
    else if(action==='confirm-ai')saveAiCandidate();
    else if(action==='clear-ai'){aiCandidate=null;render()}
    else if(action==='delete-ai-key'&&window.XixuAI?.deleteKey()){aiTestState='untested';aiTestMessage='';render();notify('DeepSeek Key 已移除')}
  });

