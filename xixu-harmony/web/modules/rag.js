  const AGENT_RAG_CONFIG={
    version:'hybrid-local-v2',maxResults:12,defaultResults:8,maxContextChars:6400,
    chunkChars:560,chunkOverlap:80,maxChunksPerDocument:2,vectorDimensions:384,
    documentBatch:24,chunkBatch:64
  };
  // Explicit lexical aliases, not an embedding model. Intent parsing always
  // reads the original question, before any alias expansion.
  const agentRagSynonyms={
    作业:'功课 homework assignment',ddl:'deadline 截止',考试:'测验 exam test',
    课程:'上课 course class',课表:'timetable',笔记:'备忘录 note memo',
    任务:'待办 todo task',碎片:'碎念 随手记 scratch',
    人工智能:'ai artificial intelligence',向量检索:'vector retrieval',
    向量数据库:'vector database',召回率:'recall',截止:'deadline ddl'
  };
  const agentRagPhraseAliases={人工智能:['ai','artificial intelligence'],向量检索:['vector retrieval'],向量数据库:['vector database'],召回率:['recall']};
  const ragNoiseWords=[
    '能不能','可不可以','有没有','告诉我','帮我找一下','帮我看看','帮我查一下',
    '帮我找','帮我查','帮我','请帮','找一下','查一下','看一下','具体要','具体',
    '关于','有关','里面','一下','这个','那个','这些','那些','我的','我们的',
    '什么','怎么','如何','为什么','是否','哪些','所有','全部','一些','还有',
    '看看','查询','查找','检索','搜索','寻找','找到','查看','可以','需要','想要',
    '请问','麻烦','请','就是','的话','一下子','比较','整理','梳理','总结','内容',
    '给我','帮忙','这边','现在','的呢','的呀','的吗','了吗','了吧','的','了','吗','呢','啊','吧','呀','我','你','它','和','与','及','从','到','至'
  ].sort((a,b)=>b.length-a.length);
  const ragEnglishNoise=new Set('a an the of for to in on at is are was were be been my our your me you i it this that these those please help find search show tell what which how why can could would do does did about all any some and or with'.split(' '));
  const ragSafeText=value=>String(value??'').normalize('NFKC').replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
  function ragContentText(value){
    let text=ragSafeText(value).toLowerCase();
    // A single Chinese stop character is not a word boundary. Never strip
    // "请" from "申请/邀请", "和" from "和谐", or "的" from "目的".
    for(const word of ragNoiseWords){
      if(word.length>1)text=text.split(word).join(' ');
      else text=text.replace(new RegExp('(^|\\s)'+word+'(?=\\s|$)','g'),'$1 ');
    }
    return text.replace(/\b[a-z]+\b/g,word=>ragEnglishNoise.has(word)?' ':word).replace(/\s+/g,' ').trim();
  }
  function ragExpandedText(value){
    const original=ragSafeText(value).toLowerCase(),extra=[];
    for(const [word,related] of Object.entries(agentRagSynonyms))if(original.includes(word))extra.push(related);
    return original+' '+extra.join(' ');
  }
  function ragTokenWeights(value,stripNoise=true){
    const text=stripNoise?ragContentText(value):ragSafeText(value).toLowerCase(),weights=new Map(),add=(token,weight)=>{if(token)weights.set(token,Math.min(4,(weights.get(token)||0)+weight))};
    for(const word of text.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g)||[])add(word,1.25);
    for(const run of text.match(/[\u3400-\u9fff]+/g)||[]){
      if(run.length===1)add(run,.12);
      for(let i=0;i<run.length-1;i++)add(run.slice(i,i+2),1);
      for(let i=0;i<run.length-2;i++)add(run.slice(i,i+3),1.12);
    }
    return weights;
  }
  function ragHash(value){let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619)}return hash>>>0}
  function ragVector(tokenWeights){
    const vector=new Float32Array(AGENT_RAG_CONFIG.vectorDimensions);let length=0;
    tokenWeights.forEach((weight,token)=>{const hash=ragHash(token),index=hash%vector.length,sign=(hash&0x80000000)?-1:1;vector[index]+=sign*weight});
    for(const value of vector)length+=value*value;length=Math.sqrt(length)||1;
    for(let i=0;i<vector.length;i++)vector[i]/=length;
    return vector;
  }
  function ragCosine(left,right){let value=0;for(let i=0;i<left.length;i++)value+=left[i]*right[i];return Math.max(0,value)}
  function ragChunkRanges(value){
    // Offsets refer to the untouched source, not a whitespace-normalized copy.
    const text=String(value??''),ranges=[];let start=0;
    if(!text.length)return [{start:0,end:0,text:''}];
    while(start<text.length){
      let end=Math.min(text.length,start+AGENT_RAG_CONFIG.chunkChars);
      if(end<text.length){
        const natural=Math.max(text.lastIndexOf('。',end-1),text.lastIndexOf('；',end-1),text.lastIndexOf('\n',end-1));
        if(natural>start+280)end=natural+1;
        const last=text.charCodeAt(end-1);if(last>=0xd800&&last<=0xdbff)end--;
      }
      ranges.push({start,end,text:text.slice(start,end)});if(end>=text.length)break;
      start=Math.max(start+1,end-AGENT_RAG_CONFIG.chunkOverlap);
      const first=text.charCodeAt(start);if(first>=0xdc00&&first<=0xdfff)start++;
    }
    return ranges;
  }
  function ragChunkText(value){return ragChunkRanges(value).map(range=>range.text)}
  function ragCourseText(item,rows){
    const meetings=(rows||lessons.filter(lesson=>lesson.course===item.id)).map(lesson=>'周'+'一二三四五六日'[lesson.day]+' '+lesson.room+' 第'+lessonPeriodNumbers(lesson).join('至')+'节 '+lesson.rule+(lesson.dateOverride?' 仅限 '+lesson.dateOverride:'')+(lesson.cancelledDates?.length?' 原日期停课 '+lesson.cancelledDates.join('、'):''));
    const assessment=(item.assessment||[]).map(entry=>entry.name+' '+entry.percent+'%');
    return [item.name,item.short,...meetings,...assessment].filter(Boolean).join('\n');
  }
  function ragDocuments(){
    const documents=[],courseNames=new Map(courses.map(item=>[item.id,item.name])),meetingMap=new Map();
    for(const item of lessons){if(!meetingMap.has(item.course))meetingMap.set(item.course,[]);meetingMap.get(item.course).push(item)}
    for(const item of courses){
      const rows=meetingMap.get(item.id)||[],dates=[];
      for(const row of rows){
        const cancelled=new Set(row.cancelledDates||[]);
        if(row.dateOverride){if(!cancelled.has(row.dateOverride))dates.push(row.dateOverride);continue}
        for(const teachingWeek of row.weeks||[]){const date=addDays(TERM_MONDAY,(teachingWeek-1)*7+row.day);if(!cancelled.has(date))dates.push(date)}
      }
      documents.push({documentId:'course:'+item.id,id:item.id,kind:'课程',recordType:'course',title:String(item.name||''),text:ragCourseText(item,rows),action:'course',courseId:item.id,courseName:String(item.name||''),date:'',dates:[...new Set(dates)].sort(),time:'',done:false,updatedAt:'',imageCount:item.image?1:0});
    }
    for(const item of tasks)documents.push({documentId:'task:'+item.id,id:item.id,kind:types[item.type]||'任务',recordType:'task',taskType:item.type,title:String(item.title||''),text:[item.title,item.note,courseNames.get(item.course),...(item.sessions||[]).map(session=>session.date+' '+session.time+' '+session.minutes+'分钟')].filter(Boolean).join('\n'),action:'task-detail',courseId:item.course||'',courseName:courseNames.get(item.course)||'',date:item.date||'',dates:[item.date].filter(Boolean),time:item.time||'',done:Boolean(item.done),updatedAt:item.updatedAt||item.date||'',imageCount:item.images?.length||0});
    for(const item of notes)documents.push({documentId:'note:'+item.id,id:item.id,kind:item.category||'笔记',recordType:'note',title:String(item.title||''),text:item.archive?.projectionStatus==='original-only'?'[原文件仅归档，未解析正文；以下如有文字为用户补充记录]\n'+String(item.text??''):String(item.text??''),action:'memory',courseId:item.course||'',courseName:courseNames.get(item.course)||'',date:String(item.updatedAt||item.createdAt||'').slice(0,10),dates:[String(item.updatedAt||item.createdAt||'').slice(0,10)],time:'',done:false,updatedAt:String(item.updatedAt||item.createdAt||''),imageCount:(item.images?.length||0)+(item.archive?.images?.length||0)});
    for(const item of scratchEntries)documents.push({documentId:'scratch:'+item.id,id:item.id,kind:'碎片',recordType:'scratch',title:scratchTitle(item.text),text:String(item.text??''),action:'scratch-detail',courseId:'',courseName:'',date:String(item.updatedAt||item.createdAt||'').slice(0,10),dates:[String(item.updatedAt||item.createdAt||'').slice(0,10)],time:'',done:false,updatedAt:String(item.updatedAt||item.createdAt||''),imageCount:0});
    return documents;
  }
  let agentRagIndex={entries:new Map(),chunks:[],frequencies:new Map(),averageLength:1,revision:0};
  let agentRagPreparation=null,agentRagLastStats={reusedDocuments:0,rebuiltDocuments:0,yields:0,cacheHit:false};
  function ragSameDocument(left,right){
    if(!left||!right)return false;
    for(const key of ['id','kind','recordType','taskType','title','text','courseId','courseName','date','time','done','updatedAt','imageCount'])if(left[key]!==right[key])return false;
    return left.dates.length===right.dates.length&&left.dates.every((date,index)=>date===right.dates[index]);
  }
  function ragBuildChunk(document,range,index){
    const tokenWeights=ragTokenWeights(document.title+' '+document.courseName+' '+range.text,false);let tokenLength=0;
    tokenWeights.forEach(weight=>{tokenLength+=weight});
    const titleTopic=ragSafeText(document.title).toLowerCase().replace(/^(?:(?:我的|全部|所有|新建|未命名)\s*)?(?:备忘录|笔记|碎片|记录|想法|任务|事项|课表|课程|作业|考试|会议|notes?|memo|task|course|scratch)(?:\s*\d+)?$/g,'').trim();
    return {...document,text:range.text,titleTopic,chunkId:document.documentId+':'+index,chunkIndex:index,chunkStart:range.start,chunkEnd:range.end,sourceChars:document.text.length,sourceExcerpt:range.start>0||range.end<document.text.length,tokenWeights,tokenLength,vector:ragVector(tokenWeights)};
  }
  function ragIndexStats(stats){return {strategy:AGENT_RAG_CONFIG.version,documents:agentRagIndex.entries.size,chunks:agentRagIndex.chunks.length,revision:agentRagIndex.revision,...stats}}
  function ragPublishIndex(entries,chunks,frequencies,totalLength,changed,stats){
    if(changed)agentRagIndex={entries,chunks,frequencies,averageLength:totalLength/(chunks.length||1)||1,revision:agentRagIndex.revision+1};
    agentRagLastStats={...stats,cacheHit:!changed};return ragIndexStats(agentRagLastStats);
  }
  function ragPrepareSync(){
    const documents=ragDocuments(),entries=new Map(),chunks=[],frequencies=new Map();let totalLength=0,changed=documents.length!==agentRagIndex.entries.size,reusedDocuments=0,rebuiltDocuments=0;
    for(const document of documents){
      const previous=agentRagIndex.entries.get(document.documentId),unchanged=ragSameDocument(previous?.document,document);
      const entry=unchanged?previous:{document,chunks:ragChunkRanges(document.text).map((range,index)=>ragBuildChunk(document,range,index))};
      if(unchanged)reusedDocuments++;else {changed=true;rebuiltDocuments++}entries.set(document.documentId,entry);chunks.push(...entry.chunks);
    }
    if(changed)for(const chunk of chunks){totalLength+=chunk.tokenLength;chunk.tokenWeights.forEach((_,token)=>frequencies.set(token,(frequencies.get(token)||0)+1))}
    return ragPublishIndex(entries,chunks,frequencies,totalLength,changed,{reusedDocuments,rebuiltDocuments,yields:0});
  }
  const ragYield=()=>new Promise(resolve=>setTimeout(resolve,0));
  async function prepareAgentRagIndex(){
    if(agentRagPreparation)return agentRagPreparation;
    agentRagPreparation=(async()=>{
      const documents=ragDocuments(),entries=new Map(),chunks=[],frequencies=new Map();let totalLength=0,changed=documents.length!==agentRagIndex.entries.size,reusedDocuments=0,rebuiltDocuments=0,yields=0,work=0;
      for(let documentIndex=0;documentIndex<documents.length;documentIndex++){
        const document=documents[documentIndex],previous=agentRagIndex.entries.get(document.documentId);let entry=previous;
        if(ragSameDocument(previous?.document,document))reusedDocuments++;
        else {
          changed=true;rebuiltDocuments++;entry={document,chunks:[]};
          for(const [chunkIndex,range] of ragChunkRanges(document.text).entries()){
            entry.chunks.push(ragBuildChunk(document,range,chunkIndex));
            if(++work>=AGENT_RAG_CONFIG.chunkBatch){work=0;yields++;await ragYield()}
          }
        }
        entries.set(document.documentId,entry);chunks.push(...entry.chunks);
        if((documentIndex+1)%AGENT_RAG_CONFIG.documentBatch===0){yields++;await ragYield()}
      }
      if(changed)for(let index=0;index<chunks.length;index++){
        const chunk=chunks[index];totalLength+=chunk.tokenLength;chunk.tokenWeights.forEach((_,token)=>frequencies.set(token,(frequencies.get(token)||0)+1));
        if((index+1)%AGENT_RAG_CONFIG.chunkBatch===0){yields++;await ragYield()}
      }
      return ragPublishIndex(entries,chunks,frequencies,totalLength,changed,{reusedDocuments,rebuiltDocuments,yields});
    })();
    try{return await agentRagPreparation}finally{agentRagPreparation=null}
  }
  function ragChunks(){ragPrepareSync();return agentRagIndex.chunks}
  function ragIsoDate(year,month,day){
    const value=new Date(Date.UTC(year,month-1,day));
    return value.getUTCFullYear()===year&&value.getUTCMonth()===month-1&&value.getUTCDate()===day?[year,String(month).padStart(2,'0'),String(day).padStart(2,'0')].join('-'):'';
  }
  function ragSpokenNumber(value){
    if(/^\d+$/.test(value))return Number(value);
    const digits={'〇':0,'零':0,'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
    if(value.includes('十')){const parts=value.split('十');return (parts[0]?digits[parts[0]]:1)*10+(parts[1]?digits[parts[1]]:0)}
    return Number(Array.from(value,char=>digits[char]??'').join(''));
  }
  function ragNormalizeSpokenDates(value){
    return ragSafeText(value).replace(/(?:([〇零一二三四五六七八九\d]{4})\s*年\s*)?([〇零一二两三四五六七八九十\d]{1,3})\s*月\s*([〇零一二两三四五六七八九十\d]{1,3})\s*(日|号)?/g,(_,year,month,day,suffix)=>(year?ragSpokenNumber(year)+'年':'')+ragSpokenNumber(month)+'月'+ragSpokenNumber(day)+(suffix||'日'));
  }
  function ragQueryPlan(query){
    const text=ragNormalizeSpokenDates(query).toLowerCase(),today=DEMO_DAY,plan={text,courseIds:[],recordTypes:[],taskTypes:[],status:'',from:'',to:'',broad:false,mutation:false,invalidDate:false};
    plan.courseIds=courses.filter(item=>[item.name,item.short].some(name=>name&&String(name).length>=2&&text.includes(String(name).toLowerCase()))).map(item=>item.id);
    const noteIntent=/笔记|备忘录|记录|想法|梦境|\b(?:notes?|memo)\b/.test(text),scratchIntent=/碎片|碎念|碎碎念|随手写|随手记|刚才写|临时想法|\bscratch\b/.test(text);
    const taskIntentText=text.replace(/(?:考试|测验|会议|作业|功课)(?:的)?(?:记录|笔记|纪要|备忘录)|\b(?:meeting|exam|homework)\s+notes?\b/g,' ');
    if(/课程|课表|上课|教室|\b(?:courses?|classes?|timetable)\b/.test(text))plan.recordTypes.push('course');
    if(!noteIntent&&!scratchIntent&&/日程|安排|计划/.test(text))plan.recordTypes.push('course','task');
    if(noteIntent)plan.recordTypes.push('note');if(scratchIntent)plan.recordTypes.push('scratch');
    if(/任务|待办|事项|作业|功课|ddl|截止|\b(?:tasks?|todo|homework|assignment|deadline)\b/.test(taskIntentText)||(!noteIntent&&!scratchIntent&&/考试|测验|会议|\b(?:exam|test|meeting)\b/.test(taskIntentText)))plan.recordTypes.push('task');
    if(/作业|功课|ddl|截止|提交|\b(?:homework|assignment|deadline)\b/.test(taskIntentText))plan.taskTypes.push('homework');
    if(/考试|测验|\b(?:exam|test)\b/.test(taskIntentText))plan.taskTypes.push('exam');
    if(/会议|\bmeeting\b/.test(taskIntentText))plan.taskTypes.push('meeting');
    if(/未完成|没完成|没做完|还没做|还没完成|尚未完成|待完成|待办|还要|需要做|\b(?:pending|todo|unfinished|not done|not finished)\b/.test(text))plan.status='pending';
    else if(/已完成|已经完成|做完了|做完的|完成了|完成的|已经做完|\b(?:done|finished|completed)\b/.test(text))plan.status='done';
    if(plan.status&&!plan.recordTypes.length)plan.recordTypes.push('task');
    plan.recordTypes=[...new Set(plan.recordTypes)];
    if(/大后天/.test(text))plan.from=plan.to=addDays(today,3);
    else if(/后天/.test(text))plan.from=plan.to=addDays(today,2);
    else if(/明天|\btomorrow\b/.test(text))plan.from=plan.to=addDays(today,1);
    else if(/前天/.test(text))plan.from=plan.to=addDays(today,-2);
    else if(/昨天|\byesterday\b/.test(text))plan.from=plan.to=addDays(today,-1);
    else if(/今天|今日|\btoday\b/.test(text))plan.from=plan.to=today;
    else if(/下周|下星期|下礼拜|\bnext week\b/.test(text)){plan.from=addDays(mondayOf(today),7);plan.to=addDays(plan.from,6)}
    else if(/上周|上星期|上礼拜|\blast week\b/.test(text)){plan.from=addDays(mondayOf(today),-7);plan.to=addDays(plan.from,6)}
    else if(/本周|这周|这个星期|这星期|这礼拜|\bthis week\b/.test(text)){plan.from=mondayOf(today);plan.to=addDays(plan.from,6)}
    else if(/最近|近期/.test(text)){const past=noteIntent||scratchIntent||plan.status==='done';plan.from=past?addDays(today,-30):today;plan.to=past?today:addDays(today,21)}
    else if(/接下来|未来|\bupcoming\b/.test(text)){plan.from=today;plan.to=addDays(today,21)}
    const weekdayMatch=text.match(/(?:(下|上|这|本)(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天])/);
    if(weekdayMatch){const shift=weekdayMatch[1]==='下'?7:weekdayMatch[1]==='上'?-7:0,index='一二三四五六日'.indexOf(weekdayMatch[2]==='天'?'日':weekdayMatch[2]);plan.from=plan.to=addDays(mondayOf(today),shift+index)}
    const dateValues=[...text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)].map(match=>ragIsoDate(Number(match[1]),Number(match[2]),Number(match[3])));
    if(!dateValues.length)for(const match of text.matchAll(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)?/g))dateValues.push(ragIsoDate(Number(match[1]||today.slice(0,4)),Number(match[2]),Number(match[3])));
    if(dateValues.length){plan.invalidDate=dateValues.some(value=>!value);const valid=dateValues.filter(Boolean).sort();if(valid.length){plan.from=valid[0];plan.to=valid.at(-1)}}
    plan.broad=/所有|全部|综合|梳理|比较|总结|安排|规划|哪些|有什么|最近|近期|接下来|本周|下周|\b(?:all|compare|summary)\b/.test(text);
    plan.mutation=/添加|新建|安排|追加|删除|移除|修改|\b(?:create|add|complete|delete|update)\b/.test(text);
    return plan;
  }
  function ragQueryContent(query,plan){
    let text=ragNormalizeSpokenDates(query).toLowerCase();
    text=text.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|(?:(?:20\d{2})\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*(?:日|号)?/g,' ');
    text=text.replace(/(?:(?:下|上|这|本)(?:个)?)?(?:周|星期|礼拜)[一二三四五六日天]|下周|上周|本周|这周|下星期|上星期|这个星期|这星期|下礼拜|上礼拜|这礼拜|大后天|后天|前天|明天|昨天|今天|今日|接下来|最近|近期|未来/g,' ');
    text=text.replace(/尚未完成|已经完成|还没完成|还没做完|未完成|没完成|没做完|还没做|待完成|已经做完|已完成|做完了|做完的|完成了|完成的|待办|需要做|还要|更新的|更新|有哪些|有什么|记了什么|写了什么|写过什么/g,' ');
    text=text.replace(/备忘录|笔记|碎碎念|碎念|碎片|随手写|随手记|记录|想法|梦境|课表|课程|上课|教室|作业|功课|ddl|截止|任务|事项|日程|安排|计划|规划/g,' ');
    text=text.replace(/\b(?:today|tomorrow|yesterday|next week|last week|this week|recent|recently|upcoming|pending|todo|unfinished|not done|not finished|done|finished|completed|notes?|memo|scratch|courses?|classes?|timetable|tasks?|homework|assignment|deadline)\b/g,' ');
    if(plan.taskTypes.includes('exam'))text=text.replace(/考试|测验|\b(?:exam|test)\b/g,' ');
    if(plan.taskTypes.includes('meeting'))text=text.replace(/会议|\bmeeting\b/g,' ');
    return ragContentText(text).replace(/[^a-z0-9\u3400-\u9fff]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function ragMatchesFilters(chunk,plan){
    if(plan.invalidDate)return false;
    if(plan.recordTypes.length&&!plan.recordTypes.includes(chunk.recordType))return false;
    if(plan.status&&(chunk.recordType!=='task'||chunk.done!==(plan.status==='done')))return false;
    if(chunk.recordType==='task'&&plan.taskTypes.length&&!plan.taskTypes.includes(chunk.taskType))return false;
    if(plan.from&&!chunk.dates.some(date=>date&&date>=plan.from&&date<=plan.to))return false;
    return true;
  }
  function contextualAgentRagQuery(query,history,conversationId){
    const original=String(query??''),text=ragSafeText(original);
    if(text.length>80||!(/^(?:那|那么|然后|接着|继续|再|它|这个|那个|这些|刚才|上面|前面|具体)/.test(text)||/(?:它|这个|那个|这些|上面|前面|刚才).*(?:呢|怎样|怎么|具体)/.test(text)))return original;
    const stripReferences=value=>value.replace(/那么|然后|接着|继续|它们|这个|那个|这些|这件|上面|前面|刚才|还有啥|怎么办|怎样|怎么做|那|它|再|先/g,' ').trim();
    const currentTopic=stripReferences(ragQueryContent(text,ragQueryPlan(text)));
    // An explicit new subject is a new query, not a reason to borrow old topics.
    if(/[a-z0-9\u3400-\u9fff]{2,}/i.test(currentTopic))return original;
    const activeId=String(conversationId||(typeof agentPreferences==='object'&&agentPreferences.activeConversationId)||'default');
    const items=Array.isArray(history)?history.filter(item=>item?.role==='user'&&String(item.conversationId||'default')===activeId):[];
    let skippedCurrent=false;
    for(let index=items.length-1,seen=0;index>=0&&seen<6;index--,seen++){
      const previous=String(items[index].text||'');
      if(!skippedCurrent&&ragSafeText(previous)===text){skippedCurrent=true;continue}
      const topic=stripReferences(ragQueryContent(previous,ragQueryPlan(previous)));
      if(!/[a-z0-9\u3400-\u9fff]{2,}/i.test(topic))continue;
      // Only topical words survive; old date/status/type filters cannot leak.
      return topic.slice(0,240)+'\n'+original;
    }
    return original;
  }
  function ragStructuredScore(chunk,plan){
    let score=0;const reasons=[];
    if(plan.courseIds.includes(chunk.courseId)){score+=.12;reasons.push('课程匹配')}
    if(plan.recordTypes.includes(chunk.recordType)){score+=.06;reasons.push('资料类型已筛选')}
    if(plan.taskTypes.includes(chunk.taskType)){score+=.05;reasons.push('事项类型已筛选')}
    if(plan.status){score+=.05;reasons.push('完成状态已筛选')}
    if(plan.from){score+=.07;reasons.push('日期范围已筛选')}
    if(plan.broad&&chunk.recordType==='task'&&!chunk.done&&chunk.date>=DEMO_DAY){const days=Math.max(0,Math.round((Date.parse(chunk.date)-Date.parse(DEMO_DAY))/86400000));score+=.04/(1+days/7)}
    return {score,reasons};
  }
  function ragBm25(chunks,queryWeights,index=agentRagIndex){
    const k1=1.25,b=.72,total=index.chunks.length||1,average=index.averageLength||1;
    return chunks.map(chunk=>{let score=0;queryWeights.forEach((queryWeight,token)=>{const tf=chunk.tokenWeights.get(token)||0;if(!tf)return;const df=index.frequencies.get(token)||0,idf=Math.log(1+(total-df+.5)/(df+.5));score+=Math.min(2,queryWeight)*idf*(tf*(k1+1))/(tf+k1*(1-b+b*chunk.tokenLength/average))});return 1-Math.exp(-score/5.5)});
  }
  function ragDynamicLimit(plan){if(plan.mutation)return 6;if(plan.broad)return AGENT_RAG_CONFIG.maxResults;return AGENT_RAG_CONFIG.defaultResults}
  function semanticAgentSearch(query){
    const plan=ragQueryPlan(query),stats=ragPrepareSync(),chunks=agentRagIndex.chunks,core=ragQueryContent(query,plan),primary=ragTokenWeights(core),queryWeights=new Map(primary),normalized=ragSafeText(query).toLowerCase();
    const scoped=!core&&(plan.recordTypes.length||plan.status||plan.from||plan.courseIds.length);
    // Aliases improve ranking, but a hash collision, date, generic category or
    // recency cannot invent topical relevance.
    for(const [word,related] of Object.entries(agentRagSynonyms))if(core.includes(word))ragTokenWeights(related).forEach((weight,token)=>{if(!queryWeights.has(token))queryWeights.set(token,weight*.3)});
    const queryVector=ragVector(queryWeights),bm25=ragBm25(chunks,queryWeights),candidates=[];let primaryTotal=0;
    const conversational=/^(?:你好|您好|嗨|在吗|早上好|晚上好|谢谢(?:你)?|多谢|hello|hi|hey|thanks)[\s!！?？。,.，]*$/i.test(normalized);
    primary.forEach(weight=>{primaryTotal+=weight});
    for(let index=0;index<chunks.length;index++){
      const chunk=chunks[index];if(conversational||!ragMatchesFilters(chunk,plan))continue;
      const title=ragSafeText(chunk.title).toLowerCase(),haystack=ragSafeText(chunk.title+' '+chunk.courseName+' '+chunk.text).toLowerCase();
      const exactTitle=title.length>=2&&normalized.includes(title)&&(normalized===title||chunk.titleTopic.length>=2),phrases=core.split(' ').filter(value=>value.length>=2),phraseMatch=phrases.some(value=>haystack.includes(value));
      const aliasPhraseMatch=Object.entries(agentRagPhraseAliases).some(([word,aliases])=>core.includes(word)&&aliases.some(alias=>new RegExp('\\b'+alias+'\\b','i').test(haystack)));
      let overlap=0,aliasOverlap=0;primary.forEach((weight,token)=>{if(chunk.tokenWeights.has(token))overlap+=weight});
      queryWeights.forEach((weight,token)=>{if(!primary.has(token)&&chunk.tokenWeights.has(token))aliasOverlap+=weight});
      const coverage=primaryTotal?overlap/primaryTotal:0;
      const relevant=exactTitle||phraseMatch||aliasPhraseMatch||coverage>=.24||(aliasOverlap>=.65&&coverage>0)||scoped;
      if(!relevant||(!core&&!scoped&&!exactTitle))continue;
      if(scoped&&plan.courseIds.length&&!plan.recordTypes.length&&!plan.courseIds.includes(chunk.courseId))continue;
      const feature=ragCosine(queryVector,chunk.vector),structured=ragStructuredScore(chunk,plan),exact=exactTitle?.65:phraseMatch?.24:0;
      const score=bm25[index]*.48+coverage*.24+feature*.08+structured.score+exact+(scoped?.12:0);
      candidates.push({...chunk,score,exactTitle,reasons:[...(exactTitle?['精确标题匹配']:phraseMatch?['精确关键词匹配']:[]),...(overlap?['全文检索']:[]),...(aliasOverlap||aliasPhraseMatch?['词汇别名匹配']:[]),...structured.reasons]});
    }
    candidates.sort((a,b)=>Number(b.exactTitle)-Number(a.exactTitle)||b.score-a.score||a.documentId.localeCompare(b.documentId)||a.chunkIndex-b.chunkIndex);
    const eligibleSources=new Set(candidates.map(item=>item.documentId)).size;
    const selected=[],perDocument=new Map(),limit=ragDynamicLimit(plan);let usedChars=0;
    while(candidates.length&&selected.length<limit){
      const hasNewSource=candidates.some(candidate=>!perDocument.has(candidate.documentId));let bestIndex=-1,bestValue=-Infinity;
      for(let index=0;index<candidates.length;index++){
        const candidate=candidates[index],count=perDocument.get(candidate.documentId)||0;if(count>=AGENT_RAG_CONFIG.maxChunksPerDocument||(hasNewSource&&count))continue;
        let similarity=0;for(const item of selected)similarity=Math.max(similarity,ragCosine(candidate.vector,item.vector));
        const value=candidate.score*.9-similarity*.1+(candidate.exactTitle?.2:0)-count*.06;
        if(value>bestValue){bestValue=value;bestIndex=index}
      }
      if(bestIndex<0)break;
      const candidate=candidates.splice(bestIndex,1)[0],remaining=AGENT_RAG_CONFIG.maxContextChars-usedChars;if(remaining<1)break;
      let text=candidate.text.slice(0,remaining);const last=text.charCodeAt(text.length-1);if(last>=0xd800&&last<=0xdbff)text=text.slice(0,-1);
      const truncated=text.length<candidate.text.length;
      selected.push({...candidate,text,truncated,chunkEnd:candidate.chunkStart+text.length,sourceExcerpt:candidate.sourceExcerpt||truncated,score:Number(candidate.score.toFixed(4))});
      usedChars+=text.length;perDocument.set(candidate.documentId,(perDocument.get(candidate.documentId)||0)+1);
    }
    selected.ragMeta={strategy:AGENT_RAG_CONFIG.version,featureModel:'local-token-hash-not-embedding',candidates:chunks.length,eligibleSources,selectedSources:new Set(selected.map(item=>item.documentId)).size,selected:selected.length,contextChars:usedChars,budgetChars:AGENT_RAG_CONFIG.maxContextChars,indexRevision:stats.revision,cacheHit:stats.cacheHit,rebuiltDocuments:stats.rebuiltDocuments,emptyReason:selected.length?'':'no-relevant-sources',queryPlan:{recordTypes:plan.recordTypes,taskTypes:[...new Set(plan.taskTypes)],status:plan.status,from:plan.from,to:plan.to,broad:plan.broad,invalidDate:plan.invalidDate}};
    return selected;
  }
  function agentContext(refs){
    return refs.map(item=>({sourceId:item.chunkId,documentId:item.documentId,kind:item.kind,id:item.id,title:item.title,date:item.date||'',time:item.time||'',done:Boolean(item.done),imageCount:item.imageCount||0,relevance:item.score,reasons:item.reasons.slice(0,4),text:item.text,excerpt:{start:item.chunkStart,end:item.chunkEnd,sourceChars:item.sourceChars,partial:Boolean(item.sourceExcerpt),budgetTruncated:Boolean(item.truncated)}}));
  }
  function compactAgentConversation(history,maxChars=2600){
    const recent=[],items=history.slice(),older=items.slice(0,-6),tail=items.slice(-6);let used=0;
    for(let index=tail.length-1;index>=0;index--){const item=tail[index],content=ragSafeText(item.text).slice(0,650),room=maxChars-used;if(room<100)break;recent.unshift({role:item.role,content:content.slice(0,room)});used+=Math.min(content.length,room)}
    let memory='';if(older.length){const highlights=older.slice(-12).map(item=>(item.role==='user'?'用户：':'汐序：')+ragSafeText(item.text).slice(0,120));memory=('较早对话压缩记忆：'+highlights.join('｜')).slice(0,900)}
    return {memory,recent};
  }
