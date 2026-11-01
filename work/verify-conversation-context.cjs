// Explicit offline checks; not part of automatic CI or application startup.
if (!process.argv.includes('--run')) {
  console.log('Opt in: node work/verify-conversation-context.cjs --run');
  process.exit(0);
}
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../xixu-harmony/web/modules/rag.js'),'utf8');
const scope={};vm.runInNewContext(source+'\nthis.compact=compactAgentConversation;this.beforeMessage=agentHistoryBeforeMessage;',scope);
const history=[{id:'old',role:'user',text:'周末咖啡馆的约定：带上蓝色笔记本。'},
  ...Array.from({length:20},(_,i)=>({id:'m'+i,role:i%2?'assistant':'user',text:'讨论其他事情。'.repeat(100)}))];
const before=JSON.stringify(history);
const result=scope.compact(history,2600,'咖啡馆需要带什么');
assert.ok(result.memory.includes('蓝色笔记本'));
assert.ok(result.recallIds.includes('old'));
assert.ok(result.memory.length+result.recent.reduce((n,r)=>n+r.content.length,0)<=2600);
assert.equal(JSON.stringify(history),before,'context selection must not alter stored messages');
assert.equal(scope.compact(history,2600,'量子计算机纠错').memory,'');
assert.equal(scope.compact(history,0,'咖啡馆').contextChars,0);
for(const budget of [1,40,200,900,2600]){
  const r=scope.compact(history,budget,'咖啡馆');assert.ok(r.contextChars<=budget);
}
const short=scope.compact([{id:'one',role:'user',text:'你好'}],2600,'');
assert.equal(short.recent[0].content,'你好');assert.equal(short.memory,'');
const retryHistory=[{id:'before',role:'user',text:'旧消息'}, {id:'request',role:'user',text:'原请求'}, {id:'reply',role:'assistant',text:'原回复'}, {id:'later',role:'user',text:'后来才补充的信息'}];
const retryBefore=JSON.stringify(retryHistory);
assert.deepEqual(Array.from(scope.beforeMessage(retryHistory,'request'),item=>item.id),['before']);
assert.throws(()=>scope.beforeMessage(retryHistory,'missing'),/原消息/);
assert.equal(JSON.stringify(retryHistory),retryBefore);
console.log('Conversation context contract checks passed. No model, user data or service used.');
