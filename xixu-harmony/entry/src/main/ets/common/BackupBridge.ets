import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';

// Own temporary export file and explicit picker handles only. No arbitrary paths.
export class BackupBridge {
  private context: common.UIAbilityContext | undefined = undefined;
  private controller: webview.WebviewController;
  private active: fs.File | undefined = undefined;
  private directory: string = '';
  private mode: string = '';
  private position: number = 0;
  private size: number = 0;
  private saving: boolean = false;
  private base64: util.Base64Helper = new util.Base64Helper();
  private readonly maximum: number = Number.MAX_SAFE_INTEGER;
  constructor(controller: webview.WebviewController) { this.controller = controller; }
  initialize(context: common.UIAbilityContext): void { this.context = context; this.directory = context.cacheDir; }
  private emit(id: string, ok: boolean, body: string): void {
    this.controller.runJavaScript('window.XixuReceiveBackup && window.XixuReceiveBackup(' + JSON.stringify(id) + ',' + String(ok) + ',' + JSON.stringify(body) + ')').catch(() => {});
  }
  close(): boolean {
    if (this.saving) { return false; }
    const writing: boolean = this.mode === 'write';
    if (this.active) { try { fs.closeSync(this.active.fd); } catch (_) {} }
    this.active = undefined; this.mode = ''; this.position = 0; this.size = 0;
    if (writing && this.directory) { try { fs.unlinkSync(this.directory + '/xixu-complete-backup.pending'); } catch (_) {} }
    return true;
  }
  beginWrite(): boolean {
    if (!this.directory || !this.close()) { return false; }
    this.active = fs.openSync(this.directory + '/xixu-complete-backup.pending', fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
    this.mode = 'write'; return true;
  }
  writeChunk(value: string): boolean {
    if (!this.active || this.mode !== 'write' || value.length > 360000) { return false; }
    const bytes = this.base64.decodeSync(value);
    if (!bytes.length || bytes.length > 256 * 1024 || this.position + bytes.length > this.maximum) { return false; }
    let written: number = 0;
    while (written < bytes.length) { const count: number = fs.writeSync(this.active.fd, bytes.buffer.slice(bytes.byteOffset + written, bytes.byteOffset + bytes.byteLength)); if (!count) { return false; } written += count; }
    this.position += written; return true;
  }
  save(id: string, size: number): boolean {
    if (!this.context || !this.active || this.mode !== 'write' || this.position !== size || this.saving) { return false; }
    fs.fsyncSync(this.active.fd); this.size = size; this.saving = true;
    const options = new picker.DocumentSaveOptions(); options.newFileNames = ['xixu-complete-' + String(Date.now()) + '.zip'];
    new picker.DocumentViewPicker(this.context).save(options).then(async (uris: string[]) => {
      let output: fs.File | undefined = undefined;
      try {
        if (!uris.length || !this.active) { throw new Error('cancelled'); }
        fs.lseek(this.active.fd, 0, fs.WhenceType.SEEK_SET);
        output = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
        const buffer: ArrayBuffer = new ArrayBuffer(128 * 1024); let copied: number = 0;
        while (copied < size) {
          const count: number = fs.readSync(this.active.fd, buffer, { length: Math.min(buffer.byteLength, size - copied) });
          if (!count) { throw new Error('read'); }
          let written: number = 0;
          while (written < count) { const part: number = fs.writeSync(output.fd, buffer.slice(written, count)); if (!part) { throw new Error('write'); } written += part; }
          copied += count; await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
        }
        fs.fsyncSync(output.fd); if (fs.statSync(output.fd).size !== size) { throw new Error('size'); }
        this.emit(id, true, '完整备份已写入所选文件；请妥善保存。');
      } catch (_) { this.emit(id, false, '导出未完成或已取消，本机数据未修改。请勿把未完成文件当作备份。'); }
      finally { if (output) { fs.closeSync(output.fd); } this.saving = false; this.close(); }
    }).catch(() => { this.saving = false; this.close(); this.emit(id, false, '未获得保存位置，本机数据未修改。'); });
    return true;
  }
  choose(id: string): boolean {
    if (!this.context || !this.close()) { return false; }
    const options = new picker.DocumentSelectOptions(); options.maxSelectNumber = 1;
    new picker.DocumentViewPicker(this.context).select(options).then((uris: string[]) => {
      try {
        if (!uris.length) { throw new Error('cancelled'); }
        this.active = fs.openSync(uris[0], fs.OpenMode.READ_ONLY); this.size = fs.statSync(this.active.fd).size;
        if (this.size < 22 || this.size > this.maximum) { throw new Error('size'); }
        this.mode = 'read'; this.emit(id, true, JSON.stringify({ size: this.size }));
      } catch (_) { this.close(); this.emit(id, false, '未选择可读取的完整备份文件。'); }
    }).catch(() => { this.close(); this.emit(id, false, '已取消选择，本机资料未修改。'); }); return true;
  }
  readRange(offset: number, length: number): string {
    if (!this.active || this.mode !== 'read' || !Number.isSafeInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1 || length > 256 * 1024 || offset + length > this.size) { throw new Error('读取范围无效'); }
    fs.lseek(this.active.fd, offset, fs.WhenceType.SEEK_SET);
    const bytes: Uint8Array = new Uint8Array(length); let received: number = 0;
    while (received < length) { const part: ArrayBuffer = new ArrayBuffer(length - received); const count: number = fs.readSync(this.active.fd, part, { length: part.byteLength }); if (!count) { throw new Error('备份文件不完整'); } bytes.set(new Uint8Array(part, 0, count), received); received += count; }
    return this.base64.encodeToStringSync(bytes);
  }
}
