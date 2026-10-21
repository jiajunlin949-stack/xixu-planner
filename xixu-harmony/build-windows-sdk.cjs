// Project-local SDK view. Never changes the installed SDK or global PATH.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dependencies = ['libsec_shared.dll', 'libcjson.dll', 'libhilog.dll',
  'libexpat.dll', 'libjsoncpp.dll', 'libhmicuuc.dll', 'libskia_canvaskit.dll'];
function mirrorDirectory(source, target, expanded) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name), dest = path.join(target, entry.name);
    if (entry.isDirectory()) {
      if (expanded.has(src)) mirrorDirectory(src, dest, expanded);
      else if (!fs.existsSync(dest)) fs.symlinkSync(src, dest, 'junction');
    } else fs.copyFileSync(src, dest);
  }
}
function copyChecked(source, target) {
  if (fs.existsSync(target)) {
    const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (hash(source) !== hash(target)) throw Error('SDK dependency collision: ' + path.basename(target));
  } else fs.copyFileSync(source, target);
}
function prepareWindowsSdk(ide, root) {
  const source = path.join(ide, 'sdk');
  const target = path.join(root, '.build-cache', 'sdk-resource-local-v1');
  const expanded = new Set(['default', 'default/hms', 'default/hms/toolchains',
    'default/hms/toolchains/lib', 'default/openharmony', 'default/openharmony/toolchains']
    .map(p => path.join(source, p)));
  mirrorDirectory(source, target, expanded);
  const preview = path.join(source, 'default/openharmony/previewer/common/bin');
  const hmsLib = path.join(source, 'default/hms/toolchains/lib');
  const dllSources = [...dependencies.map(n => path.join(preview, n)),
    ...fs.readdirSync(hmsLib).filter(n => n.endsWith('.dll')).map(n => path.join(hmsLib, n))];
  // Keep the compiler's dependencies next to its executable and extension DLL.
  for (const folder of ['default/openharmony/toolchains', 'default/hms/toolchains/lib']) {
    for (const src of dllSources) copyChecked(src, path.join(target, folder, path.basename(src)));
  }
  return target;
}
module.exports = { prepareWindowsSdk };
if (require.main === module) console.log(prepareWindowsSdk(process.argv[2], __dirname));
