const fs = require('node:fs');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [
    process.env.XIXU_PLAYWRIGHT_MODULE,
    path.resolve(__dirname, '..', 'node_modules', 'playwright'),
    'playwright',
  ].filter(Boolean);

  const failures = [];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.code || error.message}`);
    }
  }

  throw new Error(
    `Playwright is unavailable. Run "npm install" or set XIXU_PLAYWRIGHT_MODULE.\n${failures.join('\n')}`,
  );
}

function findBrowserExecutable() {
  const candidates = [
    process.env.XIXU_BROWSER_EXECUTABLE,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const playwright = loadPlaywright();
const browserExecutable = findBrowserExecutable();

module.exports = {
  chromium: playwright.chromium,
  launchOptions: {
    headless: true,
    ...(browserExecutable ? { executablePath: browserExecutable } : {}),
  },
};
