import { webview } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { deviceInfo } from '@kit.BasicServicesKit';
import { SecureRecords } from './SecureRecords';

interface PairBundle { version: number; server: string; ca: string; code: string; }
interface DeviceConfig { server: string; ca: string; token: string; deviceId: string; }
interface PairResult { token: string; device_id: string; }
interface ExcerptQuery { document_id: string; version: string; start: number; end: number; }

// Only this native bridge holds the phone credential. Web backups cannot read it.
export class KnowledgeBridge {
  private controller: webview.WebviewController;
  private flights: Map<string, http.HttpRequest> = new Map();
  private base64: util.Base64Helper = new util.Base64Helper();
  private records: SecureRecords = new SecureRecords();
  private ends: Map<string, () => void> = new Map();

  constructor(controller: webview.WebviewController) { this.controller = controller; }
  cancel(id: string): boolean { const request = this.flights.get(id); if (!request) { return false; } this.flights.delete(id); this.ends.get(id)?.(); this.ends.delete(id); request.destroy(); return true; }
  close(): void { Array.from(this.flights.keys()).forEach((id: string) => { this.cancel(id); }); }
  private streamReply(id: string, type: string, body: string): void { this.controller.runJavaScript('window.XixuReceiveKnowledgeStream && window.XixuReceiveKnowledgeStream(' + JSON.stringify(id) + ',' + JSON.stringify(type) + ',' + JSON.stringify(body) + ')').catch(() => {}); }

  private read(): DeviceConfig | undefined {
    try {
      const value: string = this.records.read('xixu.knowledge.device-v1');
      return value ? JSON.parse(value) as DeviceConfig : undefined;
    } catch (_) { return undefined; }
  }

  status(): string {
    const config = this.read();
    return JSON.stringify({ paired: Boolean(config), server: config ? config.server : '' });
  }

  disconnect(): boolean {
    this.close();
    try {
      this.records.remove('xixu.knowledge.device-v1');
    } catch (_) {}
    return this.read() === undefined;
  }

  private reply(id: string, ok: boolean, body: string): void {
    const script = 'window.XixuReceiveKnowledge(' + JSON.stringify(id) + ',' + String(ok) + ',' + JSON.stringify(body) + ')';
    this.controller.runJavaScript(script).catch(() => {});
  }

  private validServer(server: string): boolean {
    const match = /^https:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}):8766$/.exec(server);
    if (!match) { return false; }
    const octets: number[] = match.slice(1).map((v: string): number => Number(v));
    if (octets.some((v: number): boolean => v < 0 || v > 255)) { return false; }
    return octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
  }

  call(id: string, operation: string, payload: string): boolean {
    const syncOperation: boolean = ['sync-status', 'sync-begin', 'sync-note', 'sync-asset', 'sync-commit'].includes(operation);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || payload.length > (syncOperation ? 300000 : 22000)) { return false; }
    if (deviceInfo.sdkApiVersion < 20) { this.reply(id, false, '电脑知识库连接需要 HarmonyOS API 20 或以上版本。'); return true; }
    if (!['pair', 'health', 'search', 'chat', 'excerpt', 'chat-prepare', 'chat-confirm', 'chat-stream', 'suggestions'].includes(operation) && !syncOperation) { return false; }
    if (this.flights.has(id) || this.flights.size >= 4) { return false; }
    this.request(id, operation, payload);
    return true;
  }

  private async request(id: string, operation: string, payload: string): Promise<void> {
    const request = http.createHttp();
    this.flights.set(id, request);
    try {
      let config = this.read();
      let path: string = '/v1/health';
      let body: string = '';
      let method: http.RequestMethod = http.RequestMethod.GET;
      if (operation === 'pair') {
        const bundle = JSON.parse(payload) as PairBundle;
        if (bundle.version !== 1 || !this.validServer(bundle.server) || bundle.ca.length > 8000 ||
          !bundle.ca.startsWith('-----BEGIN CERTIFICATE-----') || !/^\d{8}$/.test(bundle.code)) {
          throw new Error('配对信息格式无效，请复制电脑新生成的连接信息。');
        }
        config = { server: bundle.server, ca: bundle.ca, token: '', deviceId: '' };
        path = '/v1/devices/pair'; body = JSON.stringify({ code: bundle.code, name: '汐序鸿蒙手机' });
        method = http.RequestMethod.POST;
      } else if (operation === 'chat-prepare' || operation === 'chat-confirm' || operation === 'chat-stream') {
        path = '/v1/chat/' + (operation === 'chat-prepare' ? 'prepare' : operation === 'chat-stream' ? 'stream' : 'confirm'); body = payload; method = http.RequestMethod.POST;
      } else if (operation === 'suggestions') {
        path = '/v1/suggestions';
      } else if (operation === 'search' || operation === 'chat') {
        path = '/v1/' + operation; body = payload; method = http.RequestMethod.POST;
      } else if (operation === 'sync-status') {
        path = '/v1/notes/status';
      } else if (operation === 'sync-begin' || operation === 'sync-note' || operation === 'sync-asset' || operation === 'sync-commit') {
        const endpoint: string = operation === 'sync-begin' ? 'begin' : operation === 'sync-note' ? 'part' : operation === 'sync-asset' ? 'asset' : 'commit';
        path = '/v1/notes/' + endpoint; body = payload; method = http.RequestMethod.POST;
      } else if (operation === 'excerpt') {
        const query = JSON.parse(payload) as ExcerptQuery;
        if (!/^[a-f0-9]{16,64}$/.test(query.document_id) || !/^[a-f0-9]{16,64}$/.test(query.version) ||
          !Number.isInteger(query.start) || !Number.isInteger(query.end) || query.start < 0 || query.end - query.start > 10000) {
          throw new Error('原文引用无效。');
        }
        path = '/v1/sources/' + query.document_id + '/excerpt?version=' + query.version + '&start=' + query.start + '&end=' + query.end;
      }
      if (!config || !this.validServer(config.server)) { throw new Error('请先在设置中配对电脑知识库。'); }
      if (operation === 'chat-stream') {
        let received: number = 0;
        const ended: Promise<void> = new Promise((resolve) => { this.ends.set(id, resolve); request.on('dataEnd', () => { resolve(); }); });
        request.on('dataReceive', (chunk: ArrayBuffer) => { if (!this.flights.has(id)) { return; } received += chunk.byteLength; if (received > 4 * 1024 * 1024) { this.cancel(id); this.streamReply(id, 'error', '回答超过容量'); return; } this.streamReply(id, 'chunk', this.base64.encodeToStringSync(new Uint8Array(chunk))); });
        const code: number = await request.requestInStream(config.server + path, { method: http.RequestMethod.POST, header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token }, extraData: body, caData: config.ca, connectTimeout: 10000, readTimeout: 120000, usingCache: false });
        await ended;
        if (this.flights.has(id)) { this.streamReply(id, code >= 200 && code < 300 ? 'end' : 'error', code >= 200 && code < 300 ? '' : '电脑返回 HTTP ' + String(code)); }
        return;
      }
      const response = await request.request(config.server + path, {
        method: method, header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        extraData: body, caData: config.ca, expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000, readTimeout: operation === 'chat' || operation === 'chat-confirm' ? 120000 : 30000, usingCache: false
      });
      const status: number = Number(response.responseCode);
      const text: string = String(response.result);
      if (status < 200 || status >= 300) {
        if (status === 401 || status === 403) { throw new Error('配对已失效，请在电脑生成新配对码。'); }
        if (status === 409 && operation === 'chat') { throw new Error('电脑模型尚未就绪，请在电脑保存并测试模型设置。'); }
        if (status === 409 && operation.startsWith('sync-')) { throw new Error('电脑快照已变化或同步发生冲突，请重新核对再同步。'); }
        if (status === 404 && operation.startsWith('sync-')) { throw new Error('电脑服务尚不支持完整笔记同步，请先升级配套服务。'); }
        throw new Error('电脑返回错误（' + String(status) + '），请查看电脑端状态。');
      }
      if (text.length > 1024 * 1024) { throw new Error('电脑响应过大，请缩小查询范围。'); }
      if (operation === 'pair') {
        const paired = JSON.parse(text) as PairResult;
        if (!paired.token || paired.token.length < 32) { throw new Error('配对响应无效。'); }
        config.token = paired.token; config.deviceId = paired.device_id;
        this.records.write('xixu.knowledge.device-v1', JSON.stringify(config));
        this.reply(id, true, '{"paired":true}');
      } else { this.reply(id, true, text); }
    } catch (error) {
      if (!this.flights.has(id)) { return; }
      const detail: string = error instanceof Error ? error.message : '';
      if (operation === 'chat-stream') { this.streamReply(id, 'error', '电脑连接中断，请重新核对后发送。'); }
      else { this.reply(id, false, detail && !/\d{6,}/.test(detail) ? detail : '连接未完成，请检查同一网络、电脑运行状态与防火墙。'); }
    } finally { this.ends.delete(id); this.flights.delete(id); request.destroy(); }
  }
}
