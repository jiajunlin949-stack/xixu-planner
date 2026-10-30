"""Personal companion API. No account scraping or private corpus is bundled."""
import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, UploadFile, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from .chat_exports import parse_chat
from .config import Settings
from .models import ModelClient, ModelError, validate_endpoint
from .note_sync import Conflict, NoteSync
from .originals import Originals, MAX_FILE, MAX_CHAT_FILE
from .security import Devices
from .store import Store
from .vectors import Retriever
from .intelligence import Suggestions, tool_manifest
from .privacy import Approvals, RedactionPolicy
from .telemetry import Telemetry
from .search_tools import WebSearch


class Body(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Search(Body):
    query: str = Field(min_length=1, max_length=2000)
    limit: int = Field(default=6, ge=1, le=12)


class PublicWebSearch(Search):
    approved: Literal[True]


class PrivacyTerms(Body):
    terms: list[str] = Field(default_factory=list, max_length=500)


class WebSearchSettings(Body):
    enabled: bool = False
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False


class Chat(Search):
    conversation_id: str = Field(default='', max_length=100)
    local_context: list[str] = Field(default_factory=list, max_length=2)


class Pair(Body):
    code: str = Field(pattern=r'^\d{8}$')
    name: str = Field(default='汐序手机', min_length=1, max_length=80)


class Begin(Body):
    count: int = Field(ge=0, le=5000)
    revision: str = Field(default='', max_length=64)
    allow_deletions: bool = False


class Session(Body):
    session: str = Field(pattern=r'^[a-f0-9]{32}$')


class NotePart(Session):
    note_id: str = Field(min_length=1, max_length=128)
    part: int = Field(ge=0, le=1023)
    parts: int = Field(ge=1, le=1024)
    data: str = Field(min_length=1, max_length=262144)


class AssetPart(Session):
    hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    offset: int = Field(ge=0, le=MAX_FILE)
    total: int = Field(ge=1, le=MAX_FILE)
    data: str = Field(min_length=1, max_length=262144)


class ConfirmImport(Body):
    ticket: str = Field(pattern=r'^[a-f0-9]{32}$')
    original_hash: str = Field(pattern=r'^[a-f0-9]{64}$')


class ModelSettings(Body):
    provider: Literal['qwen', 'deepseek', 'kimi', 'doubao', 'openai', 'gemini', 'claude', 'custom']
    model: str = Field(min_length=1, max_length=150)
    base_url: str = Field(max_length=500)
    api: Literal['chat', 'responses', 'messages'] = 'chat'
    api_key: str | None = Field(default=None, max_length=500)
    clear_key: bool = False
    max_output_tokens: int = Field(default=1800, ge=256, le=4096)
    capabilities: dict[str, bool] = Field(default_factory=lambda: {'stream': True, 'structured': False, 'vision': False, 'tools': False, 'reasoning': False})
    output_token_field: Literal['max_tokens', 'max_completion_tokens'] = 'max_tokens'


class ApprovedSource(Body):
    index: int = Field(ge=1, le=12)
    text: str = Field(max_length=5000)


class CloudApproval(Body):
    ticket: str = Field(pattern=r'^[a-f0-9]{32}$')
    question: str = Field(min_length=1, max_length=2000)
    sources: list[ApprovedSource] = Field(default_factory=list, max_length=12)
    local_context: list[str] = Field(default_factory=list, max_length=2)


def owner_token(directory):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / 'access.token'
    try:
        with path.open('x', encoding='utf-8') as stream:
            stream.write(secrets.token_urlsafe(36))
    except FileExistsError:
        pass
    value = path.read_text('utf-8').strip()
    if len(value) < 32:
        raise RuntimeError('本机管理密钥文件无效。')
    return value


def create_app(data_dir=None, *, token=None, mode='extended', backend='milvus', semantic=False, device_only=False):
    if mode not in ('notes', 'extended'):
        raise ValueError('模式须为 notes 或 extended。')
    directory = Path(data_dir or os.getenv('XIXU_DATA_DIR', Path(__file__).resolve().parents[1] / 'data'))
    store = Store(directory / 'knowledge.sqlite3')
    devices = Devices(store, token or owner_token(directory))
    settings = Settings(directory)
    originals = Originals(directory / 'originals')
    sync = NoteSync(store, originals)
    retriever = Retriever(store, directory / 'models', semantic, backend)
    model = ModelClient(settings)
    redaction = RedactionPolicy(directory)
    web_search = WebSearch(directory, settings.vault, redaction.apply)
    approvals, suggestions, telemetry = Approvals(store, redaction.apply), Suggestions(store), Telemetry(store)
    app = FastAPI(title='汐序个人知识库', version='0.3.0', docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store, app.state.devices, app.state.sync = store, devices, sync
    app.state.originals, app.state.retriever, app.state.model = originals, retriever, model
    tickets, import_lock = {}, threading.RLock()

    @app.middleware('http')
    async def guard(request, call_next):
        if request.url.path.startswith('/v1/'):
            if request.url.path != '/v1/devices/pair':
                principal = devices.authenticate(request.headers.get('authorization', ''))
                if not principal or (device_only and principal['role'] == 'owner'):
                    return JSONResponse({'detail': '请先连接知识库。'}, 401)
            if request.method in ('POST', 'PUT'):
                length = request.headers.get('content-length', '')
                if not length.isdigit():
                    return JSONResponse({'detail': '请提供完整请求长度。'}, 411)
                maximum = MAX_CHAT_FILE + 65536 if request.url.path == '/v1/imports/chat/preview' else 300000
                if int(length) > maximum:
                    return JSONResponse({'detail': '请求超出本接口容量。'}, 413)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse({'detail': '请求字段不完整或超出支持范围；未返回输入内容。'}, 422)

    @app.exception_handler(ValueError)
    async def invalid_value(request, error):
        return JSONResponse({'detail': str(error)}, 409 if isinstance(error, Conflict) else 422)

    def authenticated(authorization: str = Header(default='')):
        principal = devices.authenticate(authorization)
        if not principal or (device_only and principal['role'] == 'owner'):
            raise HTTPException(401, '配对已失效。')
        return principal

    def owner(principal=Depends(authenticated)):
        if principal['role'] != 'owner':
            raise HTTPException(403, '此操作只允许电脑端管理员。')
        return principal

    @app.get('/')
    def index():
        return FileResponse(Path(__file__).resolve().parents[1] / 'web' / 'index.html')

    @app.get('/app.js')
    def javascript():
        return FileResponse(Path(__file__).resolve().parents[1] / 'web' / 'app.js', media_type='application/javascript')

    @app.get('/style.css')
    def css():
        return FileResponse(Path(__file__).resolve().parents[1] / 'web' / 'style.css', media_type='text/css')

    @app.get('/v1/health', dependencies=[Depends(authenticated)])
    def health():
        return {**store.stats(), 'mode': mode, 'vector_backend': backend, 'semantic_enabled': semantic,
                'web_search': web_search.public(), 'reranker': retriever.reranker.public(),
                'notes_sync': True, 'notes_sync_version': 1, 'answer_model_configured': bool(settings.vault.get('model:' + settings.read()['provider'])),
                'chat_import': mode == 'extended', 'notice': '此状态不代表向量索引已完成或平台全部历史已同步。'}

    @app.post('/v1/devices/code', dependencies=[Depends(owner)])
    def code():
        from .tls import pairing_bundle
        value, expires = devices.code()
        return {'code': value, 'expires_at': expires, 'bundle': pairing_bundle(directory, value)}

    @app.post('/v1/devices/pair')
    def pair(body: Pair):
        result = devices.pair(body.code, body.name)
        if not result:
            raise HTTPException(403, '配对码失效或尝试次数已用完，请在电脑重新生成。')
        return {**result, 'permissions': [*result['permissions'], 'sync_own_notes']}

    @app.get('/v1/devices', dependencies=[Depends(owner)])
    def list_devices():
        with store.connection() as db:
            return {'devices': [dict(row) for row in db.execute('SELECT id,name,created_at,revoked FROM devices')]}

    @app.delete('/v1/devices/{device_id}', dependencies=[Depends(owner)])
    def revoke(device_id: str):
        with store.connection() as db:
            db.execute('UPDATE devices SET revoked=1 WHERE id=?', (device_id,))
        return {'revoked': True}

    @app.get('/v1/settings/privacy', dependencies=[Depends(owner)])
    def privacy_terms():
        return {'terms': redaction.terms()}

    @app.put('/v1/settings/privacy', dependencies=[Depends(owner)])
    def save_privacy_terms(body: PrivacyTerms):
        return redaction.save(body.terms)

    @app.get('/v1/settings/web-search', dependencies=[Depends(owner)])
    def web_search_settings():
        return web_search.public()

    @app.put('/v1/settings/web-search', dependencies=[Depends(owner)])
    def save_web_search(body: WebSearchSettings):
        return web_search.save(body.enabled, body.api_key, body.clear_key)

    @app.post('/v1/tools/search-web')
    async def search_web(body: PublicWebSearch, principal=Depends(authenticated)):
        started = time.monotonic()
        result = await web_search.search(body.query, body.limit)
        telemetry.record('public-web-search', started, len(result['results']), confirmed=True)
        return result

    @app.post('/v1/search')
    def search(body: Search, principal=Depends(authenticated)):
        if not body.query.strip():
            raise ValueError('问题不能为空。')
        started = time.monotonic()
        result = retriever.search(body.query, body.limit)
        telemetry.record(result['strategy'], started, len(result['results']))
        return result

    @app.get('/v1/sources/{document_id}/excerpt')
    def excerpt(document_id: str, version: str, start: int, end: int, principal=Depends(authenticated)):
        if start < 0 or end <= start or end - start > 10000:
            raise ValueError('引用范围无效。')
        try:
            return store.excerpt(document_id, version, start, end)
        except KeyError as exc:
            raise HTTPException(404, '原资料不存在或已移除。') from exc

    @app.post('/v1/chat')
    async def chat(body: Chat, principal=Depends(authenticated)):
        if not body.query.strip() or sum(len(value) for value in body.local_context) > 5000:
            raise ValueError('本机临时上下文超出范围。')
        result = await run_in_threadpool(retriever.search, body.query, body.limit)
        sources = result['results']
        # Backwards-compatible read-only endpoint. Never bypass outbound approval.
        return {'answer': f'找到 {len(sources)} 个相关片段，可展开来源核对。' if sources else '暂未找到相关资料。',
                'answer_generated': False, 'sources': sources, 'warning': result['warning'], 'temporal': result['temporal'], 'requires_approval': True}

    @app.post('/v1/chat/prepare')
    async def prepare_chat(body: Chat, principal=Depends(authenticated)):
        if not body.query.strip() or sum(len(value) for value in body.local_context) > 5000:
            raise ValueError('本机上下文超出范围。')
        result = await run_in_threadpool(retriever.search, body.query, body.limit)
        prepared = approvals.prepare(principal['id'], settings.public(), body.query, result['results'], body.local_context, result['temporal'])
        return {**prepared, 'source_refs': result['results'], 'model_configured': settings.public()['key_configured'], 'answer_generated': False}

    def consume_approval(body, principal):
        try:
            return approvals.consume(principal['id'], settings.public(), body.ticket, body.question, [item.model_dump() for item in body.sources], body.local_context)
        except KeyError as exc:
            raise HTTPException(409, '来源已经变化，请重新检索并核对。') from exc

    @app.post('/v1/chat/confirm')
    async def confirm_chat(body: CloudApproval, principal=Depends(authenticated)):
        prompt, sources = consume_approval(body, principal)
        started = time.monotonic()
        try:
            text, usage = await model.complete(prompt)
        except ModelError as exc:
            telemetry.record('cloud', started, len(sources), True, 'failed')
            raise HTTPException(409, str(exc)) from exc
        telemetry.record('cloud', started, len(sources), True)
        return {'answer': text, 'answer_generated': True, 'sources': sources, 'usage': usage}

    @app.post('/v1/chat/stream')
    async def stream_chat(body: CloudApproval, request: Request, principal=Depends(authenticated)):
        prompt, sources = consume_approval(body, principal)
        async def events():
            started, outcome = time.monotonic(), 'cancelled'
            try:
                yield 'data: ' + json.dumps({'type': 'sources', 'sources': sources}, ensure_ascii=False) + '\n\n'
                async for event in model.stream(prompt):
                    if await request.is_disconnected():
                        return
                    if event['type'] == 'done':
                        outcome = 'completed'
                    yield 'data: ' + json.dumps(event, ensure_ascii=False) + '\n\n'
            except ModelError as exc:
                outcome = 'failed'
                yield 'data: ' + json.dumps({'type': 'error', 'message': str(exc)}, ensure_ascii=False) + '\n\n'
            finally:
                telemetry.record('cloud-stream', started, len(sources), True, outcome)
        return StreamingResponse(events(), media_type='text/event-stream', headers={'X-Accel-Buffering': 'no'})

    @app.get('/v1/suggestions', dependencies=[Depends(authenticated)])
    def pending_suggestions():
        return {'suggestions': suggestions.pending(), 'writes_performed': False}

    @app.get('/v1/tools', dependencies=[Depends(authenticated)])
    def tools():
        return {**tool_manifest(), 'remote_execution': False, 'notice': '这是工具目录，不是 MCP 服务；写入只在手机核对后执行。'}

    @app.get('/v1/telemetry', dependencies=[Depends(owner)])
    def traces():
        return {'traces': telemetry.recent()}

    @app.get('/v1/settings/model', dependencies=[Depends(owner)])
    def model_settings():
        return settings.public()

    @app.put('/v1/settings/model', dependencies=[Depends(owner)])
    def set_model(body: ModelSettings):
        endpoint = validate_endpoint(body.base_url)
        previous = settings.read()
        old = previous if previous['provider'] == body.provider else previous.get('profiles', {}).get(body.provider, {})
        if settings.vault.get('model:' + body.provider) and endpoint != old.get('base_url') and not body.clear_key and not (body.api_key and body.api_key.strip()):
            raise ValueError('更换模型接口地址时请重新填写密钥，原密钥不会自动发往新地址。')
        if body.clear_key:
            settings.vault.set('model:' + body.provider, '')
        elif body.api_key is not None and body.api_key.strip():
            settings.vault.set('model:' + body.provider, body.api_key.strip())
        settings.save({'provider': body.provider, 'model': body.model.strip(), 'base_url': endpoint,
                       'api': body.api, 'max_output_tokens': body.max_output_tokens, 'capabilities': body.capabilities,
                       'output_token_field': body.output_token_field, 'revision': uuid.uuid4().hex})
        return settings.public()

    @app.get('/v1/notes/status')
    def note_status(principal=Depends(authenticated)):
        return sync.status(principal['id'])

    @app.post('/v1/notes/begin')
    def begin_notes(body: Begin, principal=Depends(authenticated)):
        return sync.begin(principal['id'], body.count, body.revision, body.allow_deletions)

    @app.post('/v1/notes/part')
    def note_part(body: NotePart, principal=Depends(authenticated)):
        return sync.note_part(principal['id'], body.session, body.note_id, body.part, body.parts, body.data)

    @app.post('/v1/notes/asset')
    def asset_part(body: AssetPart, principal=Depends(authenticated)):
        return sync.asset_part(principal['id'], body.session, body.hash, body.offset, body.total, body.data)

    @app.post('/v1/notes/commit')
    def commit_notes(body: Session, tasks: BackgroundTasks, principal=Depends(authenticated)):
        result = sync.commit(principal['id'], body.session)
        tasks.add_task(retriever.sync)
        return result

    @app.post('/v1/index', dependencies=[Depends(owner)])
    def index_now():
        return retriever.sync()

    @app.post('/v1/imports/chat/preview', dependencies=[Depends(owner)])
    async def preview(platform: str = Form(), file: UploadFile = File(), conversation_name: str = Form(default=''), account_id: str = Form(default='')):
        if mode != 'extended':
            raise HTTPException(409, '当前为纯备忘录服务模式，未启用聊天资料导入。')
        if len(conversation_name) > 200 or len(account_id) > 200:
            raise ValueError('来源名称过长。')
        content = await file.read(MAX_CHAT_FILE + 1)
        if not content or len(content) > MAX_CHAT_FILE:
            raise ValueError('聊天文件须为 1 字节至 20 MiB。')
        parsed = await run_in_threadpool(parse_chat, platform, file.filename or '', content,
                                        conversation_name=conversation_name, account_id=account_id)
        key = originals.put(content)
        ticket = uuid.uuid4().hex
        with import_lock:
            for old in [item for item, value in tickets.items() if value['expires'] < time.time()]:
                tickets.pop(old)
            if len(tickets) >= 20:
                raise HTTPException(429, '待核对批次较多，请先确认或取消旧批次。')
            tickets[ticket] = {'key': key, 'name': file.filename, 'platform': platform, 'conversation_name': conversation_name,
                               'account_id': account_id, 'expires': time.time() + 1800}
        return {'ticket': ticket, 'original_hash': key, 'messages': parsed['messages'], 'warnings': parsed['warnings'],
                'notice': parsed['notice'], 'preview': [{'title': row['title'], 'text': row['text'][:500],
                    'sender': row['metadata']['sender_name'], 'sent_at': row['metadata'].get('sent_at', '')} for row in parsed['records'][:10]],
                'preview_truncated': len(parsed['records']) > 10, 'committed': False}

    @app.post('/v1/imports/chat/confirm', dependencies=[Depends(owner)])
    def confirm(body: ConfirmImport, tasks: BackgroundTasks):
        with import_lock:
            ticket = tickets.get(body.ticket)
            if not ticket or ticket['expires'] < time.time() or ticket['key'] != body.original_hash:
                raise Conflict('核对批次已失效或原件不一致，请重新预览。')
            if ticket.get('result'):
                return ticket['result']
            parsed = parse_chat(ticket['platform'], ticket['name'], originals.read(ticket['key']),
                                conversation_name=ticket['conversation_name'], account_id=ticket['account_id'])
            results = store.upsert_many(parsed['records'])
            result = {'messages': len(results), 'changed': sum(row['changed'] for row in results),
                      'original_hash': ticket['key'], 'warnings': parsed['warnings'], 'committed': True}
            ticket['result'] = result
        tasks.add_task(retriever.sync)
        tasks.add_task(suggestions.analyze, parsed['records'])
        return result

    @app.get('/v1/originals/{key}', dependencies=[Depends(owner)])
    def original(key: str):
        if not originals.path(key).is_file():
            raise HTTPException(404, '原件不存在。')
        originals.verify(key)
        return FileResponse(originals.path(key), filename=key + '.original', media_type='application/octet-stream')

    return app
