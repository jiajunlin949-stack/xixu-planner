// Opt-in offline contracts. Never starts the app or accesses user data.
if(!process.argv.includes('--run')){console.log('Not run. Pass --run for offline engine checks.');process.exit(0)}
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../xixu-harmony/web/modules/assistant-engine.js'),'utf8');
const api=vm.runInNewContext(source+'\n;({createAssistantEngine,validateAssistantEngine});');
let state,sequence=0,saveAllowed=true,saves=0;
const engine=api.createAssistantEngine({read:()=>state,write:value=>state=value,save:()=>{if(saveAllowed)saves++;return saveAllowed},now:()=>new Date(Date.UTC(2026,10,1,sequence)).toISOString(),newId:()=>String(++sequence)});
const input=(key,source='conversation',thread='chat')=>({key,source,thread,ref:{source,id:key,version:'v1'}});
const result=(answer='answer')=>({answer,refs:[],action:{type:'none'},source:'local'});
const ticket=id=>engine.state().tickets.find(item=>item.id===id);

const first=engine.receive(input('message-1'));
assert.equal(engine.receive(input('message-1')).duplicate,true);
assert.equal(engine.state().tickets.length,1);
const assignment=engine.assign(first.ticketId);
engine.checkpoint(first.ticketId,assignment.id,'approval');
assert.equal(ticket(first.ticketId).status,'awaiting_send');
const effect=engine.complete(first.ticketId,assignment.id,{...result(),needsAnswer:true});
assert.equal(ticket(first.ticketId).status,'awaiting_answer');
assert.equal(engine.state().outbox.length,1);
engine.acknowledge(effect.id);const savesAfterAck=saves;engine.acknowledge(effect.id);
assert.equal(saves,savesAfterAck,'repeated receipts must not write storage');
assert.equal(engine.state().outbox[0].status,'delivered');

const followup=engine.receive(input('message-2'));
assert.equal(followup.ticketId,first.ticketId);
const secondAssignment=engine.assign(first.ticketId);
engine.control(first.ticketId,'interrupt');
assert.throws(()=>engine.complete(first.ticketId,secondAssignment.id,result()),/失效/);
engine.control(first.ticketId,'retry');
const thirdAssignment=engine.assign(first.ticketId);
engine.recover();assert.equal(ticket(first.ticketId).status,'interrupted');
assert.throws(()=>engine.complete(first.ticketId,thirdAssignment.id,result()),/失效/);
const savesAfterRecovery=saves;engine.recover();assert.equal(saves,savesAfterRecovery);

const material=engine.receive({...input('note-1','material','note:1'),actor:'owner'});
assert.equal(ticket(material.ticketId).mandate.actor,'imported');
assert.equal(ticket(material.ticketId).mandate.scope.includes('request_cloud'),false);
assert.equal(engine.receive(input('note-1','material','note:1')).duplicate,true);
engine.attach(first.ticketId,ticket(material.ticketId).threadId);
assert.equal(ticket(first.ticketId).subscriptions.at(-1).mode,'context');

const snapshot=JSON.stringify(state);saveAllowed=false;
assert.throws(()=>engine.receive(input('failed-save')),/未保存/);
assert.equal(JSON.stringify(state),snapshot);saveAllowed=true;
engine.policy({paused:true});
assert.throws(()=>engine.assign(material.ticketId),/不可执行/);
engine.policy({paused:false,materials:false});
assert.equal(ticket(material.ticketId).status,'revoked');
assert.throws(()=>engine.control(material.ticketId,'retry'),/不能恢复/);
engine.control(first.ticketId,'stop');
assert.equal(ticket(first.ticketId).mandate.revoked,true);
assert.throws(()=>engine.receive({...input('after-stop'),ticketId:first.ticketId}),/不能直接续接/);

engine.policy({materials:true});
const oldSource=engine.receive({source:'material',key:'document:v1',thread:'document',ref:{source:'material',id:'document',version:'v1'}});
const oldAttempt=engine.assign(oldSource.ticketId);
const newSource=engine.receive({source:'material',key:'document:v2',thread:'document',ref:{source:'material',id:'document',version:'v2'}});
assert.equal(ticket(oldSource.ticketId).status,'superseded');
assert.equal(ticket(oldSource.ticketId).acknowledged,true);
assert.equal(ticket(newSource.ticketId).status,'queued');
assert.throws(()=>engine.complete(oldSource.ticketId,oldAttempt.id,result()),/失效/);
const beforeDisabled=saves;engine.policy({materials:false});const afterPolicy=saves;
assert.equal(engine.receive(input('disabled-source','material','document')).ignored,true);
assert.equal(saves,afterPolicy);assert.ok(afterPolicy>beforeDisabled);

const review=engine.receive(input('review-message','conversation','review-chat'));
const reviewAttempt=engine.assign(review.ticketId);
const reviewEffect=engine.complete(review.ticketId,reviewAttempt.id,{...result(),action:{type:'create_task',item:{title:'synthetic'}}});
const reviewBefore=JSON.stringify(state),preparedConfirmation=engine.prepareConfirmation(review.ticketId,{page:'agenda',id:'synthetic',label:'查看安排'});
assert.equal(JSON.stringify(state),reviewBefore,'preparing confirmation cannot commit separate calendar state');
assert.equal(preparedConfirmation.tickets.find(item=>item.id===review.ticketId).status,'completed');
engine.acknowledge(reviewEffect.id,'dropped');
assert.equal(ticket(review.ticketId).status,'dismissed');
assert.equal(ticket(review.ticketId).result.action.type,'none');

const waiting=engine.receive(input('waiting-message','conversation','waiting-chat'));
const waitingAttempt=engine.assign(waiting.ticketId),waitingEffect=engine.complete(waiting.ticketId,waitingAttempt.id,{...result(),needsAnswer:true});
engine.receive(input('waiting-followup','conversation','waiting-chat'));
engine.acknowledge(waitingEffect.id,'dropped');
assert.equal(ticket(waiting.ticketId).status,'queued','dropping an old report cannot dismiss a resumed task');
api.validateAssistantEngine(state);api.validateAssistantEngine(undefined);
console.log('Offline engine contracts passed; UI, native and performance remain unverified.');
