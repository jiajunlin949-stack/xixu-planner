  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const transparencyPreference = matchMedia('(prefers-reduced-transparency: reduce)');
  const tabOrder = ['today','agenda','timetable','courses'];
  let renderedScene = '', renderedPage = '', renderedHtml = '', leavingLayer = null;
  let viewAnimation = null;
  let renderedSubPosition = 0;
  let connectedSwipeCommit = false;
  const tabScroll = new Map();
  const switchPositions = new Map();
  const smoothEase = 'cubic-bezier(.32,.72,0,1)';
  // Keep page motion short and single-layered. ArkWeb can flash when two full
  // translucent pages and a backdrop-filtered fixed bar are composited at once.
  const slideDuration = 300;
  let controlPanel = null;
  const hyaliteNodes = new Set();

  function tactile(pattern=7){
    if(!motionAllowed()||typeof navigator.vibrate!=='function')return;
    try{navigator.vibrate(pattern)}catch(_){}
  }

  function hyaliteCapable(){
    const engine=window.Hyalite;if(!engine||transparencyPreference.matches)return false;
    // Mobile uses the translucent CSS material. SVG displacement on nested
    // backdrops is costly in ArkWeb even when CSS.supports accepts its syntax.
    if(window.XixuStore||matchMedia('(pointer:coarse)').matches)return false;
    return engine.supported();
  }
  function attachHyalite(node,options){
    if(!node||node.dataset.hyaliteAttached==='true'||!hyaliteCapable())return;
    window.Hyalite.attach(node,options);node.dataset.hyaliteAttached='true';hyaliteNodes.add(node);
  }
  function detachHyalite(){
    hyaliteNodes.forEach(node=>{window.Hyalite?.detach(node);delete node.dataset.hyaliteAttached});
    hyaliteNodes.clear();
  }
  function syncHyaliteGlass(){
    const mobile=Boolean(window.XixuStore)||matchMedia('(pointer:coarse)').matches;
    root.classList.toggle('xixu-mobile-material',mobile);
    if(!hyaliteCapable()){detachHyalite();return}
    hyaliteNodes.forEach(node=>{if(!node.isConnected){window.Hyalite?.detach(node);hyaliteNodes.delete(node)}});
    // Keep the edge field unfolded so Hyalite can smooth text beneath the rim.
    attachHyalite(nav,{bevel:16,thickness:38,slope:.95,shape:'squircle',blur:2.2,dispersion:.2,shade:.24,rim:1.35,edgeW:4,sat:.94,edge:.38,light:-132,smooth:1.2,materialize:260});
    // The selected tab is an opaque highlight; only its surrounding bar refracts.
    attachHyalite(nav.querySelector('.tide-add'),{bevel:22,thickness:62,slope:.95,shape:'circle',blur:1,dispersion:.35,shade:.36,rim:1.75,edgeW:5,sat:.94,edge:.5,light:-136,smooth:1.2,materialize:340});
    attachHyalite(main.querySelector('.xixu-note-create'),{bevel:16,thickness:40,slope:.95,shape:'squircle',blur:1,dispersion:.25,shade:.28,rim:1.45,edgeW:4,sat:.94,edge:.4,light:-136,smooth:1.1,materialize:260});
    attachHyalite(main.querySelector('.xixu-agent-composer'),{bevel:16,thickness:36,slope:.95,shape:'squircle',blur:1.3,dispersion:.2,shade:.24,rim:1.25,edgeW:4,sat:.96,edge:.34,light:-132,smooth:1.1,materialize:220});
  }
  transparencyPreference.addEventListener?.('change',()=>requestAnimationFrame(syncHyaliteGlass));

  function syncBackState(){window.XixuBack?.setCanGoBack(Boolean(controlPanel)||canNavigateBack());}

  function closeControlPanel(){
    if(!controlPanel)return false;
    const panel=controlPanel;controlPanel=null;
    syncBackState();
    if(motionAllowed()){
      const sheet=panel.querySelector('.xixu-control-panel');
      (sheet?sheet.animate([{transform:'translate3d(0,0,0)'},{transform:'translate3d(0,14px,0)'}],{duration:140,easing:'ease-out'}).finished:Promise.resolve()).then(()=>panel.remove()).catch(()=>panel.remove());
    }else panel.remove();
    return true;
  }
  window.XixuHasTransientPanel=()=>Boolean(controlPanel);
  window.XixuCloseTransientPanel=()=>closeControlPanel();
  function selectedText(control){
    if(control.tagName==='SELECT')return control.selectedOptions[0]?.textContent||'请选择';
    if(control.type==='date')return control.value?(control.closest('.xixu-home-month')?new Intl.DateTimeFormat('zh-CN',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(control.value+'T12:00:00Z')):dateLabel(control.value)+' · '+weekday(control.value)):'请选择日期';
    if(control.type==='time')return control.value||(control.required?'请选择时间':'不设置时间');
    return control.value||'请选择';
  }
  function controlTitle(control){
    return control.getAttribute('aria-label')||control.closest('label')?.childNodes[0]?.textContent?.trim()||'请选择';
  }
  function setControlValue(control,value,close=true){
    control.value=value;
    const trigger=control.parentElement?.querySelector('.xixu-control-trigger');
    if(trigger)trigger.querySelector('span').textContent=selectedText(control);
    if(close)closeControlPanel();
    control.dispatchEvent(new Event('input',{bubbles:true}));
    control.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function panelShell(control,body){
    closeControlPanel();
    const layer=document.createElement('div');layer.className='xixu-control-layer';
    layer.innerHTML='<button class="xixu-control-scrim" aria-label="关闭选择器"></button><section class="xixu-control-panel" role="dialog" aria-modal="true"><div class="xixu-control-head"><h2></h2><button class="xixu-control-close" aria-label="关闭">'+icon('x')+'</button></div><div class="xixu-control-body"></div></section>';
    layer.querySelector('h2').textContent=controlTitle(control);
    layer.querySelector('.xixu-control-body').append(body);
    root.append(layer);controlPanel=layer;icons();syncBackState();
    layer.querySelector('.xixu-control-close').addEventListener('click',closeControlPanel);
    layer.querySelector('.xixu-control-scrim').addEventListener('click',closeControlPanel);
    if(motionAllowed())layer.querySelector('.xixu-control-panel').animate([{transform:'translate3d(0,22px,0) scale(.99)'},{transform:'translate3d(0,0,0) scale(1)'}],{duration:300,easing:smoothEase});
    return layer;
  }
  function openSelectPanel(control){
    const body=document.createElement('div');
    const isWeek=control.id==='tide-week-select';
    body.className=isWeek?'xixu-week-choices':'xixu-choice-list';
    [...control.options].forEach(option=>{
      const button=document.createElement('button');button.type='button';button.className='xixu-choice';button.dataset.value=option.value;
      if(option.selected)button.setAttribute('aria-pressed','true');
      if(isWeek){
        const match=option.textContent.match(/\d+/),number=match?match[0]:option.textContent;
        button.innerHTML='<strong>'+number+'</strong><small>'+(Number(option.value)%2?'单周':'双周')+'</small>';
        button.setAttribute('aria-label',option.textContent);
      }else button.textContent=option.textContent;
      button.addEventListener('click',()=>setControlValue(control,option.value));body.append(button);
    });
    panelShell(control,body);
  }
  function monthDays(value){
    const base=value?new Date(value+'T12:00:00'):new Date();
    return {year:base.getFullYear(),month:base.getMonth()};
  }
  function openDatePanel(control){
    const body=document.createElement('div');body.className='xixu-calendar';
    let shown=monthDays(control.value);
    const draw=()=>{
      const first=new Date(shown.year,shown.month,1,12),start=(first.getDay()+6)%7;
      const last=new Date(shown.year,shown.month+1,0,12).getDate();
      const previous=new Date(shown.year,shown.month,0,12).getDate();
      const cells=[];
      for(let i=0;i<42;i++){
        const n=i-start+1;let date,muted=false;
        if(n<1){date=new Date(shown.year,shown.month-1,previous+n,12);muted=true}
        else if(n>last){date=new Date(shown.year,shown.month+1,n-last,12);muted=true}
        else date=new Date(shown.year,shown.month,n,12);
        const value=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
        cells.push('<button type="button" data-date="'+value+'" class="'+(muted?'is-muted ':'')+(value===localDay()?'is-today ':'')+'" '+(value===control.value?'aria-pressed="true"':'')+'>'+date.getDate()+'</button>');
      }
      const monthLabel=new Intl.DateTimeFormat('zh-CN',{month:'long',year:'numeric'}).format(first);
      body.innerHTML='<div class="xixu-calendar-nav"><button type="button" data-month="-1" aria-label="上个月">'+icon('chevron-left')+'</button><strong>'+monthLabel+'</strong><button type="button" data-month="1" aria-label="下个月">'+icon('chevron-right')+'</button></div><div class="xixu-calendar-week">'+['一','二','三','四','五','六','日'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="xixu-calendar-grid">'+cells.join('')+'</div><button type="button" class="xixu-calendar-today" data-today>今天</button>';
      icons();
      body.querySelectorAll('[data-month]').forEach(button=>button.addEventListener('click',()=>{shown.month+=Number(button.dataset.month);if(shown.month<0){shown.month=11;shown.year--}if(shown.month>11){shown.month=0;shown.year++}draw()}));
      body.querySelectorAll('[data-date]').forEach(button=>button.addEventListener('click',()=>setControlValue(control,button.dataset.date)));
      body.querySelector('[data-today]').addEventListener('click',()=>setControlValue(control,localDay()));
    };
    panelShell(control,body);draw();
  }
  function openTimePanel(control){
    const value=(control.value||'20:00').split(':').map(Number);let chosenHour=value[0],chosenMinute=Math.round(value[1]/5)*5%60;
    const body=document.createElement('div');body.className='xixu-time-picker';
    const draw=()=>{
      body.innerHTML='<div class="xixu-time-preview">'+String(chosenHour).padStart(2,'0')+'<span>:</span>'+String(chosenMinute).padStart(2,'0')+'</div>'+(control.required?'':'<button type="button" class="xixu-time-empty">不设置时间</button>')+'<h3>小时</h3><div class="xixu-time-grid xixu-hours">'+Array.from({length:24},(_,h)=>'<button type="button" data-hour="'+h+'" '+(h===chosenHour?'aria-pressed="true"':'')+'>'+String(h).padStart(2,'0')+'</button>').join('')+'</div><h3>分钟</h3><div class="xixu-time-grid">'+Array.from({length:12},(_,i)=>i*5).map(m=>'<button type="button" data-minute="'+m+'" '+(m===chosenMinute?'aria-pressed="true"':'')+'>'+String(m).padStart(2,'0')+'</button>').join('')+'</div><button type="button" class="xixu-control-done">完成</button>';
      body.querySelectorAll('[data-hour]').forEach(button=>button.addEventListener('click',()=>{chosenHour=Number(button.dataset.hour);draw()}));
      body.querySelectorAll('[data-minute]').forEach(button=>button.addEventListener('click',()=>{chosenMinute=Number(button.dataset.minute);draw()}));
      body.querySelector('.xixu-time-empty')?.addEventListener('click',()=>setControlValue(control,''));
      body.querySelector('.xixu-control-done').addEventListener('click',()=>setControlValue(control,String(chosenHour).padStart(2,'0')+':'+String(chosenMinute).padStart(2,'0')));
    };
    panelShell(control,body);draw();
  }
  function enhanceNativeControls(){
    main.querySelectorAll('select,input[type="date"],input[type="time"]').forEach(control=>{
      if(control.dataset.xixuEnhanced)return;control.dataset.xixuEnhanced='true';control.classList.add('xixu-native-control');
      const trigger=document.createElement('button');trigger.type='button';trigger.className='xixu-control-trigger '+(control.id==='tide-week-select'?'xixu-week-trigger':'');
      trigger.innerHTML='<span></span>'+icon(control.tagName==='SELECT'?'chevron-down':control.type==='date'?'calendar-days':'clock');
      trigger.querySelector('span').textContent=selectedText(control);
      trigger.setAttribute('aria-label',controlTitle(control));
      trigger.addEventListener('pointerdown',event=>event.preventDefault());
      trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();control.tagName==='SELECT'?openSelectPanel(control):control.type==='date'?openDatePanel(control):openTimePanel(control)});
      control.insertAdjacentElement('afterend',trigger);
    });
  }
  function enhanceSlidingGroups(){
    main.querySelectorAll('.tide-switch,.tide-daystrip').forEach((group,index)=>{
      const buttons=[...group.querySelectorAll('button')];if(!buttons.length)return;
      const selected=Math.max(0,buttons.findIndex(button=>button.getAttribute('aria-pressed')==='true'));
      const key=buttons[0].dataset.action||group.getAttribute('aria-label')||('group-'+index);
      const previous=switchPositions.has(key)?switchPositions.get(key):selected;
      let marker=group.querySelector('.xixu-switch-marker');
      if(!marker){marker=document.createElement('span');marker.className='xixu-switch-marker';marker.setAttribute('aria-hidden','true');group.prepend(marker)}
      const place=position=>{const button=buttons[position]||buttons[selected];marker.style.width=button.offsetWidth+'px';marker.style.height=button.offsetHeight+'px';marker.style.transform='translate3d('+button.offsetLeft+'px,'+button.offsetTop+'px,0)'};
      if(!marker.dataset.ready){place(previous);marker.getBoundingClientRect();marker.dataset.ready='true'}
      if(previous!==selected&&motionAllowed())requestAnimationFrame(()=>place(selected));else place(selected);
      switchPositions.set(key,selected);
    });
  }

  function slidingKey(group,index){
    const first=group.querySelector('button');
    return first?.dataset.action||group.getAttribute('aria-label')||('group-'+index);
  }
  function reuseSlidingGroups(oldView){
    if(!oldView)return;
    const oldGroups=new Map([...oldView.querySelectorAll('.tide-switch,.tide-daystrip')].map((group,index)=>[slidingKey(group,index),group]));
    [...main.querySelectorAll('.tide-switch,.tide-daystrip')].forEach((next,index)=>{
      const previous=oldGroups.get(slidingKey(next,index));if(!previous)return;
      const nextButtons=[...next.querySelectorAll('button')],previousButtons=[...previous.querySelectorAll('button')];
      if(nextButtons.length!==previousButtons.length)return;
      previousButtons.forEach((button,i)=>{const pressed=nextButtons[i].getAttribute('aria-pressed');if(pressed===null)button.removeAttribute('aria-pressed');else button.setAttribute('aria-pressed',pressed)});
      next.replaceWith(previous);
    });
  }

  function stopLeaving() {
    if(leavingLayer){leavingLayer.remove();leavingLayer=null;}
  }
  function motionAllowed(){return !motionPreference.matches && typeof Element.prototype.animate==='function';}
  let pendingDelightCue=null;
  function captureMotionBox(element){
    if(!element)return null;const rect=element.getBoundingClientRect();
    return {left:rect.left,top:rect.top,width:rect.width,height:rect.height};
  }
  function queueDelightCue(type,payload={}){
    if(type==='agent-commit'&&!payload.from)payload={...payload,from:captureMotionBox(main.querySelector('.xixu-agent-action,.xixu-agent-answer'))};
    pendingDelightCue={type,payload};
  }
  function motionItem(id){
    return [...main.querySelectorAll('[data-id],[data-toggle]')].find(element=>element.dataset.id===id||element.dataset.toggle===id)||null;
  }
  function addTransientClass(element,className,duration=720){
    if(!element)return;element.classList.add(className);setTimeout(()=>element.isConnected&&element.classList.remove(className),duration);
  }
  function flyMotionReceipt(from,to,label,kind=''){
    if(!from||!to||!motionAllowed())return;
    const receipt=document.createElement('div');receipt.className='xixu-motion-receipt '+kind;receipt.textContent=label||'已保存';
    receipt.style.left=from.left+'px';receipt.style.top=from.top+'px';receipt.style.width=Math.max(92,Math.min(220,from.width))+'px';document.body.append(receipt);
    const dx=to.left+to.width/2-(from.left+Math.max(92,Math.min(220,from.width))/2),dy=to.top+to.height/2-(from.top+22);
    const animation=receipt.animate([{opacity:0,transform:'translate3d(0,8px,0) scale(.96)'},{opacity:1,offset:.18,transform:'translate3d(0,0,0) scale(1)'},{opacity:.9,offset:.7,transform:'translate3d('+(dx*.72)+'px,'+(dy*.72)+'px,0) scale(.72)'},{opacity:0,transform:'translate3d('+dx+'px,'+dy+'px,0) scale(.28)'}],{duration:620,easing:smoothEase,fill:'forwards'});
    animation.finished.then(()=>receipt.remove(),()=>receipt.remove());
  }
  function playDelightCue(){
    const cue=pendingDelightCue;pendingDelightCue=null;if(!cue||!motionAllowed())return;
    const payload=cue.payload||{};
    if(cue.type==='complete'){
      addTransientClass(main.querySelector('.xixu-day-progress,.xixu-agenda-overview'),'xixu-cue-progress');
      if(payload.allDone)addTransientClass(main.querySelector('.xixu-home-section-head,.tide-heading'),'xixu-cue-day-complete',900);
    }else if(cue.type==='task-created'){
      const target=motionItem(payload.id);addTransientClass(target,'xixu-cue-insert');
      flyMotionReceipt(payload.from,captureMotionBox(target)||captureMotionBox(nav.querySelector('[data-page="'+(payload.page||'agenda')+'"]')),payload.label||'已加入日程','is-task');
    }else if(cue.type==='note-saved'){
      const target=main.querySelector('.xixu-note-card[data-id="'+payload.id+'"]');addTransientClass(target,'xixu-cue-note');
      flyMotionReceipt(payload.from,captureMotionBox(target)||captureMotionBox(nav.querySelector('[data-page="notes"]')),'已保存到笔记','is-note');
    }else if(cue.type==='delete'){
      flyMotionReceipt(payload.from,captureMotionBox(toast),payload.label||'已移除 · 可撤销','is-delete');
    }else if(cue.type==='restore'){
      addTransientClass(motionItem(payload.id)||main.querySelector('.xixu-note-card[data-id="'+payload.id+'"]'),'xixu-cue-restore');
    }else if(cue.type==='plan'){
      addTransientClass(motionItem(payload.id),'xixu-cue-snap');
    }else if(cue.type==='search'){
      const results=[...main.querySelectorAll('.xixu-search-results>button')];results.forEach((item,index)=>{item.style.setProperty('--xixu-reveal-index',index);addTransientClass(item,'xixu-cue-search',520+index*35)});
    }else if(cue.type==='agent-commit'){
      const from=captureMotionBox(main.querySelector('.xixu-agent-answer'))||payload.from,to=captureMotionBox(nav.querySelector('[data-page="'+(payload.destination||'today')+'"]'));
      addTransientClass(main.querySelector('.xixu-agent-answer'),'xixu-cue-agent');flyMotionReceipt(from,to,payload.label||'已保存','is-agent');
    }else if(cue.type==='destination'){
      const fallback=payload.page==='notes'?'.xixu-note-card':payload.page==='timetable'?'.is-rescheduled-in,.tide-grid-cell,.tide-lesson':'.tide-task,.tide-deadline-row,.xixu-home-task';
      addTransientClass(motionItem(payload.id)||main.querySelector(fallback),'xixu-cue-restore',900);
    }
  }
  function itemPositions(){
    const positions=new Map();
    main.querySelectorAll('.tide-task,.tide-deadline-row,.tide-course-card').forEach(el=>{
      const key=el.dataset.id||el.querySelector('[data-toggle]')?.dataset.toggle;
      if(key)positions.set(key,el.getBoundingClientRect());
    });
    return positions;
  }
  // An Agent reply changes one part of a conversation, not its entire page.
  // Reconcile this screen in place so the keyboard, composer and reading
  // position remain intact. Other routes keep their existing motion pipeline.
  function agentDomKey(node){
    if(node.nodeType!==1)return '';
    if(node.id)return 'id:'+node.id;
    if(node.dataset.messageId)return 'message:'+node.dataset.messageId;
    if(node.dataset.id&&node.dataset.action)return node.dataset.action+':'+node.dataset.id;
    const region=node.classList[0];
    return region?node.tagName+':'+region:'';
  }
  function patchAgentNode(current,next){
    if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
    if(current.nodeType===3){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
    if(current.nodeType!==1)return;
    for(const attribute of [...current.attributes])if(!next.hasAttribute(attribute.name))current.removeAttribute(attribute.name);
    for(const attribute of [...next.attributes])if(current.getAttribute(attribute.name)!==attribute.value)current.setAttribute(attribute.name,attribute.value);
    if(current.tagName==='TEXTAREA'){
      if(current.value!==next.value)current.value=next.value;
      current.defaultValue=next.defaultValue;
      return;
    }
    if(current.tagName==='INPUT'){
      if(current.type!=='file'&&current.value!==next.value)current.value=next.value;
      current.checked=next.checked;
      return;
    }
    const existing=[...current.childNodes],keyed=new Map();
    for(const child of existing){const key=agentDomKey(child);if(key&&!keyed.has(key))keyed.set(key,child);}
    const consumed=new Set();
    [...next.childNodes].forEach((desired,index)=>{
      const key=agentDomKey(desired),position=current.childNodes[index];
      let candidate=key?keyed.get(key):position;
      if(candidate&&(consumed.has(candidate)||candidate.nodeType!==desired.nodeType||candidate.nodeName!==desired.nodeName||agentDomKey(candidate)!==key))candidate=null;
      if(candidate){
        consumed.add(candidate);
        if(candidate!==position)current.insertBefore(candidate,position||null);
        patchAgentNode(candidate,desired);
      }else current.insertBefore(desired.cloneNode(true),position||null);
    });
    while(current.childNodes.length>next.childNodes.length)current.lastChild.remove();
    if(current.tagName==='SELECT')current.value=next.value;
  }
  function patchAgentView(oldView,html){
    const next=document.createElement('div');next.className='tide-view';next.innerHTML=html;
    const before=oldView?.querySelector('.xixu-agent-shell[data-conversation-id]'),after=next.querySelector('.xixu-agent-shell[data-conversation-id]');
    if(!before||!after||before.dataset.conversationId!==after.dataset.conversationId)return false;
    const scroller=oldView.querySelector('.xixu-agent-chat-scroll'),scrollTop=scroller?.scrollTop||0;
    const atBottom=scroller&&scroller.scrollHeight-scroller.clientHeight-scrollTop<64;
    const focus=document.activeElement,selection=focus?.tagName==='TEXTAREA'?{start:focus.selectionStart,end:focus.selectionEnd,direction:focus.selectionDirection}:null;
    patchAgentNode(oldView,next);
    if(focus?.isConnected&&selection){
      if(document.activeElement!==focus)focus.focus({preventScroll:true});
      const end=focus.value.length;focus.setSelectionRange(Math.min(selection.start,end),Math.min(selection.end,end),selection.direction);
    }
    const retainedScroller=oldView.querySelector('.xixu-agent-chat-scroll');
    if(retainedScroller)retainedScroller.scrollTop=atBottom?retainedScroller.scrollHeight:scrollTop;
    return true;
  }
  function paintMain(html) {
    const subScene=page==='agenda'?agendaMode:page==='timetable'?(tableMode==='plan'?[tableMode,planMonday].join(':'):[week,tableMode,day].join(':')):'';
    const subPosition=page==='agenda'?['all','exam','done'].indexOf(agendaMode):page==='timetable'?(tableMode==='plan'?Math.floor(Date.parse(planMonday)/604800000):week*20+(tableMode==='day'?10+day:0)):0;
    const scene=page+'|'+(panel?.kind||'')+'|'+(panel?.id||panel?.index||'')+'|'+(panel?'':subScene);
    if(html===renderedHtml && scene===renderedScene)return;
    cancelActiveSwipe();
    cancelSettlingSwipe();
    const routeChanged=scene!==renderedScene, switchingTab=renderedPage!==page&&!panel, connectedCommit=connectedSwipeCommit;
    connectedSwipeCommit=false;
    const oldView=main.firstElementChild;
    const previousPositions=!routeChanged&&motionAllowed()?itemPositions():new Map();
    const direction=switchingTab?Math.sign(tabOrder.indexOf(page)-tabOrder.indexOf(renderedPage))||1:panel?1:Math.sign(subPosition-renderedSubPosition)||-1;
    const hadScene=Boolean(renderedScene);
    if(switchingTab&&renderedPage)tabScroll.set(renderedPage,window.scrollY);
    stopLeaving();
    viewAnimation?.cancel();viewAnimation=null;
    closeControlPanel();
    const patchedAgent=!routeChanged&&panel?.kind==='agent'&&patchAgentView(oldView,html);
    if(!patchedAgent)main.innerHTML='<div class="tide-view">'+html+'</div>';
    if(!switchingTab&&!panel)reuseSlidingGroups(oldView);
    enhanceSlidingGroups();
    enhanceNativeControls();
    requestAnimationFrame(playDelightCue);
    if(switchingTab)window.scrollTo({top:tabScroll.get(page)||0,behavior:'instant'});
    else if(panel&&routeChanged)window.scrollTo({top:0,behavior:'instant'});
    if(routeChanged&&hadScene&&motionAllowed()&&(switchingTab||panel)&&!connectedCommit&&panel?.kind!=='agent'){
      const offset=switchingTab?18:10;
      viewAnimation=main.firstElementChild.animate([
        {transform:switchingTab?'translate3d('+(direction*offset)+'px,0,0)':'translate3d(0,'+offset+'px,0)'},
        {transform:'translate3d(0,0,0)'}
      ],{duration:switchingTab?slideDuration:240,easing:smoothEase});
    } else if(!routeChanged&&previousPositions.size){
      // Only changed rows move; checking a task no longer fades the whole page.
      main.querySelectorAll('.tide-task,.tide-deadline-row,.tide-course-card').forEach(el=>{
        const key=el.dataset.id||el.querySelector('[data-toggle]')?.dataset.toggle;
        const before=previousPositions.get(key);if(!before)return;
        const after=el.getBoundingClientRect(),dy=before.top-after.top;
        if(Math.abs(dy)>1&&Math.abs(dy)<innerHeight)el.animate([{transform:'translateY('+dy+'px)'},{transform:'translateY(0)'}],{duration:230,easing:smoothEase});
      });
    }
    renderedScene=scene;renderedPage=page;renderedHtml=html;renderedSubPosition=subPosition;
    syncBackState();
  }
  function positionNavMarker(){
    const selected=nav.querySelector('[aria-current="page"]'),marker=nav.querySelector('.xixu-nav-marker');
    if(!selected||!marker||nav.hidden)return;
    marker.style.width=selected.offsetWidth+'px';marker.style.height=selected.offsetHeight+'px';
    marker.style.transform='translate3d('+selected.offsetLeft+'px,'+selected.offsetTop+'px,0)';
  }
  function paintNav(){
    root.dataset.page=page;
    root.dataset.panel=panel?.kind||'';
    nav.dataset.current=page;
    if(!nav.querySelector('.xixu-nav-marker')){
    nav.innerHTML='<span class="xixu-nav-marker" aria-hidden="true"></span>'+[['today','今天','house'],['agenda','日程','flag'],['add','添加','plus'],['timetable','课表','calendar-days'],['notes','备忘录','notebook-pen']].map(([k,label,ico])=>'<button '+(k==='add'?'class="tide-add"':'')+' data-action="'+(k==='add'?'add':'nav')+'" data-page="'+k+'" aria-label="'+label+'">'+icon(ico)+(k==='add'?'':'<span>'+label+'</span>')+'</button>').join('');
      nav.classList.add('xixu-nav-initial');
      requestAnimationFrame(()=>nav.classList.remove('xixu-nav-initial'));
    }
    nav.hidden=Boolean(panel);
    nav.querySelectorAll('button[data-page]').forEach(button=>{
      if(button.dataset.page===page&&!panel)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
    });
    positionNavMarker();
    requestAnimationFrame(syncHyaliteGlass);
  }
  const swipeTabs=['today','agenda','timetable','notes'];
  let swipeStart=null,swipeSettling=false,settlingSwipe=null,suppressSwipeClickUntil=0,wheelSwipe=0,wheelSwipeTimer=null;
  main.style.touchAction='pan-y pinch-zoom';
  function primaryPageHtml(name){
    return ({today:renderToday,agenda:renderAgenda,timetable:renderTimetable,notes:renderNotes}[name]||renderToday)();
  }
  function movePrimaryPage(direction){
    const current=swipeTabs.indexOf(page);if(current<0)return false;
    const next=current+direction;if(next<0||next>=swipeTabs.length)return false;
    suppressSwipeClickUntil=performance.now()+420;
    document.getSelection()?.removeAllRanges();
    page=swipeTabs[next];panel=null;previousPanel=null;render();return true;
  }
  function adjacentPage(state,direction){
    const current=swipeTabs.indexOf(page),target=swipeTabs[current+direction];
    if(state.previewDirection===direction&&state.preview?.isConnected)return target;
    state.preview?.remove();state.preview=null;state.previewDirection=direction;state.target=target||null;
    if(!target)return null;
    const preview=document.createElement('div');
    preview.className='tide-view xixu-adjacent-view';preview.setAttribute('aria-hidden','true');preview.inert=true;
    preview.innerHTML=primaryPageHtml(target);
    preview.style.left=state.view.offsetLeft+'px';preview.style.width=state.view.offsetWidth+'px';
    // Preview the destination at its own saved scroll position, not the source's.
    preview.style.top=(state.view.offsetTop+window.scrollY-(tabScroll.get(target)||0))+'px';
    main.appendChild(preview);state.preview=preview;icons();return target;
  }
  function syncSwipeMarker(state,progress){
    const marker=nav.querySelector('.xixu-nav-marker'),from=nav.querySelector('[data-page="'+page+'"]'),to=state.target&&nav.querySelector('[data-page="'+state.target+'"]');
    if(!marker||!from||!to)return;
    const amount=Math.max(0,Math.min(1,progress));
    if(state.markerTarget!==state.target){
      state.markerTarget=state.target;
      state.markerFrom={left:from.offsetLeft,top:from.offsetTop,width:from.offsetWidth,height:from.offsetHeight};
      state.markerTo={left:to.offsetLeft,top:to.offsetTop,width:to.offsetWidth,height:to.offsetHeight};
    }
    const a=state.markerFrom,b=state.markerTo;
    const left=a.left+(b.left-a.left)*amount,top=a.top+(b.top-a.top)*amount;
    marker.style.width=(a.width+(b.width-a.width)*amount)+'px';
    marker.style.height=(a.height+(b.height-a.height)*amount)+'px';
    marker.style.transform='translate3d('+left+'px,'+top+'px,0)';
  }
  function placeSwipe(state,rawDx){
    const direction=rawDx<0?1:-1,target=adjacentPage(state,direction);
    let dx=rawDx;if(!target)dx=rawDx*.2;
    state.dx=dx;state.direction=direction;
    state.view.style.transform='translate3d('+dx+'px,0,0)';
    if(state.preview)state.preview.style.transform='translate3d('+(direction*state.width+dx)+'px,0,0)';
    syncSwipeMarker(state,target?Math.abs(dx)/state.width:0);
  }
  function clearSwipe(state,keepMarker=false){
    if(!state)return;
    cancelAnimationFrame(state.frame);state.frame=0;
    state.animations?.forEach(animation=>animation.cancel());
    state.view.style.transform='';state.view.style.willChange='';state.preview?.remove();
    nav.classList.remove('xixu-nav-dragging');
    if(!keepMarker)positionNavMarker();
  }
  function resetSwipeArtifacts(){
    main.querySelectorAll(':scope > .xixu-adjacent-view').forEach(view=>view.remove());
    const view=main.querySelector(':scope > .tide-view:not(.xixu-adjacent-view)');
    if(view){view.style.transform='';view.style.willChange=''}
    nav.classList.remove('xixu-nav-dragging','xixu-nav-snapping');
  }
  function cancelActiveSwipe(){
    const state=swipeStart;if(!state)return;
    swipeStart=null;
    try{main.releasePointerCapture(state.id)}catch(_){}
    clearSwipe(state);
  }
  function cancelSettlingSwipe(){
    const state=settlingSwipe;if(!state)return;
    settlingSwipe=null;swipeSettling=false;
    clearSwipe(state);nav.classList.remove('xixu-nav-snapping');
  }
  function finishPageSwipe(event,cancelled=false){
    const state=swipeStart;if(!state||event.pointerId!==state.id)return;
    cancelAnimationFrame(state.frame);state.frame=0;
    if(state.axis==='horizontal'&&!cancelled)placeSwipe(state,event.clientX-state.x);
    swipeStart=null;
    try{main.releasePointerCapture(event.pointerId)}catch(_){}
    if(state.axis!=='horizontal'){clearSwipe(state);return}
    const elapsed=Math.max(1,performance.now()-state.time),velocity=Math.abs(state.dx)/elapsed;
    const commit=!cancelled&&state.target&&(Math.abs(state.dx)>=Math.max(54,state.width*.18)||(Math.abs(state.dx)>28&&velocity>.55));
    const currentTo=commit?-state.direction*state.width:0,previewTo=commit?0:state.direction*state.width;
    const duration=motionAllowed()?Math.max(170,Math.min(260,260-Math.abs(state.dx)/state.width*75)):0;
    swipeSettling=true;suppressSwipeClickUntil=performance.now()+duration+180;
    nav.classList.remove('xixu-nav-dragging');nav.classList.add('xixu-nav-snapping');syncSwipeMarker(state,commit?1:0);
    const animations=[state.view.animate([{transform:'translate3d('+state.dx+'px,0,0)'},{transform:'translate3d('+currentTo+'px,0,0)'}],{duration,easing:smoothEase,fill:'forwards'})];
    if(state.preview)animations.push(state.preview.animate([{transform:'translate3d('+(state.direction*state.width+state.dx)+'px,0,0)'},{transform:'translate3d('+previewTo+'px,0,0)'}],{duration,easing:smoothEase,fill:'forwards'}));
    state.animations=animations;settlingSwipe=state;
    Promise.allSettled(animations.map(animation=>animation.finished)).then(()=>{
      if(settlingSwipe!==state)return;
      settlingSwipe=null;
      clearSwipe(state,true);nav.classList.remove('xixu-nav-snapping');swipeSettling=false;
      if(commit){connectedSwipeCommit=true;page=state.target;panel=null;previousPanel=null;render()}else positionNavMarker();
    });
  }
  main.addEventListener('pointerdown',event=>{
    if(!event.isPrimary){cancelActiveSwipe();return}
    if(!event.isPrimary||event.button>0||panel||controlPanel||swipeSettling)return;
    if(event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(swipeStart)cancelActiveSwipe();
    resetSwipeArtifacts();
    viewAnimation?.cancel();viewAnimation=null;
    const view=main.querySelector(':scope > .tide-view:not(.xixu-adjacent-view)');if(!view)return;
    swipeStart={id:event.pointerId,x:event.clientX,y:event.clientY,lastX:event.clientX,time:performance.now(),axis:'',view,width:view.getBoundingClientRect().width,dx:0,direction:0,target:null,preview:null,previewDirection:0};
  },{passive:true});
  main.addEventListener('pointermove',event=>{
    const state=swipeStart;if(!state||event.pointerId!==state.id)return;
    const dx=event.clientX-state.x,dy=event.clientY-state.y;state.lastX=event.clientX;
    if(!state.axis&&Math.max(Math.abs(dx),Math.abs(dy))>8){state.axis=Math.abs(dx)>Math.abs(dy)*1.12?'horizontal':'vertical';if(state.axis==='horizontal')try{main.setPointerCapture(event.pointerId)}catch(_){}}
    if(state.axis!=='horizontal')return;
    event.preventDefault();document.getSelection()?.removeAllRanges();suppressSwipeClickUntil=performance.now()+420;
    state.view.style.willChange='transform';nav.classList.add('xixu-nav-dragging');
    if(!state.frame)state.frame=requestAnimationFrame(()=>{state.frame=0;if(swipeStart===state)placeSwipe(state,state.lastX-state.x)});
  },{passive:false});
  main.addEventListener('pointercancel',event=>finishPageSwipe(event,true));
  main.addEventListener('pointerup',event=>finishPageSwipe(event,false));
  // Touch starts with implicit capture on the card. Its bubbling loss event
  // during transfer to main is not a cancellation of our swipe capture.
  main.addEventListener('lostpointercapture',event=>{if(event.target===main)finishPageSwipe(event,true)});
  window.addEventListener('blur',()=>{cancelActiveSwipe();cancelSettlingSwipe()});
  window.addEventListener('resize',()=>{cancelActiveSwipe();cancelSettlingSwipe()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelActiveSwipe();cancelSettlingSwipe()}});
  nav.addEventListener('click',event=>{const button=event.target.closest('button');if(button)tactile(button.classList.contains('tide-add')?11:6)});
  main.addEventListener('change',event=>{if(event.target.matches('[data-toggle]')&&event.target.checked)tactile([7,24,9])});
  main.addEventListener('wheel',event=>{
    if(panel||controlPanel)return;
    const dx=Math.abs(event.deltaX)>Math.abs(event.deltaY)*1.15?event.deltaX:event.shiftKey?event.deltaY:0;
    if(!dx)return;
    event.preventDefault();wheelSwipe+=dx;
    clearTimeout(wheelSwipeTimer);wheelSwipeTimer=setTimeout(()=>{wheelSwipe=0},180);
    if(Math.abs(wheelSwipe)>=70){const direction=wheelSwipe>0?1:-1;wheelSwipe=0;movePrimaryPage(direction)}
  },{passive:false});
  root.addEventListener('click',event=>{
    if(main.contains(event.target)&&performance.now()<suppressSwipeClickUntil){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  const navResize = new ResizeObserver(positionNavMarker);navResize.observe(nav);
  motionPreference.addEventListener('change',()=>{
    if(motionPreference.matches){stopLeaving();viewAnimation?.cancel();main.getAnimations({subtree:true}).forEach(a=>a.cancel());}
  });
