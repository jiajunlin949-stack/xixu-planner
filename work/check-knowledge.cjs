const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('xixu-harmony/web/modules/knowledge.js','utf8');
const callbacks={},calls=[];
const window={XixuKnowledge:{status:()=>'{"paired":true,"server":"https://192.168.1.2:8766"}',call:(id,operation,payload)=>{
  calls.push({operation,payload:JSON.parse(payload)});
  setTimeout(()=>window.XixuReceiveKnowledge(id,true,JSON.stringify({answer:'工程测试回答',answer_generated:true,sources:[{id:'chunk',document_id:'a'.repeat(64),version:'b'.repeat(64),start:0,end:6,title:'fixture',text:'工程测试资料'}]})),0);return true;
}}};
const helpers=vm.runInNewContext(source+'\n({knowledgeAnswer,knowledgeReferences,knowledgeStatus})',{window,setTimeout,clearTimeout,Date,Map,JSON,Error,String,Number,Boolean,Math,renderSettings:()=>'',root:{addEventListener:(name,fn)=>callbacks[name]=fn},esc:s=>String(s),notify:()=>{},render:()=>{}});
(async()=>{
  const local=[{title:'本机资料',text:'工程测试内容'}];
  const result=await helpers.knowledgeAnswer('工程测试',local,'thread-a');
  assert.equal(calls.length,1);assert.equal(calls[0].operation,'chat');
  assert.equal(calls[0].payload.conversation_id,'xixu-thread-a');
  assert.ok(calls[0].payload.local_context[0].includes('工程测试内容'));
  assert.equal(result.action.type,'none');assert.equal(result.refs[0].recordType,'external');
  assert.equal(result.refs[0].action,'knowledge-source');
  assert.equal(result.refs[0].id.split(':')[1],'b'.repeat(64));
  window.XixuKnowledge.status=()=>'{"paired":false}';
  assert.equal(await helpers.knowledgeAnswer('离线测试',[],'thread-a'),null);
  assert.equal(calls.length,1);
  console.log('Knowledge bridge JS contract: passed (mock transport, no real device).');
})().catch(error=>{console.error(error);process.exitCode=1});
