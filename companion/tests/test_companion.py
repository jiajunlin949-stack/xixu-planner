import base64
import hashlib
import json
import sqlite3
from zipfile import ZipFile

import pytest
from fastapi.testclient import TestClient

from xixu_hub.app import create_app
from xixu_hub.backup import backup
from xixu_hub.chat_exports import parse_chat
from xixu_hub.note_sync import Conflict, NoteSync
from xixu_hub.originals import Originals
from xixu_hub.store import Store
from xixu_hub.vectors import Retriever, ChromaStore, MilvusStore

TOKEN = 'synthetic-owner-token-no-real-credentials-123'
AUTH = {'Authorization': 'Bearer ' + TOKEN}


def encoded(value):
    return json.dumps(value, ensure_ascii=False).encode()


def message(**extra):
    return {'id': 'm-1', 'text': '  下周展示\r\n准备图表🙂  ', 'sender_id': 'speaker-1',
            'sender_name': '测试发言者', 'conversation_id': 'group-1', 'conversation_name': '测试群',
            'timestamp': '2026-10-29T09:00:00+08:00', **extra}


@pytest.mark.parametrize('platform', ['qq', 'dingtalk', 'wechat'])
def test_source_identity_speaker_time_and_original_whitespace(platform):
    content = encoded({'messages': [message()]})
    parsed = parse_chat(platform, '合成.json', content)
    row = parsed['records'][0]
    assert row['text'] == message()['text']
    assert row['metadata']['sender_id'] == 'speaker-1'
    assert row['metadata']['conversation_id'] == 'group-1'
    assert row['metadata']['sent_at'] == '2026-10-29T09:00:00+08:00'
    assert row['metadata']['original_hash'] == hashlib.sha256(content).hexdigest()
    assert row['metadata']['source_type'] == platform


def test_qq_standard_txt_gb18030_multiline_and_group_vs_speaker():
    text = '消息记录（此消息记录为文本格式，不支持重新导入）\r\n消息对象：合成小组\r\n================\r\n2026-10-29 09:12:13 同学甲(100001)\r\n  第一行\r\n第二行\r\n2026-10-29 10:12:13 同学乙(100002)\r\n[图片]\r\n'
    result = parse_chat('qq', '导出.txt', text.encode('gb18030'))
    assert result['messages'] == 2
    assert result['records'][0]['text'] == '  第一行\r\n第二行\r\n'
    assert result['records'][0]['metadata']['sender_name'] == '同学甲'
    assert result['records'][0]['metadata']['conversation_name'] == '合成小组'
    assert result['records'][1]['metadata']['sender_id'] == '100002'
    assert any('附件' in warning for warning in result['warnings'])


def test_dingtalk_event_and_csv():
    value = {'msgId': 'ding-msg', 'text': {'content': '合成会议安排'}, 'senderStaffId': 'staff-1',
             'senderNick': '老师', 'conversationId': 'ding-group', 'conversationTitle': '合成工作组',
             'createTime': 1793235600000}
    row = parse_chat('dingtalk', '事件.json', encoded([value]))['records'][0]
    assert row['text'] == '合成会议安排' and row['metadata']['sender_id'] == 'staff-1'
    assert row['metadata']['sent_at'].endswith('+08:00')
    csv = '消息ID,发送者,会话名称,发送时间,消息内容\r\na,甲,测试群,2026-10-29 09:00:00,"第一行\n第二行"\r\n'
    parsed = parse_chat('dingtalk', '合成.csv', csv.encode('utf-8-sig'))
    assert parsed['records'][0]['text'] == '第一行\n第二行'


def test_unknown_times_not_replaced_by_import_time_and_nontext_not_hidden():
    result = parse_chat('dingtalk', '合成.json', encoded([{'id': 'media', 'msgtype': 'image'}]))
    row = result['records'][0]
    assert 'sent_at' not in row['metadata']
    assert '非文字消息' in row['text'] and len(result['warnings']) >= 2


def test_message_ids_scoped_by_platform_account_conversation():
    rows = []
    for platform, account, conversation in [('qq', 'a', 'g1'), ('qq', 'b', 'g1'), ('qq', 'a', 'g2'), ('dingtalk', 'a', 'g1')]:
        row = parse_chat(platform, 'a.json', encoded([message(conversation_id=conversation)]), account_id=account)['records'][0]
        rows.append(row['source_key'])
    assert len(set(rows)) == 4


@pytest.mark.parametrize('payload', [
    {'api_key': 'do-not-import-as-content'}, {'messages': [message(), message(text='冲突正文')]},
    {'messages': [message(timestamp='不是日期')]}, {'messages': [{'id': 'missing-body'}]},
    {'messages': [message(text={'unsupported': 'never flatten'})]},
])
def test_unsupported_or_conflicting_exports_fail_whole_parse(payload):
    with pytest.raises(ValueError):
        parse_chat('qq', '合成.json', encoded(payload))


def test_derived_ids_preserve_identical_repeated_messages():
    value = message(id='')
    result = parse_chat('qq', '合成.json', encoded([value, value]))
    assert len({row['source_key'] for row in result['records']}) == 2


def test_canonical_batch_rollback(tmp_path):
    store = Store(tmp_path / 'db.sqlite3')
    store.upsert('keep', '现有', '保留旧记录')
    with pytest.raises(sqlite3.IntegrityError):
        store.upsert_many([{'source_key': 'first', 'title': '先验证', 'text': '不应半写入'},
                           {'source_key': 'invalid', 'title': None, 'text': '失败'}])
    assert store.stats()['documents'] == 1
    assert store.lexical('半写入') == []


def test_preview_confirm_replay_raw_original_and_read_only_device(tmp_path):
    app = create_app(tmp_path, token=TOKEN)
    with TestClient(app) as client:
        raw = encoded([message()])
        response = client.post('/v1/imports/chat/preview', headers=AUTH, data={'platform': 'qq'}, files={'file': ('合成.json', raw, 'application/json')})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert app.state.store.stats()['documents'] == 0 and not preview['committed']
        assert client.get('/v1/originals/' + preview['original_hash'], headers=AUTH).content == raw
        body = {'ticket': preview['ticket'], 'original_hash': '0' * 64}
        assert client.post('/v1/imports/chat/confirm', headers=AUTH, json=body).status_code == 409
        assert app.state.store.stats()['documents'] == 0
        body['original_hash'] = preview['original_hash']
        first = client.post('/v1/imports/chat/confirm', headers=AUTH, json=body)
        assert first.status_code == 200, first.text
        assert first.json()['changed'] == 1
        assert client.post('/v1/imports/chat/confirm', headers=AUTH, json=body).json() == first.json()
        assert app.state.store.stats()['documents'] == 1
        code = client.post('/v1/devices/code', headers=AUTH, json={}).json()['code']
        paired = client.post('/v1/devices/pair', json={'code': code}).json()
        device = {'Authorization': 'Bearer ' + paired['token']}
        assert client.post('/v1/imports/chat/confirm', headers=device, json=body).status_code == 403
        results = client.post('/v1/search', headers=device, json={'query': '展示'}).json()['results']
        assert results[0]['metadata']['sender_name'] == '测试发言者'
        assert results[0]['metadata']['sent_at'] == '2026-10-29T09:00:00+08:00'
        assert client.delete('/v1/devices/' + paired['device_id'], headers=AUTH).status_code == 200
        assert client.get('/v1/health', headers=device).status_code == 401


def test_notes_mode_does_not_ingest_chats_and_auth_before_body(tmp_path):
    with TestClient(create_app(tmp_path, token=TOKEN, mode='notes')) as client:
        assert client.post('/v1/imports/chat/preview', data={'platform': 'qq'}, files={'file': ('x.json', b'[]')}).status_code == 401
        assert client.post('/v1/imports/chat/preview', headers=AUTH, data={'platform': 'qq'}, files={'file': ('x.json', b'[]')}).status_code == 409
        invalid = client.post('/v1/search', headers=AUTH, json={'query': 'x', 'secret': 'do-not-echo-this'})
        assert invalid.status_code == 422 and 'do-not-echo-this' not in invalid.text


def send_note(sync, owner, session, note, chunk_size=31):
    content = encoded(note)
    parts = (len(content) + chunk_size - 1) // chunk_size
    for part in range(parts):
        data = base64.b64encode(content[part * chunk_size:(part + 1) * chunk_size]).decode()
        sync.note_part(owner, session, note['id'], part, parts, data)


def sync_fixture(tmp_path):
    store, originals = Store(tmp_path / 'db.sqlite3'), Originals(tmp_path / 'originals')
    return store, originals, NoteSync(store, originals)


def note(**extra):
    return {'id': 'n-1', 'title': '合成笔记', 'text': '  原文\r\n🙂不截断  ', 'images': [],
            'createdAt': '', 'updatedAt': '2026-10-29T01:00:00.000Z', 'importedAt': '2026-10-29T02:00:00.000Z', **extra}


def test_snapshot_unicode_chunks_timestamps_replay_and_delete_isolation(tmp_path):
    store, originals, sync = sync_fixture(tmp_path)
    store.upsert('chat:keep', '聊天资料', '不得删除')
    session = sync.begin('deviceA', 1)['session']
    send_note(sync, 'deviceA', session, note(), chunk_size=19)
    assert store.stats()['documents'] == 1
    result = sync.commit('deviceA', session)
    assert result['notes'] == 1 and sync.commit('deviceA', session) == result
    row = next(row for row in store.documents() if row['source_key'].startswith('phone:'))
    metadata = json.loads(row['metadata'])
    assert metadata['note']['text'] == note()['text']
    assert metadata['source_created_at'] == ''
    assert metadata['source_updated_at'] == note()['updatedAt']
    assert row['updated_at'] != metadata['source_updated_at']
    second = sync.begin('deviceB', 1)['session']
    send_note(sync, 'deviceB', second, note())
    sync.commit('deviceB', second)
    removed = sync.begin('deviceA', 0, result['revision'], allow_deletions=True)['session']
    assert sync.commit('deviceA', removed)['removed'] == 1
    assert store.stats()['documents'] == 2
    assert any(row['source_key'].startswith('phone:deviceB:') for row in store.documents())


def test_snapshot_missing_asset_mismatch_and_recovery(tmp_path):
    store, originals, sync = sync_fixture(tmp_path)
    raw = b'synthetic image bytes'
    key = hashlib.sha256(raw).hexdigest()
    value = note(images=[{'hash': key, 'bytes': len(raw), 'name': '合成.png', 'type': 'image/png'}])
    session = sync.begin('deviceA', 1)['session']
    send_note(sync, 'deviceA', session, value)
    with pytest.raises(ValueError, match='缺少'):
        sync.commit('deviceA', session)
    assert store.stats()['documents'] == 0
    with pytest.raises(ValueError):
        sync.asset_part('deviceA', session, '0' * 64, 0, len(raw), base64.b64encode(raw).decode())
    assert store.stats()['documents'] == 0
    result = sync.asset_part('deviceA', session, key, 0, len(raw), base64.b64encode(raw).decode())
    assert result['complete']
    assert sync.commit('deviceA', session)['originals_verified']
    assert originals.read(key) == raw


def test_snapshot_conflicts_and_cross_device_stage_access(tmp_path):
    store, originals, sync = sync_fixture(tmp_path)
    a = sync.begin('deviceA', 1)['session']
    b = sync.begin('deviceA', 1)['session']
    send_note(sync, 'deviceA', a, note(text='第一批'))
    send_note(sync, 'deviceA', b, note(text='冲突批次'))
    sync.commit('deviceA', a)
    with pytest.raises(Conflict):
        sync.commit('deviceA', b)
    with pytest.raises(ValueError):
        sync.load('deviceB', a)
    assert store.stats()['documents'] == 1
    with pytest.raises(Conflict):
        sync.begin('deviceA', 0, '')


def test_snapshot_update_replaces_current_text_and_default_no_deletion(tmp_path):
    store, originals, sync = sync_fixture(tmp_path)
    a = sync.begin('d', 1)['session']
    send_note(sync, 'd', a, note(text='旧正文'))
    first = sync.commit('d', a)
    old_ids = set(store.lexical('旧正文'))
    b = sync.begin('d', 1, first['revision'])['session']
    send_note(sync, 'd', b, note(text='新正文'))
    second = sync.commit('d', b)
    # BM25's OR terms may legitimately match “正文” in the updated text.
    # The old chunk IDs/text must be gone, even when part of the query overlaps.
    assert second['changed'] == 1 and not old_ids.intersection(store.lexical('旧正文'))
    assert all(row['text'] == '新正文' for row in store.resolve(store.lexical('正文')).values())
    c = sync.begin('d', 0, second['revision'])['session']
    assert sync.commit('d', c)['removed'] == 0 and store.stats()['documents'] == 1


def test_full_backup_originals_and_existing_destination_protection(tmp_path):
    store, originals, sync = sync_fixture(tmp_path / 'service')
    raw = b'full original export bytes'
    key = originals.put(raw)
    store.upsert('file:1', '合成资料', '正文', {'original_hash': key, 'source_updated_at': '2026-10-29T01:00:00Z'})
    destination = tmp_path / 'complete.zip'
    assert backup(store, originals, destination)['originals'] == 1
    with ZipFile(destination) as archive:
        assert archive.read('originals/' + key) == raw
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['documents'][0]['metadata']['source_updated_at'] == '2026-10-29T01:00:00Z'
    before = destination.read_bytes()
    with pytest.raises(ValueError):
        backup(store, originals, destination)
    assert destination.read_bytes() == before


class Model:
    def passage_embed(self, texts):
        return iter([[1.0] + [0.0] * 511 for _ in texts])
    def query_embed(self, query):
        return iter([[1.0] + [0.0] * 511])


class Index:
    def __init__(self, key):
        self.key, self.rows, self.fail = key, {}, False
    def upsert(self, rows):
        if self.fail:
            raise RuntimeError('synthetic failure')
        self.rows.update({r['id']: r for r in rows})
    def delete(self, ids):
        for key in ids:
            self.rows.pop(key, None)
    def search(self, vector, limit):
        return list(self.rows)[:limit]


def test_backend_switch_stale_hits_and_failed_index_keep_authoritative_text(tmp_path):
    store = Store(tmp_path / 'db.sqlite3')
    record = store.upsert('note:1', '合成笔记', '旧正文')
    a, b = Index('a'), Index('b')
    first = Retriever(store, tmp_path, True, vector_store=a, model=Model())
    second = Retriever(store, tmp_path, True, backend='chroma', vector_store=b, model=Model())
    assert first.sync()['indexed_documents'] == 1
    assert second.sync()['indexed_documents'] == 1 and b.rows
    stale = dict(a.rows)
    store.upsert('note:1', '合成笔记', '新正文')
    a.fail = True
    assert first.sync().get('error')
    assert '旧正文' not in json.dumps(first.search('旧正文'), ensure_ascii=False)
    assert first.search('新正文')['results'][0]['text'] == '新正文'
    a.fail = False
    assert first.sync()['indexed_documents'] == 1
    assert not set(stale) & set(a.rows)
    store.delete(record['document_id'])
    assert first.search('旧正文')['results'] == []


def test_real_chroma_persistence_explicit_embeddings_and_delete(tmp_path):
    pytest.importorskip('chromadb')
    index = ChromaStore(tmp_path / 'chroma')
    row = {'id': 'f' * 64, 'vector': [1.0] + [0.0] * 511, 'text': '合成向量存储夹具', 'source_type': 'qq'}
    index.upsert([row])
    reopened = ChromaStore(tmp_path / 'chroma')
    assert reopened.search(row['vector'], 6) == [row['id']]
    reopened.delete([row['id']])
    assert reopened.search(row['vector'], 6) == []


def test_milvus_adapter_sdk_contract_and_vector_validation():
    class Client:
        def __init__(self):
            self.rows, self.created = {}, None
        def has_collection(self, name):
            assert name == 'synthetic_collection'
            return self.created is not None
        def create_collection(self, name, **kwargs):
            self.created = kwargs
        def upsert(self, name, data):
            self.rows.update({row['id']: row for row in data})
        def search(self, name, data, **kwargs):
            assert len(data[0]) == 512 and kwargs['search_params']['metric_type'] == 'COSINE'
            return [[{'id': key} for key in self.rows]]
        def delete(self, name, ids):
            for key in ids:
                self.rows.pop(key, None)
    client = Client()
    index = MilvusStore(client=client, collection='synthetic_collection')
    vector = [1.0] + [0.0] * 511
    index.upsert([{'id': 'a' * 64, 'vector': vector, 'text': '合成正文', 'sender_name': '合成发言者'}])
    assert client.created['dimension'] == 512 and client.created['id_type'] == 'string'
    assert index.search(vector, 6) == ['a' * 64]
    assert client.rows['a' * 64]['sender_name'] == '合成发言者'
    with pytest.raises(ValueError):
        index.upsert([{'id': 'b' * 64, 'vector': [1.0]}])
    index.delete(['a' * 64])
    assert index.search(vector, 6) == []


def test_note_api_complete_chunk_contract_and_excerpt_version_guard(tmp_path):
    app = create_app(tmp_path, token=TOKEN)
    with TestClient(app) as client:
        code = client.post('/v1/devices/code', headers=AUTH, json={}).json()['code']
        device = client.post('/v1/devices/pair', json={'code': code}).json()
        auth = {'Authorization': 'Bearer ' + device['token']}
        assert client.get('/v1/notes/status', headers=auth).json() == {'revision': '', 'notes': 0}
        session = client.post('/v1/notes/begin', headers=auth, json={'count': 1, 'revision': ''}).json()['session']
        content = encoded(note())
        result = client.post('/v1/notes/part', headers=auth, json={'session': session, 'note_id': 'n-1', 'part': 0, 'parts': 1, 'data': base64.b64encode(content).decode()})
        assert result.status_code == 200, result.text
        assert app.state.store.stats()['documents'] == 0
        committed = client.post('/v1/notes/commit', headers=auth, json={'session': session})
        assert committed.status_code == 200 and committed.json()['notes'] == 1
        sources = client.post('/v1/search', headers=auth, json={'query': '原文'}).json()['results']
        assert sources[0]['metadata']['source_updated_at'] == note()['updatedAt']
        assert 'note' not in sources[0]['metadata']
        assert len(json.dumps(sources)) < 15000
        source = sources[0]
        excerpt = client.get('/v1/sources/' + source['document_id'] + '/excerpt', headers=auth,
                             params={'version': source['version'], 'start': source['start'], 'end': source['end']})
        assert excerpt.json()['text'] == note()['text']
        assert client.get('/v1/sources/' + source['document_id'] + '/excerpt', headers=auth,
                          params={'version': '0' * 64, 'start': 0, 'end': 5}).status_code == 422


