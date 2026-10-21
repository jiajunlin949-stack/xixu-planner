import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';

// Immutable, content-addressed note assets. No caller-supplied paths, deletes,
// or cloud claims; picker URIs are used only for an explicitly requested export.
export class NoteArchive {
  private directory: string = '';
  private context: common.UIAbilityContext | undefined = undefined;
  private controller: webview.WebviewController;
  private base64: util.Base64Helper = new util.Base64Helper();
  private active: fs.File | undefined = undefined;
  private mode: string = '';
  private key: string = '';
  private expected: number = 0;
  private position: number = 0;

  constructor(controller: webview.WebviewController) { this.controller = controller; }
  initialize(context: common.UIAbilityContext): void {
    this.context = context;
    this.directory = context.filesDir + '/note-archive-v1';
    try { if (!fs.accessSync(this.directory)) { fs.mkdirSync(this.directory); } }
    catch (_) { this.directory = ''; }
  }
  status(): string { return this.directory ? 'ready' : 'unavailable'; }
  private path(key: string): string {
    if (!this.directory || !/^[a-f0-9]{64}$/.test(key)) { throw new Error('原件编号无效'); }
    return this.directory + '/' + key + '.bin';
  }
  close(): boolean {
    if (this.active) { try { fs.closeSync(this.active.fd); } catch (_) {} }
    this.active = undefined; this.mode = ''; this.key = ''; this.position = 0; this.expected = 0;
    return true;
  }
  beginWrite(key: string, size: number): boolean {
    this.close();
    const destination: string = this.path(key);
    if (!Number.isInteger(size) || size < 1 || size > 20 * 1024 * 1024) { throw new Error('原件大小超出本次支持范围'); }
    if (fs.accessSync(destination)) {
      if (fs.statSync(destination).size !== size) { throw new Error('已有原件校验失败，请保留资料并联系开发者'); }
      return false;
    }
    this.active = fs.openSync(destination + '.pending', fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    this.mode = 'write'; this.key = key; this.expected = size;
    return true;
  }
  writeChunk(encoded: string): boolean {
    if (!this.active || this.mode !== 'write' || encoded.length > 350000) { throw new Error('原件写入状态无效'); }
    const bytes: Uint8Array = this.base64.decodeSync(encoded);
    if (!bytes.length || this.position + bytes.length > this.expected) { throw new Error('原件字节数不一致'); }
    const count: number = fs.writeSync(this.active.fd, bytes.buffer, { length: bytes.byteLength });
    if (count !== bytes.byteLength) { throw new Error('存储空间不足或原件写入不完整'); }
    this.position += count;
    return true;
  }
  finishWrite(): boolean {
    if (!this.active || this.mode !== 'write' || this.position !== this.expected) { throw new Error('原件没有完整保存'); }
    const destination: string = this.path(this.key);
    fs.fsyncSync(this.active.fd);
    this.close();
    fs.renameSync(destination + '.pending', destination);
    return true;
  }
  beginRead(key: string): number {
    this.close();
    this.active = fs.openSync(this.path(key), fs.OpenMode.READ_ONLY);
    this.expected = fs.statSync(this.active.fd).size;
    if (this.expected < 1 || this.expected > 20 * 1024 * 1024) { this.close(); throw new Error('原件大小无效'); }
    this.mode = 'read'; this.key = key;
    return this.expected;
  }
  readChunk(length: number): string {
    if (!this.active || this.mode !== 'read') { throw new Error('没有正在读取的原件'); }
    const remaining: number = this.expected - this.position;
    if (!remaining) { return ''; }
    const size: number = Math.min(256 * 1024, remaining, Math.max(1, Math.floor(length)));
    const buffer: ArrayBuffer = new ArrayBuffer(size);
    const count: number = fs.readSync(this.active.fd, buffer, { length: size });
    if (count < 1) { throw new Error('原件读取不完整'); }
    this.position += count;
    return this.base64.encodeToStringSync(new Uint8Array(buffer).subarray(0, count));
  }
  exportFile(key: string, name: string): boolean {
    if (!this.context) { return false; }
    const source: string = this.path(key);
    const options = new picker.DocumentSaveOptions();
    const safeName: string = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    options.newFileNames = [safeName.length > 180 ? safeName.slice(0, 175) + '.html' : safeName];
    new picker.DocumentViewPicker(this.context).save(options).then((uris: string[]) => {
      if (!uris.length) { this.reply(false, '已取消导出，原件仍在本机'); return; }
      let input: fs.File | undefined = undefined;
      let output: fs.File | undefined = undefined;
      try {
        input = fs.openSync(source, fs.OpenMode.READ_ONLY);
        output = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        const size: number = fs.statSync(input.fd).size;
        const buffer: ArrayBuffer = new ArrayBuffer(256 * 1024);
        let copied: number = 0;
        while (copied < size) {
          const count: number = fs.readSync(input.fd, buffer, { length: Math.min(buffer.byteLength, size - copied) });
          if (!count || fs.writeSync(output.fd, buffer, { length: count }) !== count) { throw new Error('导出不完整'); }
          copied += count;
        }
        fs.fsyncSync(output.fd); this.reply(true, '原始 HTML 已导出，请保留作为图文备份');
      } catch (_) { this.reply(false, '原件导出未完成，请重试；本机原件未修改'); }
      finally { if (input) { fs.closeSync(input.fd); } if (output) { fs.closeSync(output.fd); } }
    }).catch(() => { this.reply(false, '未取得保存权限，原件未修改'); });
    return true;
  }
  private reply(ok: boolean, message: string): void {
    this.controller.runJavaScript('window.XixuReceiveArchiveExport && window.XixuReceiveArchiveExport(' + String(ok) + ',' + JSON.stringify(message) + ')').catch(() => {});
  }
}
