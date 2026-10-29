import { webview } from '@kit.ArkWeb';
import { http } from '@kit.NetworkKit';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { SecureRecords } from './SecureRecords';

interface Capabilities { stream: boolean; structured: boolean; vision: boolean; tools: boolean; reasoning: boolean; }
interface Profile { provider: string; base_url: string; api: string; model: string; capabilities: Capabilities; key: string; revision: string; output_token_field: string; }
interface Profiles { active: string; profiles: Profile[]; }
interface SaveProfile { provider: string; base_url: string; api: string; model: string; capabilities: Capabilities; api_key?: string; clear_key?: boolean; output_token_field?: string; }
interface PublicProfile { provider: string; base_url: string; api: string; model: string; capabilities: Capabilities; revision: string; output_token_field: string; key_configured: boolean; }
interface RequestMeta { model: string; stream?: boolean; }
interface Flight { request: http.HttpRequest; timer: number; }

// A single configuration contract for native phone calls and the companion.
// Keys live only in AssetStoreKit; publicConfig never returns them.
export class ModelGateway {
  private controller: webview.WebviewController;
  private encoder: util.TextEncoder = new util.TextEncoder();
  private decoder: util.TextDecoder = new util.TextDecoder();
  private base64: util.Base64Helper = new util.Base64Helper();
  private flights: Map<string, Flight> = new Map();
  private ends: Map<string, () => void> = new Map();
  private records: SecureRecords = new SecureRecords();
  constructor(controller: webview.WebviewController) { this.controller = controller; }

  private secret(alias: string): string {
    try {
      const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, this.encoder.encodeInto(alias)); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const rows = asset.querySync(query);
      return rows.length ? this.decoder.decodeToString(rows[0].get(asset.Tag.SECRET) as Uint8Array) : '';
    } catch (_) { return ''; }
  }
  private read(): Profiles {
    const saved: string = this.records.read('xixu.models.profiles-v1');
    if (saved) { return JSON.parse(saved) as Profiles; }
    return { active: 'deepseek', profiles: [{ provider: 'deepseek', base_url: 'https://api.deepseek.com', api: 'chat', model: 'deepseek-flash', capabilities: { stream: true, structured: false, vision: false, tools: false, reasoning: false }, key: this.secret('xixu.deepseek.api-key'), revision: 'legacy-deepseek', output_token_field: 'max_tokens' }] };
  }
  publicConfig(): string {
    const saved = this.read();
    // Serialize explicitly so new secret fields cannot leak through a spread.
    const current = saved.profiles.find((value: Profile): boolean => value.provider === saved.active);
    if (!current) { return '{}'; }
    const profiles: PublicProfile[] = saved.profiles.map((item: Profile): PublicProfile => ({ provider: item.provider, base_url: item.base_url, api: item.api, model: item.model, capabilities: item.capabilities, revision: item.revision, output_token_field: item.output_token_field, key_configured: Boolean(item.key) }));
    return JSON.stringify({ provider: current.provider, base_url: current.base_url, api: current.api, model: current.model, capabilities: current.capabilities, revision: current.revision, output_token_field: current.output_token_field, key_configured: Boolean(current.key), profiles });
  }
  private validEndpoint(value: string): boolean {
    const match = /^https:\/\/([A-Za-z0-9.-]+)(?::443)?(\/[A-Za-z0-9_./-]*)?$/.exec(value);
    if (!match || match[1].endsWith('.') || /(?:^|\.)(?:localhost|local|internal)$/.test(match[1])) { return false; }
    if (/^\d+\./.test(match[1])) { return false; } // No private, loopback or literal-IP model endpoints.
    return !match[1].includes('..') && !value.includes('/../');
  }
  save(payload: string): boolean {
    if (payload.length > 16000) { return false; }
    try {
      const value = JSON.parse(payload) as SaveProfile;
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(value.provider) || !this.validEndpoint(value.base_url) || !['chat', 'responses', 'messages'].includes(value.api) || !value.model || value.model.length > 150) { return false; }
      const data = this.read(), old = data.profiles.find((item: Profile): boolean => item.provider === value.provider);
      // Never send a saved key to a changed host without explicit replacement.
      const key: string = value.clear_key ? '' : (value.api_key?.trim() || (old?.base_url === value.base_url ? old.key : ''));
      if (key.length > 500 || (key && key.length < 8) || /[\r\n]/.test(key)) { return false; }
      const profile: Profile = { provider: value.provider, base_url: value.base_url.replace(/\/$/, ''), api: value.api, model: value.model, capabilities: value.capabilities, key, revision: String(Date.now()) + '-' + String(Math.random()).slice(2), output_token_field: value.output_token_field === 'max_completion_tokens' ? 'max_completion_tokens' : 'max_tokens' };
      data.profiles = data.profiles.filter((item: Profile): boolean => item.provider !== value.provider); data.profiles.push(profile); data.active = value.provider;
      this.records.write('xixu.models.profiles-v1', JSON.stringify(data));
      return true;
    } catch (_) { return false; }
  }
  private emit(id: string, type: string, body: string): void {
    const script = 'window.XixuReceiveModel && window.XixuReceiveModel(' + JSON.stringify(id) + ',' + JSON.stringify(type) + ',' + JSON.stringify(body) + ')';
    this.controller.runJavaScript(script).catch(() => {});
  }
  cancel(id: string): boolean {
    const flight = this.flights.get(id); if (!flight) { return false; }
    this.flights.delete(id); clearTimeout(flight.timer); this.ends.get(id)?.(); this.ends.delete(id); flight.request.destroy(); return true;
  }
  close(): void { Array.from(this.flights.keys()).forEach((id: string) => { this.cancel(id); }); }
  start(id: string, revision: string, payload: string): boolean {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || this.flights.has(id) || this.flights.size >= 2 || payload.length > 8 * 1024 * 1024) { return false; }
    const data = this.read(), profile = data.profiles.find((item: Profile): boolean => item.provider === data.active);
    if (!profile || !profile.key || profile.revision !== revision || !this.validEndpoint(profile.base_url)) { return false; }
    let meta: RequestMeta;
    try { meta = JSON.parse(payload) as RequestMeta; if (meta.model !== profile.model) { return false; } } catch (_) { return false; }
    this.request(id, profile, meta.stream === true, payload); return true;
  }
  private async request(id: string, profile: Profile, stream: boolean, payload: string): Promise<void> {
    const request = http.createHttp();
    const timer: number = setTimeout(() => { if (this.cancel(id)) { this.emit(id, 'error', '请求超时。草稿和原始资料已保留，可重新发送。'); } }, 120000);
    this.flights.set(id, { request, timer });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (profile.api === 'messages') { headers['x-api-key'] = profile.key; headers['anthropic-version'] = '2023-06-01'; } else { headers['Authorization'] = 'Bearer ' + profile.key; }
    const route: string = profile.api === 'responses' ? '/responses' : profile.api === 'messages' ? '/messages' : '/chat/completions';
    const options: http.HttpRequestOptions = { method: http.RequestMethod.POST, header: headers, extraData: payload, connectTimeout: 15000, readTimeout: 45000, usingCache: false, expectDataType: http.HttpDataType.STRING };
    try {
      if (stream) {
        let received: number = 0;
        const ended: Promise<void> = new Promise((resolve) => { this.ends.set(id, resolve); request.on('dataEnd', () => { resolve(); }); });
        request.on('dataReceive', (chunk: ArrayBuffer) => {
          if (!this.flights.has(id)) { return; }
          received += chunk.byteLength;
          if (received > 4 * 1024 * 1024) { this.cancel(id); this.emit(id, 'error', '回答超过本地容量，已停止。'); return; }
          this.emit(id, 'chunk', this.base64.encodeToStringSync(new Uint8Array(chunk)));
        });
        const status: number = await request.requestInStream(profile.base_url + route, options);
        await ended;
        if (this.flights.has(id)) { this.emit(id, status >= 200 && status < 300 ? 'end' : 'error', status >= 200 && status < 300 ? '' : '模型服务返回 HTTP ' + String(status)); }
      } else {
        const response = await request.request(profile.base_url + route, options);
        if (this.flights.has(id)) { this.emit(id, response.responseCode >= 200 && response.responseCode < 300 && String(response.result).length <= 4 * 1024 * 1024 ? 'json' : 'error', response.responseCode >= 200 && response.responseCode < 300 ? String(response.result) : '模型服务返回 HTTP ' + String(response.responseCode)); }
      }
    } catch (_) { if (this.flights.has(id)) { this.emit(id, 'error', '模型连接中断，未执行任何日程修改。'); } }
    finally { this.ends.delete(id); if (this.flights.has(id)) { this.flights.delete(id); clearTimeout(timer); request.destroy(); } }
  }
}
