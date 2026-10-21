const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(path.resolve(__dirname, '../xixu-harmony/web/modules/data-reminders.js'), 'utf8');
const start = source.indexOf('  function normalizeAgentHistory(');
const end = source.indexOf('  function normalizeScratchEntries(', start);
assert.ok(start >= 0 && end > start, 'data normalization helpers are present');
let generated = 0;
const helpers = vm.runInNewContext(source.slice(start, end) + '\n({normalizeAgentHistory,normalizeAgentPreferences})', {
  uid: () => 'generated-' + ++generated,
  Date,
});

const history = Array.from({ length: 180 }, (_, index) => ({
  id: 'message-' + index, conversationId: index % 2 ? 'a' : 'b',
  role: index % 2 ? 'assistant' : 'user', source: 'local',
  text: index === 0 ? '原始正文\n'.repeat(1400) : '完整消息 ' + index,
  createdAt: '2026-10-12T00:00:00.000Z',
  sentinel: 'keep-extra-source-fields',
}));
const before = JSON.stringify(history);
const normalized = helpers.normalizeAgentHistory(history);
assert.equal(normalized.length, 180, 'more than 100 messages survive normalization');
assert.equal(normalized[0].text, history[0].text, 'long original messages are not truncated');
assert.equal(normalized[0].sentinel, 'keep-extra-source-fields');
assert.equal(JSON.stringify(history), before, 'normalization never mutates the source');

const preferences = {
  activeConversationId: 'b', retainedPreference: 'sentinel',
  conversations: {
    a: { title: '论文讨论', createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z' },
    b: { title: '课程计划', createdAt: '2026-10-12T00:00:00.000Z' },
  },
  conversationDrafts: { a: '第一段草稿\n原样保留空格  和换行', b: '第二段草稿' },
};
const saved = JSON.parse(JSON.stringify(helpers.normalizeAgentPreferences(preferences)));
assert.equal(saved.conversations.a.title, '论文讨论');
assert.equal(saved.conversationDrafts.a, preferences.conversationDrafts.a);
assert.equal(saved.conversationDrafts.b, preferences.conversationDrafts.b);
assert.equal(saved.activeConversationId, 'b');
assert.equal(saved.retainedPreference, 'sentinel');
assert.equal(helpers.normalizeAgentPreferences({}).activeConversationId, 'default', 'legacy defaults remain compatible');
const longDraft = '图片提取与历史编辑草稿\n'.repeat(1200);
assert.equal(helpers.normalizeAgentPreferences({ conversationDrafts: { a: longDraft } }).conversationDrafts.a, longDraft, 'OCR and edited-history drafts are preserved in full');
assert.throws(() => helpers.normalizeAgentPreferences({ conversationDrafts: { a: '字'.repeat(128001) } }), /草稿无效/, 'oversized input fails explicitly instead of silently truncating');
assert.throws(() => helpers.normalizeAgentPreferences(JSON.parse('{"conversations":{"__proto__":{"title":"unsafe"}}}')), /资料无效/);
assert.throws(() => helpers.normalizeAgentHistory([{ role: 'user', text: null }]), /原始资料未修改/);

console.log(JSON.stringify({ passed: 12, checks: [
  '180 history records are retained', 'long messages remain complete', 'extra source fields remain intact',
  'normalization leaves source data untouched', 'conversation names survive serialization',
  'drafts are isolated and preserve whitespace', 'active conversation persists',
  'unrelated preferences survive', 'legacy preferences remain compatible',
  'long OCR and history-edit drafts survive normalization', 'oversized drafts fail without truncation', 'malformed metadata and messages fail safely',
] }, null, 2));
