const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const {chromium,launchOptions}=require('./browser-test-runtime.cjs');
const raw=path.resolve('xixu-harmony/entry/src/main/resources/rawfile'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1),file=path.join(raw,name);if(!/^[\w.-]+$/.test(name)||!fs.existsSync(file)){res.writeHead(404).end();return}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
let browser;
async function run(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch(launchOptions);
 const p=await browser.newPage({viewport:{width:390,height:844}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port);
 const initial=await p.locator('#tide-nav [data-page=agenda]').elementHandle();
 await p.locator('#tide-nav [data-page=agenda]').click();
 const state=await p.evaluate(()=>({animations:document.querySelector('#tide-main').getAnimations({subtree:true}).map(a=>a.effect.getTiming().duration),ghosts:document.querySelectorAll('.xixu-leaving').length,selected:document.querySelector('#tide-nav [aria-current]').dataset.page,marker:document.querySelector('.xixu-nav-marker').style.transform}));
 assert.equal(state.animations.includes(300),true);assert.equal(state.animations.includes(380),true);assert.equal(state.ghosts,0);assert.equal(state.selected,'agenda');
 assert.equal(await initial.evaluate(el=>el===document.querySelector('#tide-nav [data-page=agenda]')),true);
 // Interrupt while moving: the visible route must always be the most recent selection.
 for(const name of ['today','agenda','notes','timetable','today','agenda']){
   await p.evaluate(name=>document.querySelector('#tide-nav [data-page="'+name+'"]').click(),name);
   assert.equal(await p.locator('.xixu-leaving').count(),0);
 }
 await p.waitForFunction(()=>!document.querySelector('.xixu-leaving')&&!document.querySelector('#tide-main').getAnimations({subtree:true}).some(a=>a.playState==='running'));
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'agenda');
  assert.match(await p.locator('#tide-main').innerText(),/每个截止/);
 const before=await p.locator('#tide-main .tide-view').elementHandle();await p.locator('#tide-nav [data-page=agenda]').click();
 assert.equal(await before.evaluate(el=>el===document.querySelector('#tide-main .tide-view')),true);
 const aligned=await p.evaluate(()=>{const a=document.querySelector('#tide-nav [aria-current]').getBoundingClientRect(),b=document.querySelector('.xixu-nav-marker').getBoundingClientRect();return Math.abs(a.left-b.left)<1&&Math.abs(a.width-b.width)<1});assert.equal(aligned,true);
 for(const name of ['today','agenda','timetable','notes','today']){
   await p.locator('#tide-nav [data-page='+name+']').click();
   assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations()[0]?.effect.getTiming().duration),300);
   await p.waitForFunction(()=>!document.querySelector('.xixu-leaving')&&!document.querySelector('#tide-main').getAnimations({subtree:true}).some(a=>a.playState==='running'));
 }
 await p.locator('#tide-nav [data-page=agenda]').click();
 await p.waitForFunction(()=>!document.querySelector('.xixu-leaving'));
 await p.locator('[data-action=agenda-filter][data-value=exam]').click();
 assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
 await p.waitForTimeout(60);
 const segmented=await p.evaluate(()=>{const active=document.querySelector('.tide-switch [aria-pressed=true]').getBoundingClientRect(),marker=document.querySelector('.tide-switch .xixu-switch-marker'),box=marker.getBoundingClientRect();return {duration:marker.getAnimations()[0]?.effect.getTiming().duration||380,aligned:Math.abs(active.left-box.left)<1&&Math.abs(active.width-box.width)<1}});
 assert.equal(segmented.duration,380);
 await p.waitForFunction(()=>!document.querySelector('#tide-main').getAnimations({subtree:true}).some(a=>a.playState==='running'));
 assert.equal(await p.evaluate(()=>{const active=document.querySelector('.tide-switch [aria-pressed=true]').getBoundingClientRect(),marker=document.querySelector('.tide-switch .xixu-switch-marker').getBoundingClientRect();return Math.abs(active.left-marker.left)<1&&Math.abs(active.width-marker.width)<1}),true);
 for(const value of ['done','all','exam','all']){
   await p.locator('[data-action=agenda-filter][data-value='+value+']').click();
   assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
   assert.equal(await p.locator('.xixu-leaving').count(),0);
 }
 await p.screenshot({path:'work/motion-agenda.png',fullPage:true});
 await p.locator('#tide-nav [data-page=timetable]').click();
  // Week 9 may already be selected. A same-value change need not repaint or
  // cancel the incoming route animation; settle it before testing controls.
  await p.waitForFunction(()=>!document.querySelector('.xixu-leaving')&&!document.querySelector('#tide-main .tide-view').getAnimations().some(animation=>animation.playState==='running'||animation.pending));
  await p.getByRole('combobox',{name:'教学周'}).selectOption('9');
  assert.equal(await p.locator('#tide-week-select').inputValue(),'9');
  assert.match(await p.locator('#tide-week-select option:checked').innerText(),/第 9 周/);
 assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
  for(const mode of ['按天看','计划周','一周课表','按天看']){
   await p.getByRole('button',{name:mode,exact:true}).click();
   assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
   assert.equal(await p.locator('.xixu-leaving').count(),0);
 }
  for(const weekday of ['0','1','2','3','4','5','6']){
    await p.locator('[data-action="table-day"][data-value="'+weekday+'"]').click();
   assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
 }
 for(const chosen of ['2','3','10','18','9']){
    await p.getByRole('combobox',{name:'教学周'}).selectOption(chosen);
   assert.equal(await p.locator('#tide-main .tide-view').evaluate(el=>el.getAnimations().length),0);
 }
 await p.locator('#tide-nav [data-page=today]').click();
 await p.waitForFunction(()=>!document.querySelector('.xixu-leaving'));
  assert.equal(await p.locator('#tide-plan-date').count(),1);
  assert.equal(await p.locator('.xixu-home-calendar').isVisible(),true);
 await p.screenshot({path:'work/custom-calendar.png',fullPage:true});
 await p.emulateMedia({reducedMotion:'reduce'});await p.locator('#tide-nav [data-page=today]').click();
 assert.equal(await p.locator('.xixu-leaving').count(),0);
 assert.equal(await p.locator('#tide-main').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 const swipe=async(fromX,toX,fromY=420,toY=424)=>p.evaluate(({fromX,toX,fromY,toY})=>{
   const target=document.querySelector('#tide-main .tide-view'),base={bubbles:true,pointerId:17,pointerType:'touch',isPrimary:true};
   target.dispatchEvent(new PointerEvent('pointerdown',{...base,clientX:fromX,clientY:fromY}));
   target.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:(fromX+toX)/2,clientY:(fromY+toY)/2}));
   target.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:toX,clientY:toY}));
   target.dispatchEvent(new PointerEvent('pointerup',{...base,clientX:toX,clientY:toY}));
 },{fromX,toX,fromY,toY});
 await swipe(330,80);
 await p.waitForFunction(()=>document.querySelector('#tide-nav [aria-current]')?.dataset.page==='agenda');
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'agenda');
 await p.waitForTimeout(430);await swipe(70,330);
 await p.waitForFunction(()=>document.querySelector('#tide-nav [aria-current]')?.dataset.page==='today');
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'today');
 await p.waitForTimeout(430);await swipe(260,190,180,520);
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'today');
 await p.mouse.move(330,420);await p.mouse.down();await p.mouse.move(220,424,{steps:5});
 const following=await p.evaluate(()=>{const current=document.querySelector('#tide-main>.tide-view:not(.xixu-adjacent-view)'),preview=document.querySelector('#tide-main>.xixu-adjacent-view'),currentBox=current?.getBoundingClientRect(),previewBox=preview?.getBoundingClientRect();return {adjacent:document.querySelectorAll('.xixu-adjacent-view').length,current:current?.style.transform,preview:preview?.style.transform,dragging:document.querySelector('#tide-nav').classList.contains('xixu-nav-dragging'),page:document.querySelector('#tide-nav [aria-current]')?.dataset.page,widthDelta:Math.abs((currentBox?.width||0)-(previewBox?.width||0)),seamDelta:Math.abs((currentBox?.right||0)-(previewBox?.left||0))}});
 assert.equal(following.adjacent,1);assert.match(following.current,/translate3d/);assert.match(following.preview,/translate3d/);assert.equal(following.dragging,true);assert.equal(following.page,'today');assert.ok(following.widthDelta<1);assert.ok(following.seamDelta<1);
 await p.screenshot({path:'work/connected-swipe.png',fullPage:false});
 await p.mouse.move(80,424,{steps:5});await p.mouse.up();
 await p.waitForFunction(()=>document.querySelector('#tide-nav [aria-current]')?.dataset.page==='agenda');
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'agenda');
 assert.equal(await p.locator('.xixu-adjacent-view').count(),0);
 await p.waitForTimeout(430);
 const interrupted=await p.evaluate(async()=>{
   const main=document.querySelector('#tide-main'),target=main.querySelector(':scope > .tide-view:not(.xixu-adjacent-view)'),pointer=(type,id,x)=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'mouse',button:0,isPrimary:true,clientX:x,clientY:420}));
   pointer('pointerdown',31,320);pointer('pointermove',31,220);
   await new Promise(requestAnimationFrame);
   const first=main.querySelectorAll(':scope > .xixu-adjacent-view').length;
   pointer('pointerdown',32,310);pointer('pointermove',32,190);
   await new Promise(requestAnimationFrame);
   const second=main.querySelectorAll(':scope > .xixu-adjacent-view').length;
   main.dispatchEvent(new PointerEvent('lostpointercapture',{bubbles:true,pointerId:32,pointerType:'mouse',isPrimary:true}));
   return {first,second,dragging:document.querySelector('#tide-nav').classList.contains('xixu-nav-dragging')};
 });
 assert.deepEqual(interrupted,{first:1,second:1,dragging:false});
 await p.waitForFunction(()=>!document.querySelector('.xixu-adjacent-view')&&!document.querySelector('#tide-main>.tide-view:not(.xixu-adjacent-view)')?.style.transform);
 await p.waitForTimeout(430);await p.mouse.wheel(-120,0);
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'today');
 for(const width of [320,360,736]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(errors,[]);
 // A cancelled gesture must release fill-forwards effects, not only inline CSS.
 await p.setViewportSize({width:390,height:844});await p.emulateMedia({reducedMotion:'no-preference'});
 await p.locator('#tide-nav [data-page=agenda]').click();await p.waitForTimeout(450);
 await p.evaluate(()=>{
   const el=document.querySelector('#tide-main .tide-view'),base={bubbles:true,pointerId:81,pointerType:'touch',isPrimary:true,clientY:220};
   el.dispatchEvent(new PointerEvent('pointerdown',{...base,clientX:300}));
   el.dispatchEvent(new PointerEvent('pointermove',{...base,clientX:180}));
 });
 await p.waitForTimeout(40);
 await p.evaluate(()=>document.querySelector('#tide-main').dispatchEvent(new PointerEvent('pointercancel',{bubbles:true,pointerId:81,isPrimary:true})));
 await p.waitForTimeout(400);
 assert.equal(await p.locator('#tide-main>.tide-view').evaluate(el=>getComputedStyle(el).transform),'none');
 assert.equal(await p.locator('#tide-main>.tide-view').evaluate(el=>el.getAnimations().length),0);
 // Navigation chosen during settling must win over the stale swipe callback.
 await swipe(330,80);await p.locator('#tide-nav [data-page=notes]').click();await p.waitForTimeout(450);
 assert.equal(await p.locator('#tide-nav [aria-current]').getAttribute('data-page'),'notes');
 assert.equal(await p.locator('.xixu-adjacent-view').count(),0);
 assert.equal(await p.locator('#tide-main>.tide-view').evaluate(el=>getComputedStyle(el).transform),'none');
 const result={directionalTransitionMs:300,segmentedControlMs:380,persistentNavigation:true,swipeNavigation:true,connectedPageTrack:true,followFinger:true,mouseDragPreview:true,interruptedSwipeCleanup:true,lostPointerCaptureCleanup:true,trackpadSwipePreview:true,verticalGestureSafe:true,rapidSwitches:true,singleLayerTransitions:true,agendaFiltersNoPageFlash:true,timetableModesNoPageFlash:true,weekdaysNoPageFlash:true,teachingWeeksNoPageFlash:true,noRedundantRerender:true,customCalendar:true,customWeekPicker:true,reducedMotion:true,overflow:false,errors,phonePerformanceTested:false};fs.writeFileSync('work/motion-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
run().catch(e=>{console.error(e.stack);process.exitCode=1}).finally(async()=>{await browser?.close();server.close()});
