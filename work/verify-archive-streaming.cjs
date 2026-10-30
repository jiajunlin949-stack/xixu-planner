// Opt-in source contract. Not part of automatic CI; run only when validation is requested.
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const context = { Uint8Array, Uint32Array, DataView, TextEncoder, TextDecoder, Blob, Map, Set, Number, Error,
  archiveYield: async () => {} };
const source = ['archive-io.js', 'backup-zip.js'].map(name => fs.readFileSync('xixu-harmony/web/modules/' + name, 'utf8')).join('\n');
const api = vm.runInNewContext(source + '\n({ArchiveDigest,BackupZipWriter,backupZipDirectory,backupVerifyEntry})', context);
const bytes = text => new TextEncoder().encode(text);
const digest = value => { const state = new api.ArchiveDigest(); state.update(value); return state.finish(); };
function sparseOutput(prefix = 0) {
  const segments = []; let position = prefix;
  return { segments, size: () => position,
    write: async value => { segments.push({ offset: position, value: value.slice() }); position += value.length; },
    read: async (offset, length) => { const out = new Uint8Array(length); for (const segment of segments) { const start = Math.max(offset, segment.offset), end = Math.min(offset + length, segment.offset + segment.value.length); if (end > start) out.set(segment.value.subarray(start - segment.offset, end - segment.offset), start - offset); } return out; }
  };
}
(async () => {
  for (const length of [0, 1, 55, 56, 63, 64, 65, 513, 65537]) {
    const value = Uint8Array.from({ length }, (_, index) => (index * 137) & 255), state = new api.ArchiveDigest();
    for (let at = 0; at < value.length; at += 37) state.update(value.subarray(at, at + 37));
    const actual = state.finish();
    assert.equal(actual.hash, crypto.createHash('sha256').update(value).digest('hex'));
    assert.equal(actual.bytes, length);
  }
  assert.equal(digest(bytes('123456789')).crc, 0xcbf43926);
  const original = bytes('完整原件，含中文与 emoji 📚'), hash = digest(original).hash;
  for (const prefix of [0, 2 ** 32 + 123]) {
    const output = sparseOutput(prefix), zip = new api.BackupZipWriter(output.write); zip.position = prefix;
    for (const [name, content] of [['manifest.json', bytes('{}')], ['planner.json', bytes('{}')], ['assets/' + hash, original]]) {
      await zip.entry(name, content.length, digest(content).crc, async write => { for (let at = 0; at < content.length; at += 3) await write(content.subarray(at, at + 3)); });
    }
    await zip.close();
    const entries = await api.backupZipDirectory(output.read, output.size());
    assert.equal(entries.size, 3);
    assert.equal((await api.backupVerifyEntry(entries.get('assets/' + hash))).hash, hash);
    if (!prefix) {
      // Mutate only a stored payload, leaving directory metadata intact.
      const payload = output.segments.find(segment => segment.value.length === 3 && segment.value[0] === original[0]);
      assert.ok(payload); payload.value[0] ^= 1;
      await assert.rejects(api.backupVerifyEntry(entries.get('assets/' + hash)), /CRC/);
    }
  }
  console.log('Archive SHA/CRC and ZIP/ZIP64 metadata contracts passed; no real backup/device validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
