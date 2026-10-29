import { webview } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { deviceInfo } from '@kit.BasicServicesKit';

interface PairBundle { version: number; server: string; ca: string; code: string; }
interface DeviceConfig { server: string; ca: string; token: string; deviceId: string; }
interface PairResult { token: string; device_id: string; }
interface ExcerptQuery { document_id: string; version: string; start: number; end: number; }

// Only this native bridge holds the phone credential. Web backups cannot read it.
export class KnowledgeBridge {
  private controller: webview.WebviewController;
  private encoder: util.TextEncoder = new util.TextEncoder();
  private decoder: util.TextDecoder = new util.TextDecoder();
  private alias: Uint8Array = this.encoder.encodeInto('xixu.knowledge.device-v1');

  constructor(controller: webview.WebviewController) { this.controller = controller; }

  private read(): DeviceConfig | undefined {
    try {
      const query: asset.AssetMap = new Map();
      query.set(asset.Tag.ALIAS, this.alias);
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const rows = asset.querySync(query);
      if (!rows.length) { return undefined; }
      return JSON.parse(this.decoder.decodeToString(rows[0].get(asset.Tag.SECRET) as Uint8Array)) as DeviceConfig;
    } catch (_) { return undefined; }
  }

  status(): string {
    const config = this.read();
    return JSON.stringify({ paired: Boolean(config), server: config ? config.server : '' });
  }

  disconnect(): boolean {
    try {
      const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.alias); asset.removeSync(query);
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
    if (!['pair', 'health', 'search', 'chat', 'excerpt'].includes(operation) && !syncOperation) { return false; }
    this.request(id, operation, payload);
    return true;
  }

  private async request(id: string, operation: string, payload: string): Promise<void> {
    const request = http.createHttp();
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
      const response = await request.request(config.server + path, {
        method: method, header: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        extraData: body, caData: config.ca, expectDataType: http.HttpDataType.STRING,
        connectTimeout: 10000, readTimeout: operation === 'chat' ? 120000 : 30000, usingCache: false
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
        const attributes: asset.AssetMap = new Map();
        attributes.set(asset.Tag.ALIAS, this.alias);
        attributes.set(asset.Tag.SECRET, this.encoder.encodeInto(JSON.stringify(config)));
        attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
        attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
        asset.addSync(attributes);
        this.reply(id, true, '{"paired":true}');
      } else { this.reply(id, true, text); }
    } catch (error) {
      const detail: string = error instanceof Error ? error.message : '';
      this.reply(id, false, detail && !/\d{6,}/.test(detail) ? detail : '连接未完成，请检查同一网络、电脑运行状态与防火墙。');
    } finally { request.destroy(); }
  }
}
