import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';

interface SecretIndex { version: number; revision: string; chunks: number; bytes: number; }
// ASSET SECRET is limited to 1024 bytes per item. Publish an index only after
// every new encrypted chunk exists; an interrupted save retains the old index.
export class SecureRecords {
  private encoder: util.TextEncoder = new util.TextEncoder();
  private decoder: util.TextDecoder = new util.TextDecoder();
  private get(alias: string): Uint8Array | undefined {
    const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias)); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    const rows = asset.querySync(query); return rows.length ? rows[0].get(asset.Tag.SECRET) as Uint8Array : undefined;
  }
  private put(alias: string, bytes: Uint8Array): void {
    const values: asset.AssetMap = new Map(); values.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias)); values.set(asset.Tag.SECRET, bytes); values.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED); values.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE); asset.addSync(values);
  }
  private drop(alias: string): void { try { const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias)); asset.removeSync(query); } catch (_) {} }
  private index(alias: string): SecretIndex | undefined {
    const bytes = this.get(alias + '.index-v1'); if (!bytes) { return undefined; }
    const value = JSON.parse(this.decoder.decodeToString(bytes)) as SecretIndex;
    if (value.version !== 1 || !/^[A-Za-z0-9_-]{1,80}$/.test(value.revision) || !Number.isInteger(value.chunks) || value.chunks < 1 || value.chunks > 64 || value.bytes < 1 || value.bytes > 49152 || Math.ceil(value.bytes / 768) !== value.chunks) { throw new Error('安全记录清单损坏'); }
    return value;
  }
  read(alias: string): string {
    const index = this.index(alias);
    if (!index) { const legacy = this.get(alias); return legacy ? this.decoder.decodeToString(legacy) : ''; }
    const all: Uint8Array = new Uint8Array(index.bytes); let offset: number = 0;
    for (let part: number = 0; part < index.chunks; part++) {
      const chunk = this.get(alias + '.' + index.revision + '.' + String(part));
      if (!chunk || chunk.length !== Math.min(768, index.bytes - offset)) { throw new Error('安全记录不完整'); }
      all.set(chunk, offset); offset += chunk.length;
    }
    return this.decoder.decodeToString(all);
  }
  write(alias: string, text: string): void {
    const bytes = this.encoder.encodeInto(text); if (!bytes.length || bytes.length > 49152 || alias.length > 130) { throw new Error('安全记录超出容量'); }
    const previous = this.index(alias), revision: string = String(Date.now()) + '-' + String(Math.random()).slice(2), chunks: number = Math.ceil(bytes.length / 768); let published: boolean = false;
    try {
      for (let part: number = 0; part < chunks; part++) { const key: string = alias + '.' + revision + '.' + String(part); const chunk = bytes.slice(part * 768, (part + 1) * 768); this.put(key, chunk); const saved = this.get(key); if (!saved || saved.length !== chunk.length || saved.some((value: number, index: number): boolean => value !== chunk[index])) { throw new Error('安全记录保存后校验失败'); } }
      const index: SecretIndex = { version: 1, revision, chunks, bytes: bytes.length }; this.put(alias + '.index-v1', this.encoder.encodeInto(JSON.stringify(index))); published = true;
    } finally {
      if (!published) { for (let part: number = 0; part < chunks; part++) { this.drop(alias + '.' + revision + '.' + String(part)); } }
    }
    if (previous) { for (let part: number = 0; part < previous.chunks; part++) { this.drop(alias + '.' + previous.revision + '.' + String(part)); } }
    this.drop(alias); // Remove the legacy value only after index publication.
  }
  remove(alias: string): void {
    const previous = this.index(alias); this.drop(alias + '.index-v1'); this.drop(alias);
    if (previous) { for (let part: number = 0; part < previous.chunks; part++) { this.drop(alias + '.' + previous.revision + '.' + String(part)); } }
  }
}
