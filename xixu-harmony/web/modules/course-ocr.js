  function assessmentSummaryHtml(c){
    const items=Array.isArray(c.assessment)?c.assessment:[];
    if(!items.length)return '<div class="tide-upload-empty xixu-assessment-empty">'+icon('chart-no-axes-column-increasing')+'<p>上传成绩构成图片读取比例，也可以手动添加。</p></div><button class="tide-link tide-full" data-action="edit-assessment" data-id="'+esc(c.id)+'">'+icon('pencil-line')+'添加成绩构成</button>';
    const total=items.reduce((sum,item)=>sum+Number(item.percent),0);
    return '<div class="xixu-assessment-list">'+items.map(item=>'<div><span>'+esc(item.name)+'</span><strong>'+Number(item.percent).toLocaleString('zh-CN')+'%</strong></div>').join('')+'</div><div class="xixu-assessment-total"><span>合计</span><strong>'+Number(total.toFixed(2))+'%</strong></div><button class="tide-link tide-full" data-action="edit-assessment" data-id="'+esc(c.id)+'">'+icon('pencil-line')+'编辑成绩构成</button>';
  }
  function assessmentReviewHtml(courseId){
    if(!assessmentDraft||assessmentDraft.courseId!==courseId)return '';
    const items=assessmentDraft.items.length?assessmentDraft.items:[{name:'',percent:''}];
    return '<form id="xixu-assessment-form" class="xixu-assessment-review" data-course="'+esc(courseId)+'"><div class="xixu-assessment-review-head"><div><strong>'+(assessmentDraft.fromImage?'检查识别结果':'编辑成绩构成')+'</strong><span>可修改名称或比例</span></div><span class="tide-pill">检查</span></div><div class="xixu-assessment-fields">'+items.map((item,index)=>'<div class="xixu-assessment-field"><input name="assessmentName" maxlength="40" required placeholder="例如：平时表现" value="'+esc(item.name)+'"><label><input name="assessmentPercent" type="number" min="0" max="100" step="0.01" required value="'+esc(item.percent)+'"><span>%</span></label><button type="button" data-action="remove-assessment-row" data-index="'+index+'" aria-label="删除这一项">'+icon('x')+'</button></div>').join('')+'</div><button type="button" class="tide-link tide-full" data-action="add-assessment-row">'+icon('plus')+'添加一项</button><button class="tide-primary tide-full" type="submit">'+icon('check')+'保存</button></form>';
  }
  function parseAssessmentText(scan){
    const text=String(scan?.value||'').replace(/％/g,'%'),items=[],seen=new Set();
    const definitions=[['小组PPT展示与演讲',/小组\s*PPT\s*展示与演讲|PPT\s*Presentation/i],['期末大项目',/期末大项目|Final\s*project/i],['实验报告',/实验报告|Experiment\s*report/i],['平时表现',/平时表现|Attendance/i],['小组PPT',/小组\s*PPT|\bPPT\b/i],['考勤',/考勤|出勤/i],['平时成绩',/平时成绩|课堂表现/i],['作业',/作业|Homework/i],['实验',/实验|Experiment/i],['小测',/小测|测验|Quiz/i],['期中考试',/期中考试|期中|Midterm/i],['课程报告',/课程报告|报告|Report/i],['项目',/项目|Project/i],['展示',/展示|Presentation/i],['答辩',/答辩|Defense/i],['期末考试',/期末考试|期末|Final\s*exam/i]];
    const canonical=value=>definitions.find(([,pattern])=>pattern.test(value))?.[0]||'';
    const add=(name,percent)=>{const label=canonical(String(name||''))||String(name||'').replace(/[：:·•\-—]+$/,'').trim(),value=Number(percent);if(!label||label.length>40||!Number.isFinite(value)||value<0||value>100||seen.has(label))return;seen.add(label);items.push({name:label,percent:value})};
    const lines=(Array.isArray(scan?.blocks)?scan.blocks:[]).flatMap(block=>Array.isArray(block?.lines)?block.lines:[]).map(line=>{const points=Array.isArray(line.cornerPoints)?line.cornerPoints:[],x=points.length?points.reduce((sum,p)=>sum+Number(p.x||0),0)/points.length:NaN,y=points.length?points.reduce((sum,p)=>sum+Number(p.y||0),0)/points.length:NaN;return {value:String(line.value||''),x,y}});
    const labels=lines.map(line=>({line,name:canonical(line.value)})).filter(item=>item.name),percentages=[];
    lines.forEach(line=>{const regex=/(\d{1,3}(?:\.\d+)?)\s*%/g;let match;while((match=regex.exec(line.value.replace(/％/g,'%')))){const value=Number(match[1]);if(value>0&&value<100)percentages.push({...line,percent:value})}});
    const used=new Set();for(const percent of percentages){const choices=labels.filter(item=>!used.has(item.name)&&Number.isFinite(item.line.x)&&Number.isFinite(percent.x)&&percent.y>=item.line.y-20).map(item=>({item,score:Math.abs(percent.x-item.line.x)*2+Math.max(0,percent.y-item.line.y)})).sort((a,b)=>a.score-b.score);if(choices[0]){used.add(choices[0].item.name);add(choices[0].item.name,percent.percent)}}
    if(!items.length)for(const [label,pattern] of definitions){if((label==='项目'&&/期末大项目|Final\s*project/i.test(text))||(label==='展示'&&/小组\s*PPT\s*展示与演讲|PPT\s*Presentation/i.test(text))||(label==='实验'&&/实验报告|Experiment\s*report/i.test(text))||(label==='课程报告'&&/实验报告|Experiment\s*report/i.test(text)))continue;const source=pattern.source,forward=new RegExp('('+source+')[^\\d%]{0,18}(\\d{1,3}(?:\\.\\d+)?)\\s*%','i'),reverse=new RegExp('(\\d{1,3}(?:\\.\\d+)?)\\s*%[^\\u3400-\\u9fffA-Za-z]{0,8}('+source+')','i'),match=text.match(forward)||text.match(reverse);if(match)add(label,text.match(forward)?match[2]:match[1])}
    if(items.length<2){const orderedLabels=[...new Set(definitions.filter(([,pattern])=>pattern.test(text)).map(([label])=>label))],orderedPercents=[...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)].map(match=>Number(match[1])).filter(value=>value>0&&value<100);if(orderedLabels.length===orderedPercents.length)orderedLabels.forEach((label,index)=>add(label,orderedPercents[index]))}
    if(!items.length)throw Error('没有识别到成绩比例，可以手动添加。');
    return items;
  }
  window.XixuReceiveAssessmentOCR=(ok,body,courseId)=>{
    assessmentPending=false;
    try{
      if(!ok)throw Error(body||'图片读取失败。');
      assessmentDraft={courseId:String(courseId),items:parseAssessmentText(JSON.parse(body)),fromImage:true};render();notify('已识别成绩构成，请检查比例后保存。');
    }catch(error){assessmentDraft={courseId:String(courseId),items:[{name:'',percent:''}],fromImage:false};render();notify(error.message)}
  };
  const lessonSlotKey=lesson=>lesson.day+'|'+lessonPeriodNumbers(lesson).join(',');
  function importReviewHtml(label) {
    if(!importCandidate)return '';
    const courseName=(set,id)=>set.courses.find(c=>c.id===id)?.name||id;
    const bySlot=(set,l)=>courseName(set,l.course)+'|'+lessonSlotKey(l);
    const relevantOld=importMode==='ocr'?lessons.filter(l=>l.weeks.includes(ocrWeek)):lessons;
    const current={courses,lessons:relevantOld},oldSlots=new Map(relevantOld.map(l=>[bySlot(current,l),l])),newSlots=new Map(importCandidate.lessons.map(l=>[bySlot(importCandidate,l),l]));
    const oldByPosition=new Map(relevantOld.map(l=>[lessonSlotKey(l),l])),changedIndexes=[];
    let added=0,removed=0,roomChanged=0,weeksChanged=0,courseChanged=0;
    if(importMode==='ocr')importCandidate.lessons.forEach((lesson,index)=>{const old=oldByPosition.get(lessonSlotKey(lesson)),oldName=old?course(old.course)?.name:'' ,newName=courseName(importCandidate,lesson.course);if(!old){added++;changedIndexes.push(index)}else if(oldName!==newName){courseChanged++;changedIndexes.push(index)}else if(lesson.room!=='教室待确认'&&old.room!==lesson.room){roomChanged++;changedIndexes.push(index)}});
    else {for(const [key,l] of newSlots){const old=oldSlots.get(key);if(!old)added++;else{if(old.room!==l.room)roomChanged++;if(JSON.stringify(old.weeks)!==JSON.stringify(l.weeks))weeksChanged++;}}for(const key of oldSlots.keys())if(!newSlots.has(key))removed++;}
    const names=importCandidate.courses.map(c=>esc(c.name)).join('、');
    const untouched=importMode==='ocr'?Math.max(0,relevantOld.length-new Set(importCandidate.lessons.map(lessonSlotKey)).size):0;
    const summary='<div class="xixu-import-summary"><h3>'+esc(label)+'</h3><div><span>新增</span><strong>'+added+'</strong></div><div><span>'+(importMode==='ocr'?'已变化':'已移除')+'</span><strong>'+(importMode==='ocr'?courseChanged:removed)+'</strong></div><div><span>教室变化</span><strong>'+roomChanged+'</strong></div><div><span>'+(importMode==='ocr'?'保持不变':'周次变化')+'</span><strong>'+(importMode==='ocr'?untouched:weeksChanged)+'</strong></div></div><div class="tide-note">找到 '+importCandidate.courses.length+' 门课、'+importCandidate.lessons.length+' 个课块<br>'+names+'</div>';
    const detected=importCandidate.detectedSchedule,detectedOption=detected?'<label class="xixu-schedule-detected"><input id="xixu-apply-detected-schedule" type="checkbox" checked><span><strong>使用识别出的上课时间</strong><small>'+detected.count+' 节 · 第 1 节：'+detected.periods[0].start+'–'+detected.periods[0].end+'</small></span></label>':'';
    if(importMode!=='ocr')return summary+detectedOption+'<button class="tide-primary tide-full" data-action="confirm-timetable">更新课表</button>';
    const reviewIndexes=relevantOld.length?changedIndexes:importCandidate.lessons.map((_,index)=>index);
    const reviewPeriodCount=Math.max(scheduleSettings.count,importCandidate.detectedSchedule?.count||0,...importCandidate.lessons.flatMap(item=>String(item.period||'').match(/\d+/g)?.map(Number)||[]));
    const rows=reviewIndexes.map(index=>{const lesson=importCandidate.lessons[index],c=importCandidate.courses.find(item=>item.id===lesson.course),start=Number(String(lesson.period||'').match(/\d+/)?.[0])||Number(blocks[lesson.block].period.match(/\d+/)?.[0])||1,end=Number(String(lesson.period||'').match(/\d+/g)?.at(-1))||start;return '<fieldset><legend><label><input type="checkbox" name="keep-'+index+'" checked> 应用这项变化</label></legend><label class="tide-field">课程名称<input name="course-'+index+'" value="'+esc(c?.name||'')+'" required maxlength="80"></label><label class="tide-field">教室<input name="room-'+index+'" value="'+esc(!lesson.room||lesson.room==='教室待确认'?'教室待确认':lesson.room)+'" required maxlength="80"></label><div class="tide-form-row"><label class="tide-field">星期<select name="day-'+index+'">'+['周一','周二','周三','周四','周五','周六','周日'].map((dayName,day)=>'<option value="'+day+'" '+(day===lesson.day?'selected':'')+'>'+dayName+'</option>').join('')+'</select></label><label class="tide-field">开始节次<select name="start-'+index+'">'+Array.from({length:reviewPeriodCount},(_,i)=>'<option value="'+(i+1)+'" '+(i+1===start?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></label><label class="tide-field">结束节次<select name="end-'+index+'">'+Array.from({length:reviewPeriodCount},(_,i)=>'<option value="'+(i+1)+'" '+(i+1===end?'selected':'')+'>'+(i+1)+'</option>').join('')+'</select></label></div></fieldset>'}).join('');
    const aiAvailable=Boolean(window.XixuAI?.hasKey?.());
    const aiAction=ocrImageDataUrl?'<button type="button" class="tide-secondary tide-full" data-action="ai-check-timetable" '+(ocrVisionPending?'disabled':'')+'>'+icon(ocrVisionPending?'loader-circle':'scan-search')+(ocrVisionPending?'DeepSeek 正在检查图片…':aiAvailable?'再次使用 DeepSeek 检查':'添加 DeepSeek 密钥后检查')+'</button>':'';
    const editor=rows?'<div class="xixu-ocr-confidence">'+icon('pencil-line')+'<div><strong>发现这些变化</strong><span>可编辑课程、教室、星期或节次。截图以外的课程会保持不变。</span></div></div><form id="xixu-ocr-review-form" class="tide-form">'+rows+'<button class="tide-secondary tide-full" type="submit">应用变化并再次检查</button></form>':'<div class="tide-note">没有发现变化。截图以外的课程会保持不变。</div>';
    return summary+detectedOption+editor+aiAction+(ocrImageDataUrl?'<div class="tide-note">只有点击按钮后才会发送这张课表图片进行检查，DeepSeek API 可能产生少量费用。</div>':'')+'<button class="tide-primary tide-full" data-action="confirm-timetable">更新课表</button>';
  }
  function ocrBounds(lines) {
    const points=lines.flatMap(line=>Array.isArray(line.cornerPoints)?line.cornerPoints:[]).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
    if(!points.length)return null;
    const xs=points.map(point=>point.x),ys=points.map(point=>point.y),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys);
    return {left,right,top,bottom,x:(left+right)/2,y:(top+bottom)/2};
  }
  function parseOcrTimetable(scan,targetWeek) {
    if(!scan||!Number.isFinite(scan.width)||!Number.isFinite(scan.height)||!Array.isArray(scan.blocks))throw Error('识别结果不完整。');
    const width=scan.width,height=scan.height;
    const entries=scan.blocks.map(block=>{
      const lines=Array.isArray(block.lines)?block.lines:[],bounds=ocrBounds(lines);
      return {text:String(block.value||lines.map(line=>line.value||'').join('\n')).trim(),lines,bounds};
    }).filter(entry=>entry.text&&entry.bounds);
    let lineEntries=entries.flatMap(entry=>entry.lines.map(line=>({text:String(line.value||'').trim(),bounds:ocrBounds([line])}))).filter(entry=>entry.text&&entry.bounds);
    if(!lineEntries.length)lineEntries=entries.map(entry=>({text:entry.text,bounds:entry.bounds}));
    const weekdayIndex=value=>{
      const match=value.replace(/\s/g,'').match(/^(?:星期|周)?([一二三四五六日天])(?:\d{1,2}(?:[\/.]\d{1,2})?)?$/);return match?'一二三四五六日天'.indexOf(match[1]):-1;
    };
    const anchors=new Map();
    lineEntries.forEach(entry=>{const index=weekdayIndex(entry.text);if(index>=0&&!anchors.has(Math.min(index,6)))anchors.set(Math.min(index,6),entry.bounds.x)});
    const fallbackDayX=index=>width*(0.125+index*0.132);
    const dayX=index=>anchors.get(index)??fallbackDayX(index);
    const weekdayLines=lineEntries.filter(entry=>weekdayIndex(entry.text)>=0);
    const headerBottom=Math.max(height*.075,...weekdayLines.map(entry=>entry.bounds.bottom));
    const periodEntries=lineEntries.map(entry=>({entry,number:Number(entry.text.replace(/\s/g,''))})).filter(value=>Number.isInteger(value.number)&&value.number>=1&&value.number<=24&&value.entry.bounds.x<width*.13&&value.entry.bounds.y>headerBottom);
    const timeEntries=lineEntries.flatMap(entry=>[...entry.text.replace(/：/g,':').matchAll(/(?:^|\D)([0-2]?\d:[0-5]\d)(?=\D|$)/g)].map(match=>({time:match[1].padStart(5,'0'),bounds:entry.bounds}))).filter(value=>value.bounds.x<width*.18&&value.bounds.y>headerBottom);
    const orderedPeriods=periodEntries.slice().sort((a,b)=>a.entry.bounds.y-b.entry.bounds.y),detectedTimes=[];
    orderedPeriods.forEach((value,index)=>{const previous=orderedPeriods[index-1],next=orderedPeriods[index+1],top=previous?(previous.entry.bounds.y+value.entry.bounds.y)/2:value.entry.bounds.y-height*.018,bottom=next?(value.entry.bounds.y+next.entry.bounds.y)/2:value.entry.bounds.y+height*.07,times=timeEntries.filter(item=>item.bounds.y>=top&&item.bounds.y<bottom).sort((a,b)=>a.bounds.y-b.bounds.y).map(item=>item.time).filter((item,i,list)=>list.indexOf(item)===i);if(times.length>=2&&times[0]<times[1])detectedTimes[value.number]={start:times[0],end:times[1]}});
    const detectedCount=Math.max(0,...periodEntries.map(value=>value.number)),detectedPairs=detectedTimes.filter(Boolean).length,lastPeriodY=Math.max(0,...periodEntries.map(value=>value.entry.bounds.y)),looksComplete=lastPeriodY>height*.58&&detectedPairs>=Math.max(2,Math.ceil(detectedCount*.6));
    const detectedSchedule=looksComplete&&detectedCount?{preset:'custom',count:detectedCount,periods:Array.from({length:detectedCount},(_,index)=>detectedTimes[index+1]||{...periodInfo(index+1)})}:null;
    const nearestDay=x=>Array.from({length:7},(_,index)=>index).reduce((best,index)=>Math.abs(dayX(index)-x)<Math.abs(dayX(best)-x)?index:best,0);
    const nearestPeriod=y=>{
      if(!periodEntries.length)return null;
      return periodEntries.reduce((best,value)=>Math.abs(value.entry.bounds.y-y)<Math.abs(best.entry.bounds.y-y)?value:best,periodEntries[0]).number;
    };
    const nearestBlock=y=>{
      if(periodEntries.length){const nearest=periodEntries.reduce((best,value)=>Math.abs(value.entry.bounds.y-y)<Math.abs(best.entry.bounds.y-y)?value:best,periodEntries[0]);return periodBlockIndex(nearest.number);}
      const ratio=(y-headerBottom)/Math.max(1,height*.82-headerBottom),sequence=[0,1,6,2,3,4,5];return sequence[Math.max(0,Math.min(sequence.length-1,Math.round(ratio*(sequence.length-1))))];
    };
    const recognizedText=(String(scan.value||'')+'\n'+entries.map(entry=>entry.text).join('\n')).replace(/\s+/g,' ');
    const explicitWeek=recognizedText.match(/第\s*(\d{1,2})\s*周/),dateHint=recognizedText.match(/(?:^|\D)(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\D|$)/);
    let detectedWeek=explicitWeek?Number(explicitWeek[1]):0;
    if(!detectedWeek&&dateHint){const year=Number(DEMO_DAY.slice(0,4)),date=year+'-'+String(Number(dateHint[1])).padStart(2,'0')+'-'+String(Number(dateHint[2])).padStart(2,'0'),candidate=teachingWeekOf(date);if(candidate>=1&&candidate<=20)detectedWeek=candidate}
    if(detectedWeek<1||detectedWeek>20)detectedWeek=Math.max(1,Math.min(20,Number(targetWeek)||teachingWeekOf(DEMO_DAY)));
    const ignored=/^(MySZTU|返回本周|返回|首页|课表|我的|功能|周次|导入|设置|成绩查询|考试日程|公选计分|空教室|查看.*校历)$/i;
    const groups=new Map();
    for(const entry of lineEntries){
      const box=entry.bounds,text=entry.text.replace(/\s+/g,'').trim();if(box.bottom<headerBottom||box.top>height*.94||box.x<width*.07||!text)continue;
      if(weekdayIndex(text)>=0||ignored.test(text)||/^\d{1,2}月$/.test(text)||/^\d{1,2}([:.：]\d{2})?$/.test(text)||/^\d{1,2}[\/.]\d{1,2}$/.test(text))continue;
      const day=nearestDay(box.x);if(Math.abs(dayX(day)-box.x)>width*.095)continue;
      const period=nearestPeriod(box.y),block=period?periodBlockIndex(period):nearestBlock(box.y),key=day+'|'+block;
      if(!groups.has(key))groups.set(key,{day,block,parts:[],top:box.top,bottom:box.bottom});
      const group=groups.get(key);group.parts.push({text,bounds:box});group.top=Math.min(group.top,box.top);group.bottom=Math.max(group.bottom,box.bottom);
    }
    const grouped=[...groups.values()].sort((a,b)=>a.day-b.day||a.top-b.top),mergedGroups=[];
    for(const group of grouped){
      const compact=group.parts.slice().sort((a,b)=>a.bounds.top-b.bounds.top).map(item=>item.text).join('');
      const roomOnly=/^[＠@]/.test(compact)||/^(?:[A-Za-z]{1,5}[\-－]?\d+(?:[\-－]\d+){0,3}|\d{3,5}机房)$/.test(compact);
      const previous=mergedGroups.at(-1);
      if(roomOnly&&previous&&previous.day===group.day&&group.top-previous.bottom<height*.22){previous.parts.push(...group.parts);previous.bottom=Math.max(previous.bottom,group.bottom);continue}
      mergedGroups.push(group);
    }
    const found=[];
    for(const group of mergedGroups){
      const parts=group.parts.sort((a,b)=>a.bounds.top-b.bounds.top||a.bounds.left-b.bounds.left).map(item=>item.text);
      let text=parts.join('').replace(/[\r\t]/g,'').trim();
      if(/\[?非本周\]?/.test(text))continue;
      if(!/[\u3400-\u9fffA-Za-z]{2}/.test(text)||ignored.test(text))continue;
      let room='教室待确认',name=text;
      const at=Math.max(text.indexOf('@'),text.indexOf('＠'));
      if(at>=0){room=text.slice(at+1).trim()||room;name=text.slice(0,at).trim();}
      else {const roomMatch=text.match(/((?:[A-Za-z]{1,5}[\-－]?\d+(?:[\-－]\d+){0,3}|[\u3400-\u9fff]{1,6}楼\d{2,6}|\d{3,5}机房)(?:\(多\)|（多）|机房|实验室|阶梯教室)?)/);if(roomMatch){room=roomMatch[1].replace(/－/g,'-');name=text.replace(roomMatch[0],'').trim();}}
      room=room.replace(/^[：:\s]+/,'').replace(/[＊*]+/g,'').trim()||'教室待确认';
      name=name.replace(/^课程[:：]?/,'').replace(/^(?:单周|双周)/,'').replace(/[·•＊*]+$/,'').replace(/\$+$/,'').trim();
      if(name.length<2||name.length>80)continue;
      const firstTextY=Math.min(...group.parts.map(item=>item.bounds.y));
      const startPeriod=nearestPeriod(firstTextY);
      const endPeriod=nearestPeriod(Math.max(firstTextY,group.bottom));
      const sourceName=name,sourceRoom=room;
      name=ocrCorrectionRules['course:'+sourceName]||name;room=ocrCorrectionRules['room:'+sourceRoom]||room;
      let confidence=1;if(room==='教室待确认')confidence-=.35;if(!anchors.size)confidence-=.15;if(!startPeriod)confidence-=.15;if(group.parts.length<2)confidence-=.1;
      const firstBlock=group.block,lastBlock=endPeriod?periodBlockIndex(endPeriod):firstBlock;
      const spans=firstBlock===lastBlock?undefined:Array.from(new Set([firstBlock,lastBlock])).sort((a,b)=>a-b);
      found.push({name,room,sourceName,sourceRoom,confidence:Math.max(.2,confidence),day:group.day,block:firstBlock,spans,end:endPeriod?periodEnd(endPeriod):'',period:startPeriod?(endPeriod&&endPeriod>startPeriod?startPeriod+'–'+endPeriod:String(startPeriod)):''});
    }
    const unique=[];const seen=new Set();
    found.forEach(item=>{const key=item.name+'|'+item.day+'|'+item.block;if(!seen.has(key)){seen.add(key);unique.push(item)}});
    if(!unique.length)throw Error('没有找到课程块，请上传包含星期、节次和课程名称的完整课表截图。');
    const names=[...new Set(unique.map(item=>item.name))],ocrCourses=names.map((name,index)=>({id:'ocr-'+index,name,short:name,mark:name.slice(0,1),image:null,source:'ocr'}));
    const ids=new Map(ocrCourses.map(item=>[item.name,item.id]));
    const ocrLessons=unique.map(item=>({course:ids.get(item.name),day:item.day,block:item.block,spans:item.spans,end:item.end,room:item.room,weeks:[detectedWeek],rule:'第 '+detectedWeek+' 周 · 图片识别',period:item.period||blocks[item.block].period,confidence:item.confidence,sourceName:item.sourceName,sourceRoom:item.sourceRoom}));
    return {format:'xixu-timetable',schemaVersion:DATA_SCHEMA_VERSION,termStart:TERM_MONDAY,courses:ocrCourses,lessons:ocrLessons,ocrWeek:detectedWeek,weekDetected:Boolean(explicitWeek||dateHint),detectedSchedule};
  }
  const expandNumberExpression=(source,max)=>{
    const values=new Set();
    String(source||'').replace(/[，、]/g,',').replace(/[–—至]/g,'-').split(',').forEach(part=>{
      const sequence=part.split('-').map(Number);if(sequence.length>2&&sequence.every(value=>Number.isInteger(value))){sequence.forEach(value=>{if(value>=1&&value<=max)values.add(value)});return}
      const match=part.match(/^(\d{1,2})(?:-(\d{1,2}))?$/);if(!match)return;
      const from=Number(match[1]),to=Number(match[2]||match[1]);
      for(let value=Math.min(from,to);value<=Math.max(from,to);value++)if(value>=1&&value<=max)values.add(value);
    });
    return [...values].sort((a,b)=>a-b);
  };
  const timetableRule=line=>{
    const compact=String(line||'').replace(/\s/g,'');
    const match=compact.match(/([0-9,，、\-–—至]+)(?:\(\[周\]\)|\(周\)|\[周\]|周).*?\[([0-9,，、\-–—至]+)节\]/);
    if(!match)return null;
    const weeks=expandNumberExpression(match[1],20),periods=expandNumberExpression(match[2],20);
    return weeks.length&&periods.length?{weeks,periods}:null;
  };
  const periodBlockIndex=period=>({1:0,2:0,3:1,4:1,5:6,6:2,7:2,8:3,9:3,10:3,11:4,12:4,13:5,14:5})[period]??Math.max(0,Math.min(5,Math.floor((Number(period)-1)/2)));
  const periodEnd=period=>{const value=String(periodInfo(period).end||'');return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)?value:''};
  const compactRange=values=>{
    if(!values.length)return '';
    return values.every((value,index)=>!index||value===values[index-1]+1)&&values.length>1?values[0]+'–'+values.at(-1):values.join('、');
  };
  function parseSpreadsheetTimetable(buffer){
    if(!globalThis.XLSX?.read)throw Error('表格读取功能暂不可用，请关闭并重新打开汐序后再试。');
    let workbook;
    try{workbook=globalThis.XLSX.read(buffer,{type:'array',cellDates:false,cellText:true})}
    catch(_){throw Error('表格读取失败，请从学校系统重新导出后再试。');}
    const sheet=workbook.Sheets[workbook.SheetNames[0]];
    if(!sheet)throw Error('表格中没有找到课表工作表。');
    const rows=globalThis.XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
    const parsed=[],courseNames=new Set(),seen=new Set(),allCells=rows.flat().map(value=>String(value||''));
    const dayFrom=value=>{const text=String(value||'').trim().toLowerCase(),chinese=text.match(/(?:星期|周)?([一二三四五六日天])$/);if(chinese)return Math.min('一二三四五六日天'.indexOf(chinese[1]),6);const english=['mon','tue','wed','thu','fri','sat','sun'].findIndex(day=>text.startsWith(day));if(english>=0)return english;const number=Number(text.replace(/\D/g,''));return number>=1&&number<=7?number-1:-1};
    const pushSpreadsheetLesson=(name,day,weeks,periods,room)=>{
      name=String(name||'').trim();room=String(room||'教室待确认').trim()||'教室待确认';if(!name||name.length>80||day<0||!weeks.length||!periods.length)return;
      const blocksUsed=[...new Set(periods.map(periodBlockIndex).filter(Number.isInteger))];if(!blocksUsed.length)return;
      const key=[name,day,weeks.join(','),periods.join(','),room].join('|');if(seen.has(key))return;seen.add(key);courseNames.add(name);
      parsed.push({name,day,block:blocksUsed[0],spans:blocksUsed.length>1?blocksUsed:undefined,end:periodEnd(periods.at(-1)),period:compactRange(periods),room,weeks,rule:'第 '+compactRange(weeks)+' 周'});
    };
    const headerText=value=>String(value||'').trim().toLowerCase().replace(/\s/g,'');
    const aliases={name:/课程名称|课程名|科目|subject|course/,day:/星期|周几|上课日|weekday|day/,period:/节次|课节|上课节次|period|section/,weeks:/周次|教学周|上课周|weeks?/,room:/教室|地点|上课地点|room|location/};
    const longHeaderIndex=rows.findIndex(row=>Array.isArray(row)&&Object.values(aliases).slice(0,4).every(pattern=>row.some(cell=>pattern.test(headerText(cell)))));
    if(longHeaderIndex>=0){
      const header=rows[longHeaderIndex].map(headerText),column=pattern=>header.findIndex(value=>pattern.test(value)),nameCol=column(aliases.name),dayCol=column(aliases.day),periodCol=column(aliases.period),weeksCol=column(aliases.weeks),roomCol=column(aliases.room);
      rows.slice(longHeaderIndex+1).forEach(row=>{if(!Array.isArray(row))return;const day=dayFrom(row[dayCol]),weekText=String(row[weeksCol]||''),weekNumbers=weekText.match(/[0-9,，、\-–—至]+/)?.[0]||'',periodNumbers=String(row[periodCol]||'').match(/[0-9,，、\-–—至]+/)?.[0]||'';let weeks=expandNumberExpression(weekNumbers,20);if(/单/.test(weekText))weeks=weeks.filter(value=>value%2===1);if(/双/.test(weekText))weeks=weeks.filter(value=>value%2===0);const periods=expandNumberExpression(periodNumbers,20);pushSpreadsheetLesson(row[nameCol],day,weeks,periods,roomCol>=0?row[roomCol]:'教室待确认')});
    }
    const matrixDay=value=>dayFrom(String(value||'').replace(/^星期|^周/,'').trim());
    const headerIndex=rows.findIndex(row=>Array.isArray(row)&&row.filter(cell=>matrixDay(cell)>=0).length>=2);
    const columns=new Map();
    if(headerIndex>=0)rows[headerIndex].forEach((cell,index)=>{const value=matrixDay(cell);if(value>=0)columns.set(index,value)});
    for(let rowIndex=headerIndex+1;headerIndex>=0&&rowIndex<rows.length;rowIndex++){
      const row=rows[rowIndex];if(!Array.isArray(row))continue;
      for(const [column,day] of columns){
        const raw=String(row[column]||'').trim();if(!raw)continue;
        raw.split(/\n\s*\n+/).map(value=>value.trim()).filter(Boolean).forEach(record=>{
          const lines=record.split(/\n+/).map(value=>value.trim()).filter(Boolean),ruleIndex=lines.findIndex(line=>timetableRule(line));
          if(ruleIndex<1)return;
          const rule=timetableRule(lines[ruleIndex]);if(!rule)return;
          const name=lines.slice(0,ruleIndex).find(line=>!/^[（(].+[）)]$/.test(line)&&!/^(线上|线下)/.test(line));
          if(!name||name.length>80)return;
          const room=String(lines.slice(ruleIndex+1).find(Boolean)||'教室待确认').replace(/（(机房|实验室|阶梯教室)）|\((机房|实验室|阶梯教室)\)/g,(_,a,b)=>' '+(a||b)).replace(/\s+/g,' ').trim();
          pushSpreadsheetLesson(name,day,rule.weeks,rule.periods,room);
        });
      }
    }
    if(!parsed.length)throw Error('没有找到课程、周次或节次，请选择完整的学生课表。');
    const merged=new Map();
    parsed.forEach(item=>{
      const key=[item.name,item.day,item.period,item.room].join('|'),existing=merged.get(key);
      if(!existing){merged.set(key,{...item});return}
      existing.weeks=[...new Set([...existing.weeks,...item.weeks])].sort((a,b)=>a-b);existing.rule='第 '+compactRange(existing.weeks)+' 周';
    });
    const spreadsheetCourses=[...courseNames].map((name,index)=>({id:'sheet-'+index,name,short:name,mark:name.slice(0,1),image:null,source:'spreadsheet'})),ids=new Map(spreadsheetCourses.map(item=>[item.name,item.id]));
    const spreadsheetLessons=[...merged.values()].map(item=>{const {name,...lesson}=item;return {...lesson,course:ids.get(name)}});
    const highest=Math.max(0,...spreadsheetLessons.flatMap(lesson=>String(lesson.period||'').match(/\d+/g)?.map(Number)||[])),timePairs=[];
    allCells.forEach(text=>{for(const match of text.replace(/：/g,':').matchAll(/([0-2]?\d:[0-5]\d)\s*[-–—至~～]\s*([0-2]?\d:[0-5]\d)/g)){const start=match[1].padStart(5,'0'),end=match[2].padStart(5,'0');if(start<end&&!timePairs.some(item=>item.start===start&&item.end===end))timePairs.push({start,end})}});
    const detectedSchedule=highest?{preset:'custom',count:highest,periods:Array.from({length:highest},(_,index)=>timePairs[index]||{...periodInfo(index+1)})}:null;
    return {format:'xixu-timetable',schemaVersion:DATA_SCHEMA_VERSION,termStart:TERM_MONDAY,courses:spreadsheetCourses,lessons:spreadsheetLessons,detectedSchedule};
  }
  const pdfOcrWaiters=new Map();
  window.XixuReceivePdfOCR=(ok,body,pageNumber)=>{
    const key=Number(pageNumber),waiter=pdfOcrWaiters.get(key);if(!waiter)return;
    pdfOcrWaiters.delete(key);clearTimeout(waiter.timer);
    if(!ok){waiter.reject(Error(body||('第 '+key+' 页无法识别。')));return}
    try{waiter.resolve(JSON.parse(body))}catch(_){waiter.reject(Error('第 '+key+' 页的识别结果无法读取。'))}
  };
  function recognizePdfPage(bridge,dataUrl,pageNumber){
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pdfOcrWaiters.delete(pageNumber);reject(Error('第 '+pageNumber+' 页识别超时，请重试。'))},65000);
      pdfOcrWaiters.set(pageNumber,{resolve,reject,timer});
      try{Promise.resolve(bridge.recognizeDocumentPage(dataUrl,String(pageNumber))).then(started=>{if(started)return;clearTimeout(timer);pdfOcrWaiters.delete(pageNumber);reject(Error('第 '+pageNumber+' 页未送入识别服务。'))}).catch(error=>{clearTimeout(timer);pdfOcrWaiters.delete(pageNumber);reject(error)})}
      catch(error){clearTimeout(timer);pdfOcrWaiters.delete(pageNumber);reject(error)}
    })
  }
  function pdfWeeks(value){
    const result=new Set(),source=String(value||'').replace(/[，、]/g,',').replace(/[–—至]/g,'-');
    for(const match of source.matchAll(/(\d{1,2})(?:\s*-\s*(\d{1,2}))?\s*周?(?:\s*[（(]\s*(单|双)\s*[）)])?/g)){
      const from=Number(match[1]),to=Number(match[2]||match[1]),parity=match[3];
      for(let week=Math.min(from,to);week<=Math.max(from,to);week++)if(week>=1&&week<=20&&(!parity||(parity==='单'?week%2===1:week%2===0)))result.add(week);
    }
    return [...result].sort((a,b)=>a-b);
  }
  const pdfDayIndex=value=>{
    const text=String(value||'').replace(/\s/g,'').toLowerCase(),match=text.match(/^(?:星期|周)([一二三四五六日天])$/);
    if(match)return Math.min('一二三四五六日天'.indexOf(match[1]),6);
    return ['mon','tue','wed','thu','fri','sat','sun'].findIndex(day=>text.startsWith(day));
  };
  const pdfScanEntries=scan=>(Array.isArray(scan?.blocks)?scan.blocks:[]).flatMap(block=>{
    const lines=Array.isArray(block?.lines)&&block.lines.length?block.lines:[{value:block?.value||'',cornerPoints:block?.cornerPoints||[]}];
    return lines.flatMap(line=>String(line?.value||'').split(/\r?\n/).map(text=>({text:text.trim(),bounds:ocrBounds([line])}))).filter(item=>item.text&&item.bounds);
  });
  // PDF.js and native OCR split the same printed row differently. Reassemble
  // fragments only inside one weekday column, never across neighbouring cells.
  function pdfColumnLines(items){
    const rows=[];
    for(const item of [...items].sort((a,b)=>a.bounds.y-b.bounds.y||a.bounds.left-b.bounds.left)){
      const h=item.bounds.bottom-item.bounds.top;
      const row=rows.find(row=>Math.abs(row.y-item.bounds.y)<=Math.min(row.h,h)*.45);
      if(row){row.items.push(item);row.h=Math.min(row.h,h)}else rows.push({y:item.bounds.y,h,items:[item]});
    }
    const lines=rows.map(row=>row.items.sort((a,b)=>a.bounds.left-b.bounds.left).map(item=>item.text).join('').normalize('NFKC').replace(/[–—−至]/g,'-').trim());
    // A period marker itself may wrap onto the next printed line.
    return lines.join('\n').replace(/\(\s*(\d{1,2})\s*(?:-\s*(\d{1,2})\s*)?节\s*\)/g,(_,a,b)=>'('+a+(b?'-'+b:'')+'节)').split('\n').filter(Boolean);
  }
  function pdfColumnRatios(scans){
    const found=new Map();
    for(const scan of scans)for(const item of pdfScanEntries(scan)){const day=pdfDayIndex(item.text);if(day>=0&&!found.has(day))found.set(day,item.bounds.x/(Number(scan?.width)||1))}
    const points=[...found].sort((a,b)=>a[0]-b[0]),steps=[];
    for(let index=1;index<points.length;index++){const distance=(points[index][1]-points[index-1][1])/(points[index][0]-points[index-1][0]);if(distance>.05&&distance<.2)steps.push(distance)}
    const step=steps.length?steps.sort((a,b)=>a-b)[Math.floor(steps.length/2)]:.123,starts=points.map(([day,ratio])=>ratio-day*step),start=starts.length?starts.reduce((sum,value)=>sum+value,0)/starts.length:.18;
    return day=>found.get(day)??start+day*step;
  }
  const pdfCourseTitleLine=value=>{
    const text=String(value||'').replace(/\s+/g,'').trim();
    return text.length>=2&&text.length<=80&&!/[\/:：]/.test(text)&&!/^(?:上午|下午|晚上|时间段|节次|星期[一二三四五六日天]|周[一二三四五六日天]|\d+)$/.test(text)&&!/(?:课表|学号|学期|周学时|总学时|学分|课程学时|教学班|教师|校区|场地|教室)/.test(text);
  };
  function parsePdfTimetable(scans){
    const parsed=[],courseNames=new Set(),seen=new Set();
    const push=(name,day,start,end,weeks,room)=>{
      name=String(name||'').replace(/^[\d\s]+(?=[\u3400-\u9fffA-Za-z])/,'').replace(/\s+/g,'').replace(/[＊*＄$＆&]+$/,'').trim();
      room=String(room||'教室待确认').replace(/\s+/g,'').replace(/－/g,'-').replace(/[＊*]+$/,'').trim()||'教室待确认';
      if(name.length<2||name.length>80||looksLikeClassroomName(name)||day<0||day>6||start<1||end<start||end>24||!weeks.length)return;
      const key=[name,day,start,end,weeks.join(','),room].join('|');if(seen.has(key))return;seen.add(key);courseNames.add(name);
      const used=[...new Set(Array.from({length:end-start+1},(_,index)=>periodBlockIndex(start+index)).filter(Number.isInteger))],block=periodBlockIndex(start);if(!Number.isInteger(block))return;
      parsed.push({name,day,block,spans:used.length>1?used:undefined,end:periodEnd(end),period:start===end?String(start):start+'–'+end,room,weeks,rule:'第 '+compactRange(weeks)+' 周 · PDF 导入'});
    };
    const columnRatio=pdfColumnRatios(scans);
    for(const scan of scans){
      const width=Number(scan?.width)||1,entries=pdfScanEntries(scan),dayX=index=>width*columnRatio(index);
      const columns=Array.from({length:7},()=>[]);
      entries.forEach(item=>{if(item.bounds.x<width*.105)return;const day=Array.from({length:7},(_,index)=>index).reduce((best,index)=>Math.abs(dayX(index)-item.bounds.x)<Math.abs(dayX(best)-item.bounds.x)?index:best,0);if(Math.abs(dayX(day)-item.bounds.x)<=width*.078&&pdfDayIndex(item.text)<0)columns[day].push(item)});
      columns.forEach((items,day)=>{
        const lines=pdfColumnLines(items),markers=[];
        lines.forEach((text,index)=>{const match=text.match(/^(.*?)\(\s*(\d{1,2})(?:\s*[-–—至]\s*(\d{1,2}))?\s*节\s*\)\s*(.*)$/);if(match)markers.push({index,match})});
        markers.forEach((marker,index)=>{
          const title=[];if(marker.match[1].trim())title.push(marker.match[1].trim());
          for(let cursor=marker.index-1;cursor>=0&&title.length<3&&pdfCourseTitleLine(lines[cursor]);cursor--)title.unshift(lines[cursor]);
          const body=[marker.match[4],...lines.slice(marker.index+1,markers[index+1]?.index??lines.length)].join('').replace(/\s+/g,''),weeksText=body.split(/\/(?:校区|場区|场区)[:：]?/)[0],weeks=pdfWeeks(weeksText),room=body.match(/\/(?:场地|場地|地点|教室)[:：]?\s*([^/]+?)(?=\/(?:教师|教師|教学班|教學班)[:：]|$)/)?.[1];
          push(title.join(''),day,Number(marker.match[2]),Number(marker.match[3]||marker.match[2]),weeks,room);
        });
      });
    }
    if(!parsed.length)throw Error('PDF 中没有找到完整的课程、节次、周次或教室信息，请确认它来自学校系统的课表导出。');
    const merged=new Map();parsed.forEach(item=>{const key=[item.name,item.day,item.period,item.room].join('|'),existing=merged.get(key);if(!existing){merged.set(key,{...item});return}existing.weeks=[...new Set([...existing.weeks,...item.weeks])].sort((a,b)=>a-b);existing.rule='第 '+compactRange(existing.weeks)+' 周 · PDF 导入'});
    const pdfCourses=[...courseNames].map((name,index)=>({id:'pdf-'+index,name,short:name,mark:name.slice(0,1),image:null,source:'pdf'})),ids=new Map(pdfCourses.map(item=>[item.name,item.id]));
    const pdfLessons=[...merged.values()].map(item=>{const {name,...lesson}=item;return {...lesson,course:ids.get(name)}}),highestLesson=Math.max(0,...pdfLessons.flatMap(lesson=>String(lesson.period||'').match(/\d+/g)?.map(Number)||[])),highestLabel=Math.max(0,...scans.flatMap(scan=>pdfScanEntries(scan).filter(item=>item.bounds.x<(Number(scan?.width)||1)*.16).map(item=>Number(item.text.replace(/\s/g,''))).filter(value=>Number.isInteger(value)&&value>=1&&value<=24))),highest=Math.max(highestLesson,highestLabel);
    const scheduleScans=scans.map(scan=>({width:Number(scan?.width)||1,entries:pdfScanEntries(scan)})),detectedTimes=[];
    for(const scan of scheduleScans){const periods=scan.entries.map(item=>({number:Number(item.text.replace(/\s/g,'')),y:item.bounds.y,x:item.bounds.x})).filter(item=>Number.isInteger(item.number)&&item.number>=1&&item.number<=24&&item.x<scan.width*.16).sort((a,b)=>a.y-b.y),times=scan.entries.flatMap(item=>[...item.text.replace(/：/g,':').matchAll(/([0-2]?\d:[0-5]\d)/g)].map(match=>({time:match[1].padStart(5,'0'),y:item.bounds.y,x:item.bounds.x}))).filter(item=>item.x<scan.width*.2);periods.forEach((item,index)=>{const before=index?(periods[index-1].y+item.y)/2:item.y-30,after=index+1<periods.length?(item.y+periods[index+1].y)/2:item.y+60,row=times.filter(time=>time.y>=before&&time.y<after).sort((a,b)=>a.y-b.y).map(value=>value.time);if(row.length>=2&&row[0]<row[1])detectedTimes[item.number]={start:row[0],end:row[1]}})}
    const detectedSchedule=highest?{preset:'custom',count:highest,periods:Array.from({length:highest},(_,index)=>detectedTimes[index+1]||{...periodInfo(index+1)})}:null;
    return {format:'xixu-timetable',schemaVersion:DATA_SCHEMA_VERSION,termStart:TERM_MONDAY,courses:pdfCourses,lessons:pdfLessons,detectedSchedule};
  }
  async function pdfTextScan(page){
    const viewport=page.getViewport({scale:1}),content=await page.getTextContent(),blocks=[];
    for(const item of content.items||[]){
      const value=String(item?.str||'').trim();if(!value||!Array.isArray(item.transform))continue;
      const transform=globalThis.pdfjsLib.Util.transform(viewport.transform,item.transform),height=Math.max(2,Math.hypot(transform[2],transform[3])||Number(item.height)||8),width=Math.max(2,Math.abs(Number(item.width)||0)*viewport.scale),left=transform[4],bottom=transform[5],top=bottom-height,right=left+width;
      blocks.push({value,lines:[{value,cornerPoints:[{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}]}]});
    }
    return {width:viewport.width,height:viewport.height,value:blocks.map(block=>block.value).join('\n'),blocks};
  }
  function decodePdfChunk(value){
    let binary='';try{binary=atob(String(value||''))}catch(_){throw Error('PDF 读取失败：手机返回的文件数据已损坏。');}
    const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);return bytes;
  }
  async function readPdfFileBytes(file){
    const bridge=window.XixuFile;
    if(!bridge?.begin||!bridge?.readChunk||!bridge?.finish){
      let bytes;try{bytes=new Uint8Array(await file.arrayBuffer())}catch(_){throw Error('PDF 读取失败：无法读取所选文件。');}
      if(!bytes.length||(file.size>0&&bytes.length!==file.size))throw Error('PDF 读取失败：文件不完整，请重新选择。');
      return bytes;
    }
    try{
      let metadata;try{metadata=JSON.parse(String(await Promise.resolve(bridge.begin(0))))}catch(_){throw Error('PDF 读取失败：手机无法打开所选文件。');}
      const expected=Number(metadata?.size);if(!Number.isInteger(expected)||expected<1||expected>20*1024*1024)throw Error('PDF 读取失败：文件大小无效或超过 20 MB。');
      const bytes=new Uint8Array(expected);let offset=0;
      while(offset<expected){
        const encoded=String(await Promise.resolve(bridge.readChunk(Math.min(256*1024,expected-offset)))||'');
        if(!encoded)throw Error('PDF 读取失败：文件在 '+offset+' / '+expected+' 字节处提前结束。');
        const chunk=decodePdfChunk(encoded);if(!chunk.length||offset+chunk.length>expected)throw Error('PDF 读取失败：手机返回了异常的文件长度。');bytes.set(chunk,offset);offset+=chunk.length;
      }
      if(String(await Promise.resolve(bridge.readChunk(1))||''))throw Error('PDF 读取失败：文件在读取过程中发生变化。');
      return bytes;
    }catch(error){
      const message=String(error?.message||error||'');if(message.startsWith('PDF 读取失败：'))throw error;throw Error('PDF 读取失败：无法从手机读取所选文件。');
    }finally{try{await Promise.resolve(bridge.finish())}catch(_){}}
  }
  function validatePdfBytes(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<8)throw Error('PDF 校验失败：文件为空或不完整。');
    let header='';for(let index=0;index<Math.min(1024,bytes.length);index++)header+=String.fromCharCode(bytes[index]);
    if(!header.includes('%PDF-'))throw Error('PDF 校验失败：所选文件不是有效 PDF。');
  }
  async function parsePdfTimetableBytes(bytes,box){
    if(!globalThis.pdfjsLib?.getDocument)throw Error('PDF 读取功能暂不可用，请关闭并重新打开汐序后再试。');
    validatePdfBytes(bytes);
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc='pdf.worker.min.js';
    let pdfDocument;
    class BundledCMapReader {
      async fetch({name}){
        const encoded=globalThis.XixuPdfCMaps?.[name];
        if(!encoded){const error=Error('缺少 PDF 字符映射：'+name);error.code='XIXU_PDF_CMAP_MISSING';throw error;}
        return {cMapData:decodePdfChunk(encoded),compressionType:1};
      }
    }
    const cmapOptions=globalThis.XixuPdfCMaps?{CMapReaderFactory:BundledCMapReader,useWorkerFetch:false}:{};
    try{pdfDocument=await globalThis.pdfjsLib.getDocument({data:bytes,cMapUrl:'cmaps/',cMapPacked:true,...cmapOptions}).promise}catch(_){throw Error('无法打开 PDF，文件可能损坏、受密码保护或不完整。');}
    try{
      if(pdfDocument.numPages<1||pdfDocument.numPages>12)throw Error('PDF 校验失败：文档页数必须在 1–12 页之间。');
      const textScans=[];let textLayerFailed=false;
      for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber++){
        box.innerHTML='<div class="xixu-ocr-progress">'+icon('scan-text')+'<div><strong>正在读取 PDF 第 '+pageNumber+' / '+pdfDocument.numPages+' 页</strong><span>查找课程、星期、节次、周次和教室</span></div></div>';icons();
        let page;try{page=await pdfDocument.getPage(pageNumber);textScans.push(await pdfTextScan(page))}catch(_){textLayerFailed=true;textScans.push({width:1,height:1,value:'',blocks:[]})}finally{page?.cleanup()}
      }
      // Let the geometry-aware parser join split text before judging whether
      // the text layer is usable (including PDFs with just one lesson).
      try{return parsePdfTimetable(textScans)}catch(_){}
      const bridge=await waitForNativeBridge('XixuOCR');
      if(!bridge?.recognizeDocumentPage)throw Error((textLayerFailed?'PDF 文本提取失败':'PDF 文本层中没有课表内容')+'。此版本没有本地 OCR，请安装最新内测版。');
      const scans=[];
      for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber++){
        box.innerHTML='<div class="xixu-ocr-progress">'+icon('scan-text')+'<div><strong>正在识别 PDF 第 '+pageNumber+' / '+pdfDocument.numPages+' 页</strong><span>读取课程、星期、节次、周次和教室</span></div></div>';icons();
        let page,canvas;try{
          page=await pdfDocument.getPage(pageNumber);const base=page.getViewport({scale:1}),scale=Math.min(3,2400/Math.max(base.width,base.height)),viewport=page.getViewport({scale});canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
          const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('无法生成 PDF 页面预览。');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:context,viewport}).promise;
          scans.push(await recognizePdfPage(bridge,canvas.toDataURL('image/jpeg',.94),pageNumber));
        }catch(error){throw Error('PDF OCR 识别失败：'+String(error?.message||error))}finally{page?.cleanup();if(canvas){canvas.width=1;canvas.height=1}}
      }
      try{return parsePdfTimetable(scans)}catch(error){
        const lines=scans.reduce((count,scan)=>count+pdfScanEntries(scan).length,0);
        throw Error('读取 '+pdfDocument.numPages+' 页、'+lines+' 行文字后仍无法匹配课表格式。请保留原 PDF 并反馈，或先使用表格导入。');
      }
    }finally{await pdfDocument.destroy()}
  }
  async function waitForNativeBridge(name){
    for(let attempt=0;attempt<50;attempt++){if(window[name])return window[name];await new Promise(resolve=>setTimeout(resolve,100))}
    return null;
  }
  window.XixuReceiveOCR=(ok,body)=>{
    ocrPending=false;
    const box=main.querySelector('#xixu-ocr-review');
    try{
      if(!ok)throw Error(body||'无法识别课表。');
      importMode='ocr';const parsed=parseOcrTimetable(JSON.parse(body),teachingWeekOf(DEMO_DAY));ocrWeek=parsed.ocrWeek;importCandidate=checkData(parsed,true);importCandidate.ocrWeek=ocrWeek;importCandidate.weekDetected=parsed.weekDetected;
      if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · '+(parsed.weekDetected?'已识别周次':'按今天估算周次')+' · 更新前请检查');
      notify('课表图片已识别，请检查后再更新。');
    }catch(error){importCandidate=null;if(box)box.textContent='无法识别：'+error.message;notify('课表图片无法识别。');}
  };
  function timetableVisionPayload(dataUrl){
    const schema='{"week":3,"lessons":[{"courseName":"课程完整名称","room":"教室或待确认","weekday":0,"startPeriod":1,"endPeriod":2}]}';
    const instruction='读取这张大学课表截图，只输出合法 JSON，不解释。必须逐列逐行读取所有当前周有课的彩色课程块；灰色且标有“非本周”的课程不要加入。星期一为 weekday 0，星期日为 6。startPeriod/endPeriod 使用图片左侧的真实节次，不预设学校或总节数。课程名必须把换行拆开的文字合并完整，教室必须与课程分开；看不清教室时写“教室待确认”，不要猜。JSON 格式：'+schema;
    return JSON.stringify({model:'deepseek-flash',messages:[{role:'system',content:'你是严格的大学课表结构化识别器，只返回 JSON。'},{role:'user',content:[{type:'text',text:instruction},{type:'image_url',image_url:{url:dataUrl,detail:'original'}}]}],response_format:{type:'json_object'},thinking:{type:'disabled'},temperature:0,max_tokens:3000,stream:false});
  }
  function visionCandidate(value){
    const rawLessons=Array.isArray(value?.lessons)?value.lessons:[],recognized=[],names=new Set();
    for(const item of rawLessons){
      const name=String(item?.courseName||'').replace(/\s+/g,'').trim(),room=String(item?.room||'教室待确认').trim()||'教室待确认',day=Number(item?.weekday),start=Number(item?.startPeriod),end=Math.max(start,Number(item?.endPeriod)||start);
      if(name.length<2||name.length>80||!Number.isInteger(day)||day<0||day>6||!Number.isInteger(start)||start<1||start>24||end>24)continue;
      const block=periodBlockIndex(start);if(!Number.isInteger(block))continue;
      const used=[...new Set(Array.from({length:end-start+1},(_,index)=>periodBlockIndex(start+index)).filter(Number.isInteger))];
      names.add(name);recognized.push({name,room,day,block,spans:used.length>1?used:undefined,end:periodEnd(end),period:start===end?String(start):start+'–'+end,confidence:.9,sourceName:name,sourceRoom:room});
    }
    if(!recognized.length)throw Error('DeepSeek 没有找到可用课程。');
    const detected=Number(value?.week),target=Number.isInteger(detected)&&detected>=1&&detected<=20?detected:ocrWeek;
    const visionCourses=[...names].map((name,index)=>({id:'vision-'+index,name,short:name,mark:name.slice(0,1),image:null,source:'ocr'})),ids=new Map(visionCourses.map(item=>[item.name,item.id]));
    const visionLessons=recognized.map(item=>{const {name,...lesson}=item;return {...lesson,course:ids.get(name),weeks:[target],rule:'第 '+target+' 周 · AI 图片校对'}});
    return {format:'xixu-timetable',schemaVersion:DATA_SCHEMA_VERSION,termStart:TERM_MONDAY,courses:visionCourses,lessons:visionLessons,ocrWeek:target,weekDetected:Number.isInteger(detected)};
  }
  window.XixuReceiveTimetableAI=(ok,status,body)=>{
    ocrVisionPending=false;const box=main.querySelector('#xixu-ocr-review');
    try{
      if(!ok){let message=body;try{message=JSON.parse(body).error?.message||body}catch(_){}throw Error(status===401?'API 密钥无效或额度不足。':message)}
      const response=JSON.parse(body),content=response.choices?.[0]?.message?.content;if(!content)throw Error('DeepSeek 没有返回结果。');
      const detectedSchedule=importCandidate?.detectedSchedule||null,parsed=visionCandidate(JSON.parse(content.replace(/^```json\s*|\s*```$/g,'')));parsed.detectedSchedule=detectedSchedule;ocrWeek=parsed.ocrWeek;importMode='ocr';importCandidate=checkData(parsed,true);importCandidate.ocrWeek=ocrWeek;importCandidate.weekDetected=parsed.weekDetected;
      if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · DeepSeek 图片检查完成');icons();notify('AI 检查完成，请逐项确认后保存。');
    }catch(error){if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · 保留本机识别结果');icons();notify('AI 检查失败：'+String(error?.message||error));}
  };
  root.addEventListener('change',async event=>{
    if(event.target.id!=='xixu-ocr-image')return;
    const file=event.target.files?.[0],box=main.querySelector('#xixu-ocr-review');if(!file||!box)return;
    importCandidate=null;importMode='ocr';ocrWeek=Math.max(1,Math.min(20,teachingWeekOf(DEMO_DAY)));
    if(!file.type.startsWith('image/')&&!/\.(png|jpe?g|webp|heic)$/i.test(file.name)){box.textContent='请选择课表截图或照片。';return;}
    if(file.size>18*1024*1024){box.textContent='图片大小不能超过 18 MB。';return;}
    const bridge=await waitForNativeBridge('XixuOCR');
    if(!bridge){box.textContent='此版本暂不支持本地识别，请安装最新内测版后彻底关闭并重新打开汐序。';return;}
    ocrPending=true;box.innerHTML='<div class="xixu-ocr-progress">'+icon('scan-text')+'<div><strong>正在读取第 '+ocrWeek+' 周课表</strong><span>识别课程、星期、节次、教室和周次变化</span></div></div>';icons();
    const reader=new FileReader();
    reader.onerror=()=>{ocrPending=false;box.textContent='图片读取失败，请重新选择。'};
    reader.onload=async()=>{const localImage=String(reader.result||'');ocrImageDataUrl=await compactStoredImage(localImage);try{const started=await Promise.resolve(bridge.recognize(ocrImageDataUrl));if(!started){ocrPending=false;box.textContent='图片未送入识别服务，请换一张截图。'}}catch(_){ocrPending=false;box.textContent='识别服务已断开，请彻底关闭并重新打开汐序。'}};
    reader.readAsDataURL(file);
  });
  root.addEventListener('change',async event=>{
    if(event.target.id!=='xixu-import')return;
    importCandidate=null;
    const box=main.querySelector('#xixu-import-review');
    try{
      const file=event.target.files?.[0];if(!file)return;
      const name=main.querySelector('#xixu-file-name');if(name)name.textContent=file.name;
      if(file.size>20*1024*1024)throw Error('课表文件大小不能超过 20 MB。');
      const extension=file.name.toLowerCase().split('.').at(-1);
      box.innerHTML='<div class="xixu-ocr-progress">'+icon('file-spreadsheet')+'<div><strong>正在读取课表</strong><span>解析课程、星期、节次、周次和教室</span></div></div>';icons();
      const source=extension==='json'?JSON.parse(await file.text()):['xls','xlsx'].includes(extension)?parseSpreadsheetTimetable(await file.arrayBuffer()):extension==='pdf'?await parsePdfTimetableBytes(await readPdfFileBytes(file),box):(()=>{throw Error('请选择 PDF、.xls、.xlsx 或汐序 .json 文件。');})();
      importMode='file';importCandidate=checkData(source,true);
      box.innerHTML=importReviewHtml(extension==='json'?'更新前请检查':extension==='pdf'?'PDF 已识别 · 更新前请检查':'课表已读取 · 更新前请检查');
    }catch(error){box.textContent='无法导入：'+String(error?.message||'文件读取失败。');importCandidate=null;}
  });
  root.addEventListener('change',async event=>{
    if(event.target.id!=='xixu-backup-import')return;
    try{
      const file=event.target.files?.[0];if(!file)return;if(file.size>24*1024*1024)throw Error('备份文件大小不能超过 24 MB。');
      const data=checkData(JSON.parse(await file.text()),false);
      // An index-only backup cannot silently restore missing external originals.
      if(typeof verifyNoteArchiveSources==='function')await verifyNoteArchiveSources(data.notes);
      courses.splice(0,courses.length,...data.courses);lessons.splice(0,lessons.length,...data.lessons);tasks=data.tasks;notes=data.notes;scratchEntries=data.scratchEntries;ocrCorrectionRules=data.ocrCorrectionRules;agentHistory=data.agentHistory;agentPreferences=data.agentPreferences;scheduleSettings=data.scheduleSettings;TERM_MONDAY=data.termStart;storageBlocked=false;lastSaved='';
      page='today';panel=null;previousPanel=null;render();notify('备份已恢复：课表、事项、碎片和备忘录都回来了。');
    }catch(error){notify('无法恢复备份：'+error.message)}
  });
  root.addEventListener('click',event=>{
    const aiButton=event.target.closest('[data-action="ai-check-timetable"]');
    if(aiButton){
      if(!window.XixuAI?.hasKey?.()){openPanel({kind:'ai-settings'});notify('请先保存并测试 DeepSeek 密钥，再回来检查课表。');return}
      if(!ocrImageDataUrl||ocrVisionPending)return;ocrVisionPending=true;const box=main.querySelector('#xixu-ocr-review');if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · 正在检查原图');icons();
      try{if(!window.XixuAI.analyzeVision(timetableVisionPayload(ocrImageDataUrl))){ocrVisionPending=false;if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · 本机识别结果');icons();notify('AI 检查请求未发送。')}}catch(_){ocrVisionPending=false;if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周 · 本机识别结果');icons();notify('AI 检查连接失败。');}
      return;
    }
    if(event.target.closest('[data-action="confirm-timetable"]')&&importCandidate&&!storageBlocked){
      // Match course identity by name; an imported timetable may use different local IDs.
      const mapped=new Map();
      const before=JSON.stringify(snapshot());
      const applyDetectedSchedule=Boolean(importCandidate.detectedSchedule&&main.querySelector('#xixu-apply-detected-schedule')?.checked);
      for(const incoming of importCandidate.courses){
        const existing=courses.find(c=>c.name===incoming.name);
        if(existing)mapped.set(incoming.id,existing.id);
        else {const id=uid();mapped.set(incoming.id,id);courses.push({id,name:incoming.name,short:incoming.short||incoming.name,mark:incoming.mark||incoming.name.slice(0,1),image:null,source:incoming.source||''});}
      }
      const incoming=importCandidate.lessons.map(l=>({...l,course:mapped.get(l.course),rule:l.rule||('第 '+l.weeks.join('、')+' 周')}));
      if(importMode==='ocr'){
        const scopedWeek=importCandidate.ocrWeek;
        incoming.forEach(next=>{const same=lessons.find(old=>old.weeks.includes(scopedWeek)&&old.day===next.day&&lessonPeriodNumbers(old).some(period=>lessonPeriodNumbers(next).includes(period))&&course(old.course)?.name===course(next.course)?.name);if(same&&next.room==='教室待确认'&&same.room)next.room=same.room});
        const staleFragmentCourseIds=new Set(lessons.filter(old=>{
          const oldCourse=course(old.course);if(!old.weeks.includes(scopedWeek)||oldCourse?.source!=='ocr'||!oldCourse.repairedFromOCR)return false;
          const oldName=normalizedCourseName(oldCourse.name);return oldName.length>=2&&incoming.some(next=>next.day===old.day&&normalizedCourseName(course(next.course)?.name).startsWith(oldName)&&normalizedCourseName(course(next.course)?.name).length>oldName.length);
        }).map(old=>old.course));
        const replaces=old=>incoming.some(next=>next.day===old.day&&lessonPeriodNumbers(old).some(period=>lessonPeriodNumbers(next).includes(period)))||staleFragmentCourseIds.has(old.course);
        const replacedOcrCourseIds=new Set(lessons.filter(old=>old.weeks.includes(scopedWeek)&&replaces(old)).map(l=>l.course));
        const kept=lessons.flatMap(old=>{if(!old.weeks.includes(scopedWeek)||!replaces(old))return [old];const remaining=old.weeks.filter(value=>value!==scopedWeek);return remaining.length?[{...old,weeks:remaining,rule:'第 '+compactRange(remaining)+' 周'}]:[]});
        lessons.splice(0,lessons.length,...kept,...incoming);
        for(let index=courses.length-1;index>=0;index--){const c=courses[index],linked=lessons.some(l=>l.course===c.id)||tasks.some(t=>t.course===c.id)||notes.some(n=>n.course===c.id)||Boolean(c.image)||(Array.isArray(c.assessment)&&c.assessment.length);if((c.source==='ocr'||replacedOcrCourseIds.has(c.id))&&!linked)courses.splice(index,1)}
        if(applyDetectedSchedule)scheduleSettings=cleanScheduleSettings(importCandidate.detectedSchedule);
      }else {lessons.splice(0,lessons.length,...incoming);TERM_MONDAY=importCandidate.termStart;if(applyDetectedSchedule)scheduleSettings=cleanScheduleSettings(importCandidate.detectedSchedule);}
      try {storageWrite(JSON.stringify(snapshot()));lastSaved=JSON.stringify(snapshot());}
      catch(_){const old=JSON.parse(before);courses.splice(0,courses.length,...old.courses);lessons.splice(0,lessons.length,...old.lessons);TERM_MONDAY=old.termStart;notify('无法保存，原课表仍然保留。');return;}
      const updatedWeek=importMode==='ocr'?importCandidate.ocrWeek:null;
      importCandidate=null;if(updatedWeek)week=updatedWeek;else week=Math.max(1,Math.min(20,1+Math.floor((Date.parse(DEMO_DAY)-Date.parse(TERM_MONDAY))/604800000)));page='timetable';panel=null;previousPanel=null;render();notify(updatedWeek?'第 '+updatedWeek+' 周已根据截图更新，其他课程保持不变。':'课表已更新，已有事项保持不变。');
    }
  });
  root.addEventListener('submit',event=>{
    if(event.target.id!=='xixu-ocr-review-form'||!importCandidate)return;event.preventDefault();
    const data=new FormData(event.target),rebuilt=[],courseByName=new Map(),rebuiltCourses=[];
    importCandidate.lessons.forEach((lesson,index)=>{
      if(!data.has('keep-'+index))return;
      const name=String(data.get('course-'+index)||'').trim(),roomInput=String(data.get('room-'+index)||'').trim(),room=(!lesson.room||lesson.room==='教室待确认')&&roomInput==='教室待确认'?'教室待确认':roomInput,day=Number(data.get('day-'+index)),start=Number(data.get('start-'+index)),end=Math.max(start,Number(data.get('end-'+index))||start);if(!name||!room||day<0||day>6||start<1||end>24)return;
      let c=courseByName.get(name);if(!c){c={id:'review-'+rebuiltCourses.length,name,short:name,mark:name.slice(0,1),image:null,source:'ocr'};courseByName.set(name,c);rebuiltCourses.push(c)}
      const used=[...new Set(Array.from({length:end-start+1},(_,offset)=>periodBlockIndex(start+offset)).filter(Number.isInteger))],block=periodBlockIndex(start);if(!Number.isInteger(block))return;
      if(lesson.sourceName&&name!==lesson.sourceName)ocrCorrectionRules['course:'+lesson.sourceName]=name;if(lesson.sourceRoom&&room!==lesson.sourceRoom)ocrCorrectionRules['room:'+lesson.sourceRoom]=room;
      rebuilt.push({...lesson,course:c.id,day,block,spans:used.length>1?used:undefined,end:periodEnd(end),period:start===end?String(start):start+'–'+end,room,confidence:1});
    });
    if(!rebuilt.length){notify('至少保留一个课程块。');return}importCandidate.courses=rebuiltCourses;importCandidate.lessons=rebuilt;persist();const box=main.querySelector('#xixu-ocr-review');if(box)box.innerHTML=importReviewHtml('第 '+ocrWeek+' 周识别 · 已应用变化');icons();notify('变化已应用，请再次检查后更新课表。');
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');if(!button)return;
    if(button.dataset.action==='export-backup'){
      const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}),link=document.createElement('a');
      link.href=URL.createObjectURL(blob);link.download='xixu-backup-'+DEMO_DAY+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);notify(notes.some(note=>note.archive)?'索引备份已创建，不含独立图文原件；请同时保留所有原始 HTML。':'备份已创建，请妥善保存。');
    }else if(button.dataset.action==='import-backup')main.querySelector('#xixu-backup-import')?.click();
    else if(button.dataset.action==='widget-preview'){previousPanel=panel;panel={kind:'widget-preview'};render()}
    else if(button.dataset.action==='feedback'){previousPanel=panel;panel={kind:'feedback'};render()}
    else if(button.dataset.action==='enable-reminders'){
      if(window.XixuReminder?.enable()){reminderState={state:'syncing',count:reminderState.count,message:'请在系统提示中允许通知。'};render()}
      else notify('当前无法获取通知权限。');
    }
    else if(button.dataset.action==='edit-assessment'){
      const c=course(button.dataset.id);assessmentDraft={courseId:c.id,items:(c.assessment||[]).map(item=>({...item})),fromImage:false};render();
    }
    else if(button.dataset.action==='add-assessment-row'&&assessmentDraft){assessmentDraft.items.push({name:'',percent:''});render()}
    else if(button.dataset.action==='remove-assessment-row'&&assessmentDraft){assessmentDraft.items.splice(Number(button.dataset.index),1);render()}
  });
  root.addEventListener('submit',event=>{
    if(event.target.id!=='xixu-course-form')return;event.preventDefault();
    const name=String(new FormData(event.target).get('courseName')).trim();if(!name)return;
    if(courses.some(c=>c.name===name)){notify('这门课已经存在。');return;}
    const added={id:uid(),name,short:name,mark:name.slice(0,1),image:null,assessment:[],source:'manual'};courses.push(added);page='courses';panel={kind:'course',id:added.id};render();notify('课程已添加，现在可以上传成绩构成图片。');
  });
  function compactStoredImage(dataUrl){
    return new Promise(resolve=>{const source=new Image();source.onerror=()=>resolve(dataUrl);source.onload=()=>{const maxEdge=2200,scale=Math.min(1,maxEdge/Math.max(source.naturalWidth,source.naturalHeight));if(scale===1&&dataUrl.length<3*1024*1024){resolve(dataUrl);return}const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));const context=canvas.getContext('2d');if(!context){resolve(dataUrl);return}context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0,canvas.width,canvas.height);const compact=canvas.toDataURL('image/jpeg',.86);resolve(compact.length<dataUrl.length?compact:dataUrl)};source.src=dataUrl});
  }
  function attachmentDraftHtml(items,kind){
    return normalizeAttachments(items).map(item=>'<figure class="xixu-attachment"><img src="'+esc(item.dataUrl)+'" alt="'+esc(item.name)+'"><figcaption>'+esc(item.name)+'</figcaption><button type="button" data-action="remove-'+kind+'-image" data-id="'+esc(item.id)+'" aria-label="删除 '+esc(item.name)+'">'+icon('x')+'</button></figure>').join('');
  }
  function savedAttachmentsHtml(items,label){
    const list=normalizeAttachments(items);if(!list.length)return '';
    return '<div class="tide-section"><h2>'+esc(label)+'</h2><span class="tide-pill">'+list.length+' 张图片</span></div><div class="xixu-attachment-grid is-saved">'+list.map(item=>'<figure class="xixu-attachment"><img src="'+esc(item.dataUrl)+'" alt="'+esc(item.name)+'"><figcaption>'+esc(item.name)+'</figcaption></figure>').join('')+'</div>';
  }
  function compactAttachmentImage(dataUrl){
    return new Promise(resolve=>{const source=new Image();source.onerror=()=>resolve(dataUrl);source.onload=()=>{const draw=(maxEdge,quality)=>{const scale=Math.min(1,maxEdge/Math.max(source.naturalWidth,source.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(source.naturalWidth*scale));canvas.height=Math.max(1,Math.round(source.naturalHeight*scale));const context=canvas.getContext('2d');if(!context)return dataUrl;context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(source,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',quality)};let result=draw(1600,.78);if(result.length>2200000)result=draw(1000,.7);resolve(result)};source.src=dataUrl});
  }
  function fileDataUrl(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('图片读取失败。'));reader.onload=()=>resolve(String(reader.result||''));reader.readAsDataURL(file)})}
  function refreshAttachmentGallery(kind){const id=kind==='note'?'xixu-note-image-list':'xixu-task-image-list',target=main.querySelector('#'+id),items=kind==='note'?noteImageDraft:taskImageDraft;if(target){target.innerHTML=attachmentDraftHtml(items,kind);icons()}}
  async function addAttachmentFiles(fileList,kind){
    const draft=kind==='note'?noteImageDraft:taskImageDraft,files=Array.from(fileList||[]),room=6-draft.length;if(!files.length)return;
    if(room<=0){notify('每条记录最多添加 6 张图片。');return}
    const chosen=files.slice(0,room);if(chosen.some(file=>!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)){notify('请选择 JPG、PNG 或 WebP 图片，每张不超过 10 MB。');return}
    try{for(const file of chosen){const dataUrl=await compactAttachmentImage(await fileDataUrl(file));if(dataUrl.length>2500000)throw Error('图片压缩后仍然过大。');draft.push({id:uid(),name:String(file.name||'图片').slice(0,120),type:'image/jpeg',dataUrl})}refreshAttachmentGallery(kind);notify('已添加 '+chosen.length+' 张图片，保存后才会保留。')}
    catch(error){notify(String(error?.message||'图片读取失败。'))}
  }
  root.addEventListener('change',event=>{
    if(event.target.id==='xixu-note-images'){addAttachmentFiles(event.target.files,'note');event.target.value=''}
    else if(event.target.id==='xixu-task-images'){addAttachmentFiles(event.target.files,'task');event.target.value=''}
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button[data-action]');if(!button)return;const action=button.dataset.action;
    if(action==='remove-note-image'){noteImageDraft=noteImageDraft.filter(item=>item.id!==button.dataset.id);refreshAttachmentGallery('note')}
    else if(action==='remove-task-image'){taskImageDraft=taskImageDraft.filter(item=>item.id!==button.dataset.id);refreshAttachmentGallery('task')}
  });
  root.addEventListener('change',event=>{
    if(event.target.id!=='tide-course-image')return;
    const file=event.target.files?.[0],courseId=String(event.target.dataset.course||'');if(!file||!courseId)return;
    assessmentPending=true;assessmentDraft={courseId,items:[],fromImage:true};render();
    const reader=new FileReader();reader.onerror=()=>{assessmentPending=false;render();notify('图片读取失败。')};
    reader.onload=async()=>{const dataUrl=String(reader.result||''),c=course(courseId);if(c){c.image=await compactStoredImage(dataUrl);persist();if(panel?.kind==='course'&&panel.id===courseId)render()}const bridge=await waitForNativeBridge('XixuOCR');if(!bridge?.recognizeAssessment){assessmentPending=false;assessmentDraft={courseId,items:[{name:'',percent:''}],fromImage:false};render();notify('原图已保存，但暂时无法识别，请手动添加成绩构成。');return}try{const started=await Promise.resolve(bridge.recognizeAssessment(dataUrl,courseId));if(!started){assessmentPending=false;render();notify('图片未送入识别服务。')}}catch(_){assessmentPending=false;render();notify('识别服务已断开，请彻底关闭并重新打开汐序。')}};
    reader.readAsDataURL(file);
  });
  root.addEventListener('submit',event=>{
    if(event.target.id==='xixu-assessment-form'){
      event.preventDefault();const form=event.target,c=course(form.dataset.course);if(!c)return;
      const data=new FormData(form),names=data.getAll('assessmentName'),values=data.getAll('assessmentPercent'),items=[];
      for(let index=0;index<names.length;index++){const name=String(names[index]||'').trim(),percent=Number(values[index]);if(name&&Number.isFinite(percent)&&percent>=0&&percent<=100)items.push({name,percent})}
      if(!items.length){notify('请至少添加一个名称和比例。');return}
      c.assessment=items;assessmentDraft=null;assessmentPending=false;render();notify('成绩构成已保存，原图仍会保留。');return;
    }
    if(event.target.id==='xixu-feedback-form'){
      event.preventDefault();const value=feedbackText(event.target),box=main.querySelector('#xixu-feedback-result');let copied=false;
      if(window.XixuClipboard)copied=window.XixuClipboard.copy(value);
      else if(navigator.clipboard){navigator.clipboard.writeText(value).then(()=>notify('反馈已复制')).catch(()=>{});copied=true}
      if(copied){notify('反馈已复制，可以发送给开发者。');if(box)box.innerHTML='<div class="xixu-feedback-ready">'+icon('check-circle-2')+'反馈已复制</div>';icons()}
      else if(box){box.innerHTML='<label class="tide-field">长按复制<textarea class="xixu-feedback-copy" readonly>'+esc(value)+'</textarea></label>';box.querySelector('textarea')?.select()}
    }
  });


