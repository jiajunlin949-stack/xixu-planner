const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync('xixu-harmony/web/modules/knowledge.js', 'utf8');
const callbacks = {}, calls = [], cancellations = [], saved = new Map();
const fixture = { id: 'chunk', document_id: 'a'.repeat(64), version: 'b'.repeat(64), start: 0, end: 6, title: 'fixture', text: '工程测试资料' };
const window = { XixuKnowledge: {
  status: () => JSON.stringify({ paired: true, server: 'https://192.168.1.2:8766' }),
  call(id, operation, payload) {
    calls.push({ id, operation, payload: JSON.parse(payload) });
    if (operation === 'hold') return true;
    if (operation === 'unavailable') return false;
    setTimeout(() => window.XixuReceiveKnowledge(id, true, JSON.stringify({ source_refs: [fixture], model_configured: false })), 0);
    return true;
  },
  cancel(id) { cancellations.push(id); return true; }
} };
const helpers = vm.runInNewContext(source + '\n({knowledgeCall,cancelKnowledgeRequest,knowledgeReferences,knowledgeStatus,knowledgeEnabled})', {
  window, setTimeout, clearTimeout, Date, Map, JSON, Error, String, Number, Boolean, Math,
  localStorage: { getItem: key => saved.get(key) ?? null }, renderSettings: () => '',
  root: { addEventListener: (name, fn) => callbacks[name] = fn }, esc: String, notify: () => {}, render: () => {}
});
(async () => {
  assert.equal(helpers.knowledgeEnabled(), true);
  saved.set('xixu-knowledge-mode', 'local');
  assert.equal(helpers.knowledgeEnabled(), false);
  saved.set('xixu-knowledge-mode', 'extended');
  // The caller supplies only context explicitly approved by the user.
  const context = {}, payload = { query: '工程测试', local_context: ['已核对的工程测试内容'], conversation_id: 'xixu-thread-a' };
  const result = await helpers.knowledgeCall('chat-prepare', payload, context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].operation, 'chat-prepare');
  assert.equal(calls[0].payload.conversation_id, 'xixu-thread-a');
  assert.equal(calls[0].payload.local_context[0], payload.local_context[0]);
  assert.equal(context.knowledgeId, calls[0].id);
  const refs = helpers.knowledgeReferences(result.source_refs);
  assert.equal(refs[0].recordType, 'external');
  assert.equal(refs[0].action, 'knowledge-source');
  assert.equal(refs[0].id.split(':')[1], 'b'.repeat(64));
  assert.equal(refs[0].chunkStart, 0);
  assert.equal(refs[0].chunkEnd, 6);
  const stopped = {}, held = helpers.knowledgeCall('hold', {}, stopped);
  const rejected = assert.rejects(held, /用户停止/);
  assert.equal(helpers.cancelKnowledgeRequest(stopped.knowledgeId, '用户停止'), true);
  await rejected;
  assert.equal(cancellations[0], stopped.knowledgeId);
  assert.equal(helpers.cancelKnowledgeRequest(stopped.knowledgeId), false);
  window.XixuReceiveKnowledge(stopped.knowledgeId, true, '{}');
  await assert.rejects(helpers.knowledgeCall('unavailable'), /接口尚未就绪/);
  window.XixuKnowledge.status = () => JSON.stringify({ paired: false });
  assert.equal(helpers.knowledgeEnabled(), false);
  assert.equal(calls.filter(call => call.operation === 'chat').length, 0);
  console.log('Knowledge bridge JS contract: passed (mock transport, no real device).');
})().catch(error => { console.error(error); process.exitCode = 1; });
