const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium, launchOptions } = require('./browser-test-runtime.cjs');

// Browser fixture checks only. These are not HarmonyOS frame-time measurements.
const raw = path.resolve(__dirname, '../xixu-harmony/entry/src/main/resources/rawfile');
const contentTypes = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((request, response) => {
  const name = request.url === '/' ? 'index.html' : request.url.slice(1);
  const file = path.join(raw, name);
  if (!/^[\w.-]+$/.test(name) || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

function fixture() {
  const createdAt = '2026-10-12T03:00:00.000Z';
  return {
    format: 'xixu-backup', schemaVersion: 10, termStart: '2026-08-31',
    courses: [], lessons: [], tasks: [], notes: [], scratchEntries: [], ocrCorrectionRules: {},
    agentHistory: Array.from({ length: 30 }, (_, index) => ({
      id: 'stable-message-' + index, conversationId: 'stable-a',
      role: index % 2 ? 'assistant' : 'user', source: 'local', createdAt,
      text: '历史消息 ' + index + '：' + '这是用来检查阅读位置的完整历史内容，不应该在新回复到来时跳走。'.repeat(5),
    })),
    agentPreferences: {
      courses: true, tasks: true, notes: true, activeConversationId: 'stable-a',
      conversations: {
        'stable-a': { title: '稳定渲染试验', createdAt, updatedAt: createdAt },
        'stable-b': { title: '第二段对话', createdAt, updatedAt: createdAt },
      },
      conversationDrafts: {},
    },
  };
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function selectConversation(page, id, mobile) {
  if (mobile) await page.locator('[data-action="agent-open-drawer"]').click();
  await page.locator('[data-action="agent-select-conversation"][data-id="' + id + '"]').click();
  await page.locator('.xixu-agent-shell[data-conversation-id="' + id + '"]').waitFor();
  await settle(page);
}

let browser;
const checks = [];
const results = [];
function check(label, condition) {
  assert.ok(condition, label);
  checks.push(label);
}

async function runCase(width) {
  const mobile = width < 760;
  const context = await browser.newContext({
    viewport: { width, height: 844 }, timezoneId: 'Asia/Shanghai',
    hasTouch: mobile, isMobile: mobile, reducedMotion: 'reduce',
  });
  try {
    await context.addInitScript(value => {
      localStorage.setItem('xixu-v1', JSON.stringify(value));
      window.__stableRenderTest = { payloads: [] };
      window.XixuAI = {
        hasKey: () => true,
        analyze(payload) { window.__stableRenderTest.payloads.push(JSON.parse(payload)); return true; },
      };
      window.__replyStableRender = answer => window.XixuReceiveAI(true, 200, JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer, action: { type: 'none' } }) } }],
      }));
    }, fixture());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.locator('.tide-settings-fab').click();
    await page.locator('[data-action="agent-open"]').click();
    await page.locator('.xixu-agent-chat-scroll').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await settle(page);
    const prefix = width + 'px: ';
    const initial = await page.evaluate(() => {
      window.__stableNodes = {
        input: document.querySelector('#xixu-agent-form textarea'),
        form: document.querySelector('#xixu-agent-form'),
        scroll: document.querySelector('.xixu-agent-chat-scroll'),
        message: document.querySelector('[data-message-id="stable-message-8"]'),
      };
      return {
        svgFilters: document.querySelectorAll('filter').length,
        scrollable: window.__stableNodes.scroll.scrollHeight > window.__stableNodes.scroll.clientHeight + 200,
      };
    });
    check(prefix + 'long history has an independent scroll container', initial.scrollable);

    const input = page.locator('#xixu-agent-form textarea');
    await input.fill('检索我的知识库并整理相关资料，先不要进行修改');
    await input.focus();
    await page.locator('#xixu-agent-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => window.__stableRenderTest.payloads.length === 1);
    await settle(page);
    const pending = await page.evaluate(() => ({
      sameInput: window.__stableNodes.input === document.querySelector('#xixu-agent-form textarea'),
      sameForm: window.__stableNodes.form === document.querySelector('#xixu-agent-form'),
      focused: document.activeElement === window.__stableNodes.input,
      sameScroll: window.__stableNodes.scroll === document.querySelector('.xixu-agent-chat-scroll'),
      sameMessage: window.__stableNodes.message === document.querySelector('[data-message-id="stable-message-8"]'),
    }));
    check(prefix + 'submit and retrieval-stage updates preserve composer identity', pending.sameInput && pending.sameForm);
    check(prefix + 'pending render preserves input focus', pending.focused);
    check(prefix + 'pending render preserves scroll container and prior message nodes', pending.sameScroll && pending.sameMessage);

    const draft = '回复等待期间的新草稿\n这一行仍然在编辑，不能丢失。';
    await input.fill(draft);
    const beforeReply = await page.evaluate(() => {
      const textarea = document.querySelector('#xixu-agent-form textarea');
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(7, 12);
      const scroll = document.querySelector('.xixu-agent-chat-scroll');
      scroll.scrollTop = 150;
      return { scrollTop: scroll.scrollTop, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd };
    });
    check(prefix + 'fixture is reading earlier history before reply', beforeReply.scrollTop >= 149);
    await page.evaluate(() => window.__replyStableRender('稳定渲染的第一条诊断回复。'));
    await page.getByText('稳定渲染的第一条诊断回复。', { exact: true }).waitFor();
    await settle(page);
    const afterReply = await page.evaluate(() => {
      const textarea = document.querySelector('#xixu-agent-form textarea');
      return {
        sameInput: window.__stableNodes.input === textarea,
        sameForm: window.__stableNodes.form === document.querySelector('#xixu-agent-form'),
        sameMessage: window.__stableNodes.message === document.querySelector('[data-message-id="stable-message-8"]'),
        focused: document.activeElement === textarea,
        draft: textarea.value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd,
        scrollTop: document.querySelector('.xixu-agent-chat-scroll').scrollTop,
      };
    });
    check(prefix + 'reply preserves composer and existing-message identity', afterReply.sameInput && afterReply.sameForm && afterReply.sameMessage);
    check(prefix + 'reply preserves focus and text selection', afterReply.focused && afterReply.selectionStart === beforeReply.selectionStart && afterReply.selectionEnd === beforeReply.selectionEnd);
    check(prefix + 'new draft survives an asynchronous reply', afterReply.draft === draft);
    check(prefix + 'reply does not pull a history reader to the bottom', Math.abs(afterReply.scrollTop - beforeReply.scrollTop) <= 1);

    await input.fill('再检索一次并继续整理知识库，先不要修改');
    await input.focus();
    await page.locator('#xixu-agent-form').evaluate(form => form.requestSubmit());
    await page.waitForFunction(() => window.__stableRenderTest.payloads.length === 2);
    await settle(page);
    const secondDraft = '第二次回复期间的草稿，只属于第一段对话';
    await input.fill(secondDraft);
    await page.evaluate(() => {
      const scroll = document.querySelector('.xixu-agent-chat-scroll');
      scroll.scrollTop = scroll.scrollHeight;
    });
    await page.evaluate(() => window.__replyStableRender('稳定渲染的第二条诊断回复。'));
    await page.getByText('稳定渲染的第二条诊断回复。', { exact: true }).waitFor();
    await settle(page);
    const bottom = await page.evaluate(() => {
      const scroll = document.querySelector('.xixu-agent-chat-scroll');
      return {
        remaining: scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop,
        input: document.querySelector('#xixu-agent-form textarea').value,
        sameInput: window.__stableNodes.input === document.querySelector('#xixu-agent-form textarea'),
      };
    });
    check(prefix + 'a reader already at the bottom follows the new reply', bottom.remaining <= 1);
    check(prefix + 'repeated replies keep the original input node and new draft', bottom.sameInput && bottom.input === secondDraft);

    await selectConversation(page, 'stable-b', mobile);
    check(prefix + 'new conversation has no leaked draft', await input.inputValue() === '');
    await input.fill('第二段对话的独立草稿');
    await selectConversation(page, 'stable-a', mobile);
    check(prefix + 'first conversation restores its own draft', await input.inputValue() === secondDraft);
    await selectConversation(page, 'stable-b', mobile);
    check(prefix + 'second conversation restores its own draft', await input.inputValue() === '第二段对话的独立草稿');
    for (let index = 0; index < 4; index++) await selectConversation(page, index % 2 ? 'stable-b' : 'stable-a', mobile);
    const filterBudget = await page.evaluate(() => ({
      svgFilters: document.querySelectorAll('filter').length,
      messageBackdrops: [...document.querySelectorAll('.xixu-agent-message,.xixu-agent-history,.xixu-agent-chat-scroll')].filter(element => {
        const style = getComputedStyle(element);
        return (style.backdropFilter && style.backdropFilter !== 'none') || (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none');
      }).length,
      infiniteAnimations: document.getAnimations().filter(animation => animation.effect?.getTiming().iterations === Infinity).length,
    }));
    check(prefix + 'switching conversations does not accumulate SVG filter definitions', filterBudget.svgFilters <= initial.svgFilters);
    if (mobile) check(prefix + 'coarse-pointer material does not use SVG displacement', filterBudget.svgFilters === 0);
    check(prefix + 'conversation messages do not stack backdrop filters', filterBudget.messageBackdrops === 0);
    check(prefix + 'idle conversation has no infinite animations', filterBudget.infiniteAnimations === 0);
    check(prefix + 'browser fixture has no runtime errors', errors.length === 0);
    results.push({ width, mobileFixture: mobile, readingScrollDrift: afterReply.scrollTop - beforeReply.scrollTop, initialSvgFilters: initial.svgFilters, finalSvgFilters: filterBudget.svgFilters });
  } finally {
    await context.close();
  }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(launchOptions);
  for (const width of [320, 390, 960]) await runCase(width);
  console.log(JSON.stringify({ passed: checks.length, environment: 'Desktop Chromium fixtures; no HarmonyOS device FPS claim', results, checks }, null, 2));
})().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close();
  server.close();
});
