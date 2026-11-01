const assert = require('node:assert/strict');

// Existing deterministic response fixtures still produce Chat Completions JSON.
// Adapt only the test transport to the production request-id based bridge.
async function installModelFixture(target) {
  await target.addInitScript(() => {
    window.XixuModels = {
      publicConfig: () => JSON.stringify({
        provider: 'deepseek', api: 'chat', base_url: 'https://model.example.invalid/v1',
        model: 'fixture-model', revision: 1, key_configured: Boolean(window.XixuAI?.hasKey?.()),
        capabilities: { stream: false, structured: true, vision: true, tools: true },
      }),
      start(id, revision, payload) {
        if (revision !== 1 || !window.XixuAI?.analyze) return false;
        window.XixuReceiveAI = (ok, status, body) => window.XixuReceiveModel(id, ok ? 'json' : 'error', body);
        return window.XixuAI.analyze(payload);
      },
      cancel: () => true,
    };
  });
}

async function approveFixtureRequests(page) {
  // This consent automation is opt-in per isolated test and clicks the actual
  // review control. It also works while a test is awaiting a delayed bridge reply.
  await page.addInitScript(() => {
    const seen = new WeakSet();
    new MutationObserver(() => {
      const button = document.querySelector('[data-action="assistant-approve-send"]');
      if (button && !seen.has(button)) { seen.add(button); queueMicrotask(() => { if (button.isConnected) button.click(); }); }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function savePlan(page) {
  await page.locator('#xixu-plan-accept').waitFor();
  const before = await page.evaluate(() => localStorage.getItem('xixu-v1'));
  await page.locator('[data-action="assistant-plan-apply"]').click();
  assert.equal(await page.evaluate(() => localStorage.getItem('xixu-v1')), before, 'unchecked diff cannot write data');
  await page.locator('#xixu-plan-accept').check();
  await page.locator('[data-action="assistant-plan-apply"]').click();
  await page.locator('#xixu-plan-accept').waitFor({ state: 'detached' });
}

async function undoPlan(page) {
  await page.evaluate(() => window.XixuHandleSystemBack());
  await page.locator('.tide-settings-fab').click();
  await page.locator('[data-action="assistant-journal"]').click();
  await page.locator('[data-action="assistant-journal-review"]').first().click();
  await page.locator('[data-action="assistant-journal-undo"]').click();
  await page.locator('[data-action=agent-open]').click();
}

module.exports = { installModelFixture, approveFixtureRequests, savePlan, undoPlan };
