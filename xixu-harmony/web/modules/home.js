  // Home owns date navigation and presentation; source records stay in their
  // existing stores so filtering never edits a task, lesson or note.
  function homeLessons(date){
    return lessonsOnDate(date);
  }
  function homeTasks(date){return tasks.filter(item=>item.date===date||item.plan===date||item.sessions?.some(session=>session.date===date))}
  function homeNoteTimestamp(note){
    const raw=String(note.updatedAt??''),full=noteTimestamp(raw),known=full!=='未知',label='上次编辑：'+full;
    return '<time data-note-timestamp="edited"'+(known?' datetime="'+esc(raw)+'"':'')+' title="'+esc(label)+'" aria-label="'+esc(label)+'">'+esc(known?full.slice(0,10):'时间未知')+'</time>';
  }
  function homeCalendar(){
    const monday=addDays(selectedDay,-(new Date(selectedDay+'T12:00:00Z').getUTCDay()+6)%7);
    return '<header class="xixu-home-calendar" aria-label="周历"><div class="xixu-home-calendar-head"><button class="tide-icon" data-action="home-week" data-direction="-1" aria-label="上一周">'+icon('chevron-left')+'</button><label class="xixu-home-month"><input type="date" id="tide-plan-date" aria-label="计划日期" value="'+selectedDay+'"></label><button class="tide-icon" data-action="home-week" data-direction="1" aria-label="下一周">'+icon('chevron-right')+'</button></div><div class="xixu-home-week">'+Array.from({length:7},(_,i)=>{const date=addDays(monday,i),occurrences=homeLessons(date),count=homeTasks(date).filter(t=>!t.done).length+occurrences.length,hasMove=occurrences.some(item=>item.isRescheduledIn);return '<button class="'+(hasMove?'has-reschedule':'')+'" data-action="home-day" data-date="'+date+'" aria-label="'+date+' '+weekday(date)+(count?'，'+count+' 项安排':'')+(hasMove?'，有调入课程':'')+'" aria-pressed="'+(selectedDay===date)+'" '+(date===DEMO_DAY?'aria-current="date"':'')+'><small>'+['一','二','三','四','五','六','日'][i]+'</small><strong>'+Number(date.slice(8))+'</strong><i class="'+(count?'has-items':'')+'" aria-hidden="true"></i></button>'}).join('')+'</div></header>';
  }
  function homeTaskRow(task){
    const session=task.sessions?.find(item=>item.date===selectedDay),time=session?.time||task.time||'';
    return '<div class="tide-task xixu-home-task '+(task.done?'is-done':'')+'" data-id="'+esc(task.id)+'"><input type="checkbox" data-toggle="'+esc(task.id)+'" '+(task.done?'checked':'')+' aria-label="'+esc((task.done?'取消完成：':'完成：')+task.title)+'"><button data-action="task-detail" data-id="'+esc(task.id)+'"><strong>'+esc(task.title)+'</strong><small>'+esc((isDeadline(task)?types[task.type]+' · '+timingWord(task)+' '+dateLabel(task.date):course(task.course)?.name||'每日任务'))+'</small></button><time>'+esc(time||'随时')+'</time></div>';
  }
  function renderToday(){
    const entries=homeTasks(selectedDay),pending=entries.filter(t=>!t.done),done=entries.filter(t=>t.done);
    const items=[...pending.map(task=>({time:task.sessions?.find(s=>s.date===selectedDay)?.time||task.time||'99:99',html:homeTaskRow(task)})),...homeLessons(selectedDay).map(({lesson,isRescheduledIn,isRescheduledOut})=>({time:lessonStart(lesson),html:'<div class="xixu-home-lesson '+(isRescheduledIn?'is-rescheduled-in':'')+(isRescheduledOut?'is-rescheduled-out':'')+'" style="'+courseTone(lesson.course)+'"><span aria-hidden="true">'+icon('book-open')+'</span><button data-action="lesson" data-index="'+lessons.indexOf(lesson)+'"><strong>'+esc(course(lesson.course)?.name)+'</strong><small>'+esc(roomLabel(lesson.room))+(isRescheduledIn?' · 调入':isRescheduledOut?' · 已调出':'')+'</small></button><time>'+lessonStart(lesson)+'<small>'+lessonEnd(lesson)+'</small></time></div>'}))].sort((a,b)=>a.time.localeCompare(b.time));
    const recent=notes.slice().sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,2);
    let html=homeCalendar()+'<section class="xixu-home-agenda"><div class="xixu-home-section-head"><h2>'+(selectedDay===DEMO_DAY?'今天':'安排')+' · '+dateLabel(selectedDay)+'</h2><span class="xixu-day-progress">'+pending.length+' 项待办</span><button class="tide-link" data-action="home-today" '+(selectedDay===DEMO_DAY?'hidden':'')+'>回到今天</button></div><div class="tide-plan">'+(items.map(item=>item.html).join('')||'<p class="xixu-home-empty">这一天还没有安排。</p>')+'</div>';
    if(done.length)html+='<details class="tide-completed"><summary>已完成 '+done.length+' 项</summary>'+done.map(homeTaskRow).join('')+'</details>';
    html+='<button class="tide-link xixu-home-add" data-action="add-task">'+icon('plus')+'添加一件小事</button></section>'+renderScratchDock();
    html+='<section class="xixu-home-recent"><div class="xixu-home-section-head"><h2>最近记录</h2><button class="tide-icon" data-action="search-open" aria-label="搜索记录">'+icon('search')+'</button><button class="tide-link" data-action="nav" data-page="notes">全部 '+icon('chevron-right')+'</button></div>'+recent.map(note=>'<button class="xixu-home-record" data-action="memory" data-id="'+esc(note.id)+'">'+icon('notebook-pen')+'<span><strong>'+esc(note.title||'未命名笔记')+'</strong><small>'+esc(note.text||'图片记录')+'</small></span>'+homeNoteTimestamp(note)+'</button>').join('')+(recent.length?'':'<p class="xixu-home-empty">你的笔记会出现在这里。</p>')+'</section>';
    return html;
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    if(button.dataset.action==='home-day'){selectedDay=button.dataset.date;render()}
    else if(button.dataset.action==='home-week'){selectedDay=addDays(selectedDay,Number(button.dataset.direction)*7);render()}
    else if(button.dataset.action==='home-today'){selectedDay=DEMO_DAY;render()}
  });
