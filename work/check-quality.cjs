const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'xixu-harmony', 'entry', 'src', 'main', 'resources', 'rawfile', 'app.js');
const moduleDir = path.join(root, 'xixu-harmony', 'web', 'modules');
const nativePath = path.join(root, 'xixu-harmony', 'entry', 'src', 'main', 'ets', 'pages', 'Index.ets');
const generatorPath = path.join(root, 'work', 'prepare-native.cjs');

const app = fs.readFileSync(appPath, 'utf8');
const runtime = fs.readdirSync(moduleDir).filter(name => name.endsWith('.js')).sort().map(name => fs.readFileSync(path.join(moduleDir, name), 'utf8')).join('\n');
const native = fs.readFileSync(nativePath, 'utf8');
const generator = fs.readFileSync(generatorPath, 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const declarations = [...app.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
const duplicates = declarations.filter((name, index) => declarations.indexOf(name) !== index);
const timers = (app.match(/\bsetInterval\s*\(/g) || []).length;

assert(duplicates.length === 0, `duplicate generated functions: ${[...new Set(duplicates)].join(', ')}`);
assert(timers <= 1, `too many repeating timers: ${timers}`);
assert(!/console\.(log|debug)\s*\(/.test(app), 'debug logging remains in generated UI');
assert(!/\.codex[\\/]cache|AppData[\\/]Local[\\/]Temp/i.test(generator), 'generator depends on a personal cache or temp path');
assert(!/(keyPassword|storePassword)\s*[:=]/.test(app + runtime + native), 'signing secrets leaked into application source');
assert(!/TEST_STUDENT_ID|TEST_DEVICE_SERIAL|private-person@example\.invalid/.test(app), 'personal identifiers leaked into packaged UI');
assert(/document\.(hidden|visibilityState)/.test(app), 'background refresh guard is missing');
assert(/xixu-native/.test(app), 'mobile reduced-effects mode is missing');

console.log(JSON.stringify({
  passed: 8,
  generatedBytes: Buffer.byteLength(app),
  namedFunctions: declarations.length,
  duplicateFunctions: 0,
  repeatingTimers: timers,
  checks: [
    'No duplicate named functions in generated UI',
    'At most one repeating timer',
    'No debug logging in packaged UI',
    'Generator has no personal cache or temporary-path dependency',
    'Signing secrets are absent from application source',
    'Known personal identifiers are absent from packaged UI',
    'Background refresh guard is present',
    'Mobile reduced-effects mode is present'
  ]
}, null, 2));
