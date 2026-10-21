import { webview } from '@kit.ArkWeb';
import { common } from '@kit.AbilityKit';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { http } from '@kit.NetworkKit';
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { image } from '@kit.ImageKit';
import { textRecognition } from '@kit.CoreVisionKit';
import { reminderAgentManager } from '@kit.BackgroundTasksKit';
import { notificationManager } from '@kit.NotificationKit';
import { BusinessError, pasteboard } from '@kit.BasicServicesKit';
import { consumeStartupRoute, registerStartupRouteHandler, setStartupRoute, unregisterStartupRouteHandler } from '../common/StartupRoute';
import { NoteArchive } from '../common/NoteArchive';
import { KnowledgeBridge } from '../common/KnowledgeBridge';

// Git experiment: first modification of Index.ets
interface ReminderTask {
  id: string;
  type: string;
  title: string;
  courseName: string;
  date: string;
  time: string;
  repeat: string;
  reminders: number[];
  done: boolean;
  content?: string;
}

interface ReminderPayload {
  tasks: ReminderTask[];
}

interface ScheduledReminder {
  at: number;
  task: ReminderTask;
  hoursBefore: number;
}

class LocalStore {
  private directory: string = '';
  private cloudDirectory: string = '';
  private syncState: string = 'local-only';

  initialize(directory: string, cloudDirectory: string): void {
    this.directory = directory;
    this.cloudDirectory = cloudDirectory;
    this.syncState = cloudDirectory ? 'ready' : 'local-only';
  }

  cloudStatus(): string { return this.syncState; }

  private validText(file: string): string {
    if (!file) { return ''; }
    try {
      if (!fs.accessSync(file)) { return ''; }
      const value: string = fs.readTextSync(file);
      JSON.parse(value);
      return value;
    } catch (error) {
      throw new Error(String(error));
    }
  }

  private atomicWrite(directory: string, value: string, keepBackup: boolean): void {
    const temp: string = directory + '/planner-v1.pending';
    const destination: string = directory + '/planner-v1.json';
    let fd: number = -1;
    try {
      const opened = fs.openSync(temp, fs.OpenMode.CREATE | fs.OpenMode.READ_WRITE | fs.OpenMode.TRUNC);
      fd = opened.fd;
      fs.writeSync(fd, value);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = -1;
      if (keepBackup && fs.accessSync(destination)) { fs.copyFileSync(destination, directory + '/planner-v1.backup.json'); }
      fs.renameSync(temp, destination);
    } catch (error) {
      if (fd >= 0) { try { fs.closeSync(fd); } catch (_) {} }
      throw new Error(String(error));
    }
  }

  read(): string {
    const file = this.directory + '/planner-v1.json';
    try {
      const local: string = this.validText(file);
      let cloud: string = '';
      const cloudFile: string = this.cloudDirectory ? this.cloudDirectory + '/planner-v1.json' : '';
      try { cloud = this.validText(cloudFile); } catch (_) { this.syncState = 'waiting'; }
      const cloudMtime: number = cloud ? fs.statSync(cloudFile).mtime : 0;
      const localMtime: number = local ? fs.statSync(file).mtime : 0;
      if (cloud && (!local || cloudMtime > localMtime + 1000)) {
        this.atomicWrite(this.directory, cloud, Boolean(local));
        this.syncState = 'synced';
        return cloud;
      }
      if (local) {
        if (this.cloudDirectory && (!cloud || localMtime > cloudMtime + 1000)) {
          try { this.atomicWrite(this.cloudDirectory, local, false); this.syncState = 'synced'; }
          catch (_) { this.syncState = 'waiting'; }
        } else { this.syncState = this.cloudDirectory ? 'synced' : 'local-only'; }
        return local;
      }
      return '';
    } catch (_) {
      try {
        const backup: string = this.directory + '/planner-v1.backup.json';
        if (!fs.accessSync(backup)) { return 'XIXU_READ_ERROR'; }
        const value: string = fs.readTextSync(backup);
        JSON.parse(value);
        fs.copyFileSync(backup, file);
        return value;
      } catch (_) {
        // An explicit invalid record prevents treating a read failure as first launch.
        return 'XIXU_READ_ERROR';
      }
    }
  }

  // Single fixed destination. The web layer cannot choose or read arbitrary paths.
  save(value: string): boolean {
    if (!this.directory || value.length > 40 * 1024 * 1024) { return false; }
    try {
      this.atomicWrite(this.directory, value, true);
      if (this.cloudDirectory) {
        try { this.atomicWrite(this.cloudDirectory, value, false); this.syncState = 'synced'; }
        catch (_) { this.syncState = 'waiting'; }
      }
      return true;
    } catch (_) {
      return false;
    }
  }
}

class SelectedFileBridge {
  private readonly base64: util.Base64Helper = new util.Base64Helper();
  private selectedUris: string[] = [];
  private activeFile: fs.File | undefined = undefined;
  private activeSize: number = 0;
  private activePosition: number = 0;
  private selectionId: number = 0;

  private closeActive(): void {
    if (this.activeFile) {
      try { fs.closeSync(this.activeFile.fd); } catch (_) {}
    }
    this.activeFile = undefined;
    this.activeSize = 0;
    this.activePosition = 0;
  }

  setSelection(uris: string[]): boolean {
    this.closeActive();
    this.selectedUris = uris.slice(0, 500);
    this.selectionId += 1;
    return true;
  }

  begin(index: number): string {
    this.closeActive();
    if (!Number.isInteger(index) || index < 0 || index >= this.selectedUris.length) {
      throw new Error('所选文件不可用');
    }
    let opened: fs.File | undefined = undefined;
    try {
      opened = fs.openSync(this.selectedUris[index], fs.OpenMode.READ_ONLY);
      const size: number = fs.statSync(opened.fd).size;
      if (!Number.isInteger(size) || size < 1 || size > 20 * 1024 * 1024) {
        throw new Error('所选文件大小无效');
      }
      this.activeFile = opened;
      this.activeSize = size;
      this.activePosition = 0;
      return JSON.stringify({ size: size, name: opened.name, selectionId: this.selectionId });
    } catch (_) {
      if (opened) { try { fs.closeSync(opened.fd); } catch (_) {} }
      throw new Error('无法打开所选文件');
    }
  }

  readChunk(length: number): string {
    if (!this.activeFile) { throw new Error('没有正在读取的文件'); }
    const requested: number = Math.min(256 * 1024, Math.max(1, Math.floor(length)));
    const remaining: number = this.activeSize - this.activePosition;
    if (remaining <= 0) { return ''; }
    const target: number = Math.min(requested, remaining);
    const buffer: ArrayBuffer = new ArrayBuffer(target);
    let count: number = 0;
    try { count = fs.readSync(this.activeFile.fd, buffer, { length: target }); }
    catch (_) { this.closeActive(); throw new Error('无法读取所选文件'); }
    if (count <= 0) { return ''; }
    this.activePosition += count;
    return this.base64.encodeToStringSync(new Uint8Array(buffer).subarray(0, count));
  }

  finish(expectedId?: number): boolean {
    if (expectedId !== undefined && expectedId !== this.selectionId) { return false; }
    this.closeActive();
    this.selectedUris = [];
    return true;
  }
}

class DeepSeekBridge {
  private controller: webview.WebviewController;
  private readonly encoder: util.TextEncoder = new util.TextEncoder();
  private readonly decoder: util.TextDecoder = new util.TextDecoder();
  private readonly alias: Uint8Array = this.encoder.encodeInto('xixu.deepseek.api-key');

  constructor(controller: webview.WebviewController) { this.controller = controller; }

  private readKey(): string {
    try {
      const query: asset.AssetMap = new Map();
      query.set(asset.Tag.ALIAS, this.alias);
      query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
      const result = asset.querySync(query);
      if (result.length === 0) { return ''; }
      const secret = result[0].get(asset.Tag.SECRET) as Uint8Array;
      return this.decoder.decodeToString(secret);
    } catch (_) { return ''; }
  }

  hasKey(): boolean { return this.readKey().length > 0; }

  saveKey(value: string): boolean {
    const key = value.trim();
    if (key.length < 12 || key.length > 300) { return false; }
    try {
      const attributes: asset.AssetMap = new Map();
      attributes.set(asset.Tag.ALIAS, this.alias);
      attributes.set(asset.Tag.SECRET, this.encoder.encodeInto(key));
      attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
      attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE);
      asset.addSync(attributes);
      return true;
    } catch (_) { return false; }
  }

  deleteKey(): boolean {
    try {
      const query: asset.AssetMap = new Map();
      query.set(asset.Tag.ALIAS, this.alias);
      asset.removeSync(query);
    } catch (_) {}
    return !this.hasKey();
  }

  private reply(callback: string, ok: boolean, status: number, body: string): void {
    const script = 'window.' + callback + '(' + String(ok) + ',' + String(status) + ',' + JSON.stringify(body) + ')';
    this.controller.runJavaScript(script).catch(() => {});
  }

  analyze(payload: string): boolean {
    if (!payload || payload.length > 32 * 1024) { return false; }
    const key = this.readKey();
    if (!key) { this.reply('XixuReceiveAI', false, 401, '请先在设置中添加 DeepSeek API Key。'); return false; }
    this.request(payload, key, 'XixuReceiveAI');
    return true;
  }

  analyzeVision(payload: string): boolean {
    if (!payload || payload.length > 44 * 1024 * 1024) { return false; }
    const key = this.readKey();
    if (!key) { this.reply('XixuReceiveTimetableAI', false, 401, '请先在设置中添加 DeepSeek API Key。'); return false; }
    this.request(payload, key, 'XixuReceiveTimetableAI');
    return true;
  }

  testConnection(): boolean {
    const key = this.readKey();
    if (!key) { this.reply('XixuReceiveAITest', false, 401, '请先添加 DeepSeek API Key。'); return false; }
    const payload: string = '{"model":"deepseek-flash","messages":[{"role":"user","content":"Reply with only: Connected."}],"thinking":{"type":"disabled"},"temperature":0,"max_tokens":8,"stream":false}';
    this.request(payload, key, 'XixuReceiveAITest');
    return true;
  }

  private async request(payload: string, key: string, callback: string): Promise<void> {
    const request = http.createHttp();
    try {
      const response = await request.request('https://api.deepseek.com/chat/completions', {
        method: http.RequestMethod.POST,
        header: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        extraData: payload,
        expectDataType: http.HttpDataType.STRING,
        connectTimeout: 20000,
        readTimeout: 45000,
        usingCache: false
      });
      const body = String(response.result);
      const status = Number(response.responseCode);
      this.reply(callback, status >= 200 && status < 300, status, body);
    } catch (_) {
      this.reply(callback, false, 0, '连接失败，请检查网络后重试。');
    } finally { request.destroy(); }
  }
}

class OcrBridge {
  private controller: webview.WebviewController;
  private readonly base64: util.Base64Helper = new util.Base64Helper();
  private initialized: boolean = false;
  private initializing: Promise<boolean> | undefined = undefined;

  constructor(controller: webview.WebviewController) { this.controller = controller; }

  status(): string { return this.initialized ? 'ready' : 'initializing'; }

  initialize(): Promise<boolean> {
    if (this.initialized) { return Promise.resolve(true); }
    if (this.initializing) { return this.initializing; }
    this.initializing = textRecognition.init().then((ready: boolean) => {
      this.initialized = ready;
      this.initializing = undefined;
      return ready;
    }).catch((error: BusinessError) => {
      console.error('Xixu OCR initialization failed: ' + error.code + ' ' + error.message);
      this.initialized = false;
      this.initializing = undefined;
      return false;
    });
    return this.initializing;
  }

  release(): void {
    if (!this.initialized) { return; }
    this.initialized = false;
    textRecognition.release().catch(() => {});
  }

  private reply(ok: boolean, body: string, mode: string, context: string): void {
    const callback: string = mode === 'assessment' ? 'window.XixuReceiveAssessmentOCR' : mode === 'assistant' ? 'window.XixuReceiveAgentOCR' : mode === 'document' ? 'window.XixuReceivePdfOCR' : 'window.XixuReceiveOCR';
    const suffix: string = mode === 'assessment' || mode === 'document' ? ',' + JSON.stringify(context) : '';
    const script = callback + '(' + String(ok) + ',' + JSON.stringify(body) + suffix + ')';
    this.controller.runJavaScript(script).catch(() => {});
  }

  recognize(dataUrl: string): boolean {
    if (!dataUrl || dataUrl.length > 26 * 1024 * 1024 || !dataUrl.startsWith('data:image/')) { return false; }
    const comma = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.slice(0, comma).indexOf(';base64') < 0) { return false; }
    this.run(dataUrl.slice(comma + 1), 'timetable', '');
    return true;
  }

  recognizeAssessment(dataUrl: string, courseId: string): boolean {
    if (!courseId || courseId.length > 100 || !dataUrl || dataUrl.length > 26 * 1024 * 1024 || !dataUrl.startsWith('data:image/')) { return false; }
    const comma: number = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.slice(0, comma).indexOf(';base64') < 0) { return false; }
    this.run(dataUrl.slice(comma + 1), 'assessment', courseId);
    return true;
  }

  recognizeDocumentPage(dataUrl: string, pageNumber: string): boolean {
    if (!/^\d{1,2}$/.test(pageNumber) || !dataUrl || dataUrl.length > 26 * 1024 * 1024 || !dataUrl.startsWith('data:image/')) { return false; }
    const comma: number = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.slice(0, comma).indexOf(';base64') < 0) { return false; }
    this.run(dataUrl.slice(comma + 1), 'document', pageNumber);
    return true;
  }

  recognizeAssistant(dataUrl: string): boolean {
    if (!dataUrl || dataUrl.length > 26 * 1024 * 1024 || !dataUrl.startsWith('data:image/')) { return false; }
    const comma: number = dataUrl.indexOf(',');
    if (comma < 0 || dataUrl.slice(0, comma).indexOf(';base64') < 0) { return false; }
    this.run(dataUrl.slice(comma + 1), 'assistant', '');
    return true;
  }

  private async run(encoded: string, mode: string, context: string): Promise<void> {
    let source: image.ImageSource | undefined = undefined;
    let pixelMap: image.PixelMap | undefined = undefined;
    try {
      if (!await this.initialize()) { throw new Error('文字识别服务暂不可用'); }
      const bytes: Uint8Array = this.base64.decodeSync(encoded);
      const data: ArrayBuffer = bytes.buffer as ArrayBuffer;
      source = image.createImageSource(data);
      pixelMap = await source.createPixelMap();
      const info: image.ImageInfo = pixelMap.getImageInfoSync();
      const result: textRecognition.TextRecognitionResult = await textRecognition.recognizeText(
        { pixelMap: pixelMap }, { isDirectionDetectionSupported: true });
      const body: string = mode === 'assistant' ? result.value : JSON.stringify({
        width: info.size.width,
        height: info.size.height,
        value: result.value,
        blocks: result.blocks
      });
      this.reply(true, body, mode, context);
    } catch (error) {
      const issue: BusinessError = error as BusinessError;
      console.error('Xixu OCR failed: ' + issue.code + ' ' + issue.message);
      this.reply(false, mode === 'assessment' ? '无法读取考核说明，请换一张更清晰的图片或手动填写。' : mode === 'assistant' ? '文字读取不清晰，请换一张图片重试。' : '文字识别未完成，请重新打开汐序后重试；如果仍然失败，请更新手机的屏幕识别服务。', mode, context);
    } finally {
      if (pixelMap) { await pixelMap.release().catch(() => {}); }
      if (source) { await source.release().catch(() => {}); }
    }
  }
}

class ReminderBridge {
  private controller: webview.WebviewController;
  private context: common.UIAbilityContext | undefined = undefined;
  private lastPayload: string = '';
  private generation: number = 0;
  private reminderCount: number = 0;

  constructor(controller: webview.WebviewController) { this.controller = controller; }

  initialize(context: common.UIAbilityContext): void { this.context = context; }

  status(): string {
    let enabled: boolean = false;
    try { enabled = notificationManager.isNotificationEnabledSync(); } catch (_) {}
    return JSON.stringify({ enabled: enabled, count: this.reminderCount });
  }

  enable(): boolean {
    if (!this.context) { return false; }
    this.requestEnable();
    return true;
  }

  sync(payload: string): boolean {
    if (!payload || payload.length > 512 * 1024) { return false; }
    this.lastPayload = payload;
    const token: number = ++this.generation;
    this.run(payload, token);
    return true;
  }

  private reply(state: string, count: number, message: string): void {
    const script = 'window.XixuReceiveReminder(' + JSON.stringify(state) + ',' + String(count) + ',' + JSON.stringify(message) + ')';
    this.controller.runJavaScript(script).catch(() => {});
  }

  private async requestEnable(): Promise<void> {
    try {
      await notificationManager.requestEnableNotification(this.context as common.UIAbilityContext);
      this.reply('syncing', this.reminderCount, '提醒权限已开启，正在安排系统提醒……');
      if (this.lastPayload) {
        const token: number = ++this.generation;
        await this.run(this.lastPayload, token);
      } else {
        this.reply('enabled', 0, '系统提醒已开启。');
      }
    } catch (_) {
      this.reply('disabled', 0, '系统通知未开启，可以前往系统设置允许提醒。');
    }
  }

  private parseDue(task: ReminderTask): Date | undefined {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(task.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(task.time)) { return undefined; }
    const dateParts: string[] = task.date.split('-');
    const timeParts: string[] = task.time.split(':');
    const due: Date = new Date(Number(dateParts[0]), Number(dateParts[1]) - 1, Number(dateParts[2]), Number(timeParts[0]), Number(timeParts[1]), 0, 0);
    return Number.isNaN(due.getTime()) ? undefined : due;
  }

  private collect(payload: ReminderPayload): ScheduledReminder[] {
    const now: number = Date.now() + 30000;
    const dayMs: number = 24 * 60 * 60 * 1000;
    const weekMs: number = 7 * 24 * 60 * 60 * 1000;
    const result: ScheduledReminder[] = [];
    payload.tasks.slice(0, 500).forEach((task: ReminderTask) => {
      if (!task || task.done || task.type === 'task' || !Array.isArray(task.reminders)) { return; }
      const due: Date | undefined = this.parseDue(task);
      if (!due) { return; }
      const dueAt: number = due.getTime();
      const stepMs: number = task.repeat === 'daily' ? dayMs : task.repeat === 'weekly' ? weekMs : 0;
      const firstOccurrence: number = stepMs > 0 ? Math.max(0, Math.floor((Date.now() - dueAt) / stepMs)) : 0;
      const occurrences: number = task.repeat === 'daily' ? 30 : task.repeat === 'weekly' ? 14 : 1;
      for (let index: number = firstOccurrence; index < firstOccurrence + occurrences; index++) {
        const occurrenceAt: number = dueAt + index * stepMs;
        task.reminders.filter((hours: number) => hours === 0 || hours === 1 || hours === 24).forEach((hours: number) => {
          const at: number = occurrenceAt - hours * 60 * 60 * 1000;
          if (at > now) { result.push({ at: at, task: task, hoursBefore: hours }); }
        });
        if (stepMs === 0) { break; }
      }
    });
    result.sort((left: ScheduledReminder, right: ScheduledReminder) => left.at - right.at);
    return result.slice(0, 64);
  }

  private async run(payloadText: string, token: number): Promise<void> {
    try {
      if (!notificationManager.isNotificationEnabledSync()) {
        this.reminderCount = 0;
        this.reply('disabled', 0, 'Allow notifications to see deadline reminders on your lock screen and notification panel.');
        return;
      }
      const payload: ReminderPayload = JSON.parse(payloadText) as ReminderPayload;
      if (!payload || !Array.isArray(payload.tasks)) { throw new Error('bad payload'); }
      const scheduled: ScheduledReminder[] = this.collect(payload);
      await reminderAgentManager.cancelAllReminders();
      if (token !== this.generation) { return; }
      let count: number = 0;
      for (let index: number = 0; index < scheduled.length; index++) {
        if (token !== this.generation) { return; }
        const item: ScheduledReminder = scheduled[index];
        const date: Date = new Date(item.at);
        const before: string = item.hoursBefore === 24 ? '提前 1 天' : item.hoursBefore === 1 ? '提前 1 小时' : '';
        const course: string = item.task.courseName ? ' · ' + item.task.courseName : '';
        const request: reminderAgentManager.ReminderRequestCalendar = {
          reminderType: reminderAgentManager.ReminderType.REMINDER_TYPE_CALENDAR,
          dateTime: {
            year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(),
            hour: date.getHours(), minute: date.getMinutes(), second: 0
          },
          title: item.task.title.slice(0, 100),
          content: item.task.type === 'weekly-wrap' ? (item.task.content || '打开汐序回顾本周。') : before + course + ' · 截止 ' + item.task.date + ' ' + item.task.time,
          expiredContent: item.task.title + ' 即将开始',
          notificationId: 410000 + index,
          groupId: 'xixu-deadlines',
          slotType: notificationManager.SlotType.SERVICE_INFORMATION,
          tapDismissed: true,
          wantAgent: { pkgName: 'com.xixu.planner', abilityName: 'EntryAbility' }
        };
        await reminderAgentManager.publishReminder(request);
        count++;
      }
      if (token !== this.generation) { return; }
      this.reminderCount = count;
      this.reply('enabled', count, count > 0 ? '系统提醒已安排。' : '系统提醒已开启，目前没有需要提醒的事项。');
    } catch (error) {
      if (token !== this.generation) { return; }
      this.reminderCount = 0;
      const code: number = (error as BusinessError).code;
      this.reply(code === 1700001 ? 'disabled' : 'error', 0,
        code === 1700001 ? '请先允许系统通知。' : '暂时无法安排提醒，请稍后重试。');
    }
  }
}

class ClipboardBridge {
  copy(value: string): boolean {
    if (!value || value.length > 64 * 1024) { return false; }
    try {
      const data: pasteboard.PasteData = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, value);
      pasteboard.getSystemPasteboard().setDataSync(data);
      return true;
    } catch (_) { return false; }
  }
}

class BackBridge {
  private callback: (value: boolean) => void;

  constructor(callback: (value: boolean) => void) { this.callback = callback; }

  setCanGoBack(value: boolean): boolean {
    this.callback(Boolean(value));
    return true;
  }
}

class ExternalLinkBridge {
  private context: common.UIAbilityContext | undefined = undefined;

  initialize(context: common.UIAbilityContext): void { this.context = context; }

  open(value: string): boolean {
    const url: string = value.trim();
    const normalized: string = url.toLowerCase();
    if (!this.context || (!normalized.startsWith('https://') && !normalized.startsWith('http://')) || url.length > 4096) { return false; }
    this.context.openLink(url).catch(() => {});
    return true;
  }
}

@Entry
@Component
struct Index {
  @State private canGoBack: boolean = false;
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridgesRegistered: boolean = false;
  private storage: LocalStore = new LocalStore();
  private ai: DeepSeekBridge = new DeepSeekBridge(this.controller);
  private knowledge: KnowledgeBridge = new KnowledgeBridge(this.controller);
  private ocr: OcrBridge = new OcrBridge(this.controller);
  private reminders: ReminderBridge = new ReminderBridge(this.controller);
  private files: SelectedFileBridge = new SelectedFileBridge();
  private archive: NoteArchive = new NoteArchive(this.controller);
  private clipboard: ClipboardBridge = new ClipboardBridge();
  private back: BackBridge = new BackBridge((value: boolean) => { this.canGoBack = value; });
  private browser: ExternalLinkBridge = new ExternalLinkBridge();

  private applyStartupRoute(): void {
    const route: string = consumeStartupRoute();
    if (!route) { return; }
    const script: string = 'window.XixuOpenQuickRecord && window.XixuOpenQuickRecord(' + JSON.stringify(route) + ')';
    this.controller.runJavaScript(script).catch(() => { setStartupRoute(route); });
  }

  private registerNativeBridges(): void {
    if (this.bridgesRegistered) { return; }
    try {
      this.controller.registerJavaScriptProxy(this.storage, 'XixuStore', ['read', 'save', 'cloudStatus']);
      this.controller.registerJavaScriptProxy(this.ai, 'XixuAI', ['hasKey', 'saveKey', 'deleteKey', 'analyze', 'analyzeVision', 'testConnection']);
      this.controller.registerJavaScriptProxy(this.knowledge, 'XixuKnowledge', ['status', 'call', 'disconnect']);
      this.controller.registerJavaScriptProxy(this.ocr, 'XixuOCR', ['status', 'recognize', 'recognizeAssessment', 'recognizeAssistant', 'recognizeDocumentPage']);
      this.controller.registerJavaScriptProxy(this.reminders, 'XixuReminder', ['status', 'enable', 'sync']);
      this.controller.registerJavaScriptProxy(this.files, 'XixuFile', ['begin', 'readChunk', 'finish']);
      this.controller.registerJavaScriptProxy(this.archive, 'XixuArchive', ['status', 'beginWrite', 'writeChunk', 'finishWrite', 'beginRead', 'readChunk', 'close', 'exportFile']);
      this.controller.registerJavaScriptProxy(this.clipboard, 'XixuClipboard', ['copy']);
      this.controller.registerJavaScriptProxy(this.back, 'XixuBack', ['setCanGoBack']);
      this.controller.registerJavaScriptProxy(this.browser, 'XixuBrowser', ['open']);
      this.bridgesRegistered = true;
      // Controller registration becomes visible to JavaScript on the next page load.
      this.controller.refresh();
    } catch (error) {
      const issue: BusinessError = error as BusinessError;
      console.error('Xixu native bridge registration failed: ' + issue.code + ' ' + issue.message);
    }
  }

  onBackPress(): boolean {
    if (!this.canGoBack) { return false; }
    this.controller.runJavaScript('window.XixuHandleSystemBack && window.XixuHandleSystemBack()').catch(() => {});
    return true;
  }

  aboutToAppear(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    this.storage.initialize(context.filesDir, context.cloudFileDir);
    this.archive.initialize(context);
    this.reminders.initialize(context);
    this.browser.initialize(context);
    this.ocr.initialize();
    registerStartupRouteHandler(() => { this.applyStartupRoute(); });
    setTimeout(() => { this.applyStartupRoute(); }, 400);
  }

  aboutToDisappear(): void { unregisterStartupRouteHandler(); this.files.finish(); this.archive.close(); this.ocr.release(); }

  build() {
    Column() {
      Web({ src: $rawfile('index.html'), controller: this.controller })
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .onControllerAttached(() => { this.registerNativeBridges(); })
        .onPageEnd(() => { this.applyStartupRoute(); })
        .onLoadIntercept((event) => {
          return !event.data.getRequestUrl().startsWith('resource://rawfile/');
        })
        .onShowFileSelector((event) => {
          const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
          const documentPicker = new picker.DocumentViewPicker(context);
          const maximum: number = event.fileSelector.getMode() === 1 ? 500 : 1;
          documentPicker.select({ maxSelectNumber: maximum }).then((uris: string[]) => {
            this.files.setSelection(uris);
            event.result.handleFileList(uris);
          }).catch(() => { this.files.setSelection([]); event.result.handleFileList([]); });
          return true;
        })
        .width('100%')
        .height('100%')
    }.width('100%').height('100%').backgroundColor('#EAF2F3')
  }
}
