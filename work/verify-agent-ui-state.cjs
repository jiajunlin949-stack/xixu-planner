// Explicit opt-in: source contracts only, no app, API or private data.
if(!process.argv.includes('--run')){console.log('Not run. Use --run for offline state checks.');process.exit(0)}
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const modules=path.resolve(__dirname,'../xixu-harmony/web/modules');
function section(source,start,end){const from=source.indexOf(start),to=source.indexOf(end,from+start.length);assert.ok(from>=0&&to>from,'missing source section');return source.slice(from,to)}
const runtime=fs.readFileSync(path.join(modules,'assistant-results.js'),'utf8')+'\n'+fs.readFileSync(path.join(modules,'assistant-workbench.js'),'utf8');
const helpers=section(runtime,'  function assistantBuildResultIndex(','  function assistantMessageActionsHtml(')+section(runtime,'  function assistantPaginateWork(','  function assistantWorkPanel(');
const scope={};vm.runInNewContext(helpers+'\nthis.index=assistantBuildResultIndex;this.result=assistantMessageResult;this.paginate=assistantPaginateWork;',scope);

const rows=Array.from({length:61},(_,id)=>({id:String(id)}));
assert.equal(scope.paginate(rows,0).items.length,20);
assert.equal(scope.paginate(rows,3).items[0].id,'60');
assert.equal(scope.paginate(rows,999).page,3);
assert.equal(scope.paginate(rows.slice(0,5),3).page,0);
assert.equal(scope.paginate([],2).total,0);
assert.equal(scope.paginate(rows,-1).page,0);
assert.equal(scope.paginate(rows,'invalid').page,0);
assert.equal(scope.paginate(rows,0,0).items.length,20);

const history=[{id:'q1',role:'user',conversationId:'chat',text:'旧请求',createdAt:'first'}, {id:'a1',role:'assistant',conversationId:'chat',text:'旧建议'}, {id:'q2',role:'user',conversationId:'chat',text:'新请求',createdAt:'second'}];
const tickets=[{id:'t1',conversationId:'chat',userId:'q1',resultMessageId:'a1',inputs:[{id:'q1',at:'first'}],mandate:{revoked:false},status:'review',result:{answer:'旧建议',action:{type:'create_task',item:{title:'第一件事'}}}}, {id:'t2',conversationId:'chat',userId:'q2',inputs:[{id:'q2',at:'second'}],mandate:{revoked:false},status:'queued'}];
const index=scope.index(history,tickets),first=scope.result(history[1],history,tickets,index);
assert.equal(first.ticketId,'t1');assert.equal(first.action.item.title,'第一件事');
first.action.item.title='临时编辑';assert.equal(tickets[0].result.action.item.title,'第一件事');
assert.equal(scope.result({...history[1],conversationId:'other'},history,tickets),null);

const restoreScope={agentHistory:history,assistantEngine:{state:()=>({tickets})},agentConversationResults:new Map([['chat',{ticketId:'t1'}]]),activeConversationId:()=> 'chat',agentDraft:null};
vm.runInNewContext(helpers+section(runtime,'  function assistantRestoreResults(','  function assistantClearResultDrafts(')+'\nthis.restore=assistantRestoreResults;',restoreScope);
restoreScope.restore();assert.equal(restoreScope.agentConversationResults.has('chat'),false,'a newer pending question must not restore an old global action');
history.push({id:'a2',role:'assistant',conversationId:'chat',text:'新建议'});
Object.assign(tickets[1],{status:'review',resultMessageId:'a2',result:{answer:'新建议',action:{type:'create_task',item:{title:'第二件事'}}}});
restoreScope.restore();assert.equal(restoreScope.agentConversationResults.get('chat').ticketId,'t2');
assert.equal(scope.result(history[1],history,tickets).action.item.title,'第一件事');
tickets[0].status='completed';assert.equal(scope.result(history[1],history,tickets).action.type,'none');
history[0].editedAt='changed';assert.equal(scope.result(history[1],history,tickets),null);

const data=fs.readFileSync(path.join(modules,'data-reminders.js'),'utf8');
let current={tasks:[]},snapshots=0,writes=0,reminders=0,fail=false;
const storage={storageBlocked:false,lastSaved:'',saveError:{hidden:true},snapshot:()=>{snapshots++;return current},storageWrite:()=>{if(fail)throw Error('full');writes++},syncReminders:()=>{reminders++}};
vm.runInNewContext(section(data,'  function persist(options=','  function loadSaved(')+'\nthis.save=persist;',storage);
assert.equal(storage.save({scope:'assistant'}),true);assert.equal(snapshots,1);assert.equal(writes,1);assert.equal(reminders,0);
assert.equal(storage.save({scope:'assistant'}),true);assert.equal(writes,1);
current={tasks:[{id:'one'}]};assert.equal(storage.save(),true);assert.equal(reminders,1);
const committed=storage.lastSaved;current={tasks:[{id:'two'}]};fail=true;
assert.equal(storage.save({scope:'assistant'}),false);assert.equal(storage.lastSaved,committed);assert.equal(storage.saveError.hidden,false);
console.log('Offline state contracts passed. No native, UI, API or performance validation.');
