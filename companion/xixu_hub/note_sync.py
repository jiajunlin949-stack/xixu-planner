"""Explicit, revision-checked phone note snapshots with verified original assets."""
import base64
import hashlib
import json
import os
import re
import threading
import time
import uuid

from .originals import HASH, MAX_FILE
from .store import digest


class Conflict(ValueError):
    pass


class NoteSync:
    def __init__(self, store, originals):
        self.store, self.originals = store, originals
        self.directory = store.path.parent / 'staging'
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with store.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS note_snapshots(owner TEXT PRIMARY KEY,revision TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS note_commits(session TEXT PRIMARY KEY,owner TEXT NOT NULL,result TEXT NOT NULL)')

    def status(self, owner):
        with self.store.connection() as db:
            row = db.execute('SELECT revision FROM note_snapshots WHERE owner=?', (owner,)).fetchone()
            count = db.execute('SELECT count(*) FROM documents WHERE source_key LIKE ?', ('phone:' + owner + ':%',)).fetchone()[0]
        return {'revision': row[0] if row else '', 'notes': count}

    def begin(self, owner, count, revision='', allow_deletions=False):
        if not 0 <= count <= 5000:
            raise ValueError('同步笔记条数超限。')
        if self.status(owner)['revision'] != revision:
            raise Conflict('电脑笔记快照已经变化，请重新核对后同步。')
        session = uuid.uuid4().hex
        folder = self.directory / session
        folder.mkdir()
        self.save(folder, {'owner': owner, 'count': count, 'revision': revision, 'allow_deletions': allow_deletions,
                           'expires': time.time() + 3600, 'notes': {}, 'assets': {}, 'received_bytes': 0})
        return {'session': session, 'note_count': count}

    def save(self, folder, state):
        temporary = folder / 'manifest.tmp'
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(state, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(folder / 'manifest.json')

    def load(self, owner, session):
        if not re.fullmatch(r'[a-f0-9]{32}', session):
            raise ValueError('同步会话编号无效。')
        folder = self.directory / session
        try:
            state = json.loads((folder / 'manifest.json').read_text('utf-8'))
        except (OSError, ValueError) as exc:
            raise ValueError('同步会话不存在，请重新开始。') from exc
        if state['owner'] != owner:
            raise ValueError('此同步会话不属于当前设备。')
        if state['expires'] < time.time():
            raise ValueError('同步暂存已过期，原备忘录未受影响，请重新开始。')
        return folder, state

    @staticmethod
    def decode(value):
        try:
            content = base64.b64decode(value, validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError('同步分块编码无效。') from exc
        if not content or len(content) > 192 * 1024:
            raise ValueError('同步分块过大或为空。')
        return content

    def note_part(self, owner, session, note_id, part, parts, data):
        if not isinstance(note_id, str) or not 1 <= len(note_id) <= 128 or not 1 <= parts <= 1024 or not 0 <= part < parts:
            raise ValueError('笔记分块编号无效。')
        content = self.decode(data)
        with self.lock:
            folder, state = self.load(owner, session)
            key = digest(note_id)
            info = state['notes'].get(key)
            if info is None:
                if len(state['notes']) >= state['count']:
                    raise ValueError('收到的笔记条数超出确认范围。')
                info = state['notes'][key] = {'id': note_id, 'parts': parts, 'received': {}, 'bytes': 0}
            if info['parts'] != parts:
                raise Conflict('笔记分块总数发生变化，请重新同步。')
            path = folder / ('note-' + key + '-' + str(part))
            if str(part) in info['received']:
                if path.read_bytes() != content:
                    raise Conflict('同一笔记分块内容发生变化。')
                return {'received': True, 'replayed': True}
            if info['bytes'] + len(content) > 2 * 1024 * 1024 or state['received_bytes'] + len(content) > 1024 ** 3:
                raise ValueError('同步暂存超出容量范围，未截断写入。')
            path.write_bytes(content)
            info['received'][str(part)] = hashlib.sha256(content).hexdigest()
            info['bytes'] += len(content)
            state['received_bytes'] += len(content)
            self.save(folder, state)
            return {'received': True, 'replayed': False}

    def asset_part(self, owner, session, key, offset, total, data):
        if not HASH.fullmatch(key) or not 1 <= total <= MAX_FILE or not 0 <= offset < total:
            raise ValueError('原件分块范围无效。')
        content = self.decode(data)
        if offset + len(content) > total:
            raise ValueError('原件分块超出原文件长度。')
        with self.lock:
            folder, state = self.load(owner, session)
            if self.originals.path(key).exists():
                existing = self.originals.read(key)
                if len(existing) != total or existing[offset:offset + len(content)] != content:
                    raise Conflict('原件哈希与分块内容不一致。')
                return {'received': True, 'complete': True, 'replayed': True}
            info = state['assets'].setdefault(key, {'total': total, 'received': 0})
            if info['total'] != total:
                raise Conflict('原件声明大小发生变化。')
            path = folder / ('asset-' + key)
            if offset < info['received']:
                with path.open('rb') as stream:
                    stream.seek(offset)
                    if stream.read(len(content)) != content:
                        raise Conflict('重试的原件分块与已暂存内容不同。')
                return {'received': True, 'complete': info['received'] == total, 'replayed': True}
            if offset != info['received'] or state['received_bytes'] + len(content) > 1024 ** 3:
                raise ValueError('原件分块不连续或同步总量超过 1 GiB。')
            with path.open('ab') as stream:
                # Recover a crash between durable file append and manifest
                # publication without appending the same bytes twice.
                if stream.tell() > info['received']:
                    stream.truncate(info['received'])
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            info['received'] += len(content)
            state['received_bytes'] += len(content)
            if info['received'] == total and self.originals.put(path.read_bytes()) != key:
                raise ValueError('原件 SHA-256 不符，未提交笔记。')
            self.save(folder, state)
            return {'received': True, 'complete': info['received'] == total}

    def validate_note(self, note):
        if not isinstance(note, dict) or not isinstance(note.get('id'), str) or not isinstance(note.get('title'), str) or len(note['title']) > 200 or not isinstance(note.get('text'), str) or len(note['text']) > 50000:
            raise ValueError('笔记正文、标题或编号不符合范围。')
        for key in ('createdAt', 'updatedAt', 'importedAt'):
            if key in note and (not isinstance(note[key], str) or len(note[key]) > 100):
                raise ValueError('笔记来源时间格式无效。')
        images = note.get('images', [])
        if not isinstance(images, list) or len(images) > 500:
            raise ValueError('笔记图片列表无效。')
        assets = []
        for image in images:
            if not isinstance(image, dict) or not HASH.fullmatch(str(image.get('hash', ''))):
                raise ValueError('笔记图片缺少完整原件。')
            assets.append(image['hash'])
        archive = note.get('archive')
        if archive is not None:
            if not isinstance(archive, dict) or archive.get('version') not in (1, 2) or not HASH.fullmatch(str(archive.get('originalHash', ''))) or not isinstance(archive.get('images'), list) or len(archive['images']) > 500 or not isinstance(archive.get('layout'), list) or len(archive['layout']) > 10000:
                raise ValueError('文档原件清单无效。')
            assets.append(archive['originalHash'])
            for image in archive['images']:
                if not isinstance(image, dict) or not HASH.fullmatch(str(image.get('hash', ''))):
                    raise ValueError('文档图片原件编号无效。')
                assets.append(image['hash'])
        for key in set(assets):
            self.originals.read(key)
        return sorted(set(assets))

    def commit(self, owner, session):
        with self.lock:
            folder, state = self.load(owner, session)
            if state.get('committed'):
                return state['committed']
            with self.store.connection() as db:
                previous_commit = db.execute('SELECT result FROM note_commits WHERE session=? AND owner=?', (session, owner)).fetchone()
            if previous_commit:
                return json.loads(previous_commit[0])
            if len(state['notes']) != state['count']:
                raise ValueError('笔记条数未齐，未提交。')
            records = []
            for key, info in sorted(state['notes'].items()):
                if len(info['received']) != info['parts']:
                    raise ValueError('笔记分块未齐，未提交。')
                contents = []
                for part in range(info['parts']):
                    data = (folder / ('note-' + key + '-' + str(part))).read_bytes()
                    if hashlib.sha256(data).hexdigest() != info['received'][str(part)]:
                        raise ValueError('暂存笔记校验失败，未提交。')
                    contents.append(data)
                try:
                    note = json.loads(b''.join(contents).decode('utf-8'))
                except (ValueError, UnicodeError) as exc:
                    raise ValueError('笔记分块内容无法还原。') from exc
                if not isinstance(note, dict) or note.get('id') != info['id']:
                    raise ValueError('笔记编号与分块声明不一致。')
                assets = self.validate_note(note)
                metadata = {'source_type': 'xixu_note', 'device_id': owner, 'note_id': note['id'],
                            'source_created_at': note.get('createdAt', ''), 'source_updated_at': note.get('updatedAt', ''),
                            'source_imported_at': note.get('importedAt', ''), 'asset_hashes': assets, 'note': note}
                records.append({'source_key': 'phone:' + owner + ':' + note['id'], 'title': note['title'], 'text': note['text'], 'metadata': metadata})
            # Canonical records, FTS, version and the deletion snapshot publish in
            # the same SQLite transaction. A failed asset/write cannot half-sync.
            with self.store.connection() as db:
                db.execute('BEGIN IMMEDIATE')
                committed = db.execute('SELECT result FROM note_commits WHERE session=? AND owner=?', (session, owner)).fetchone()
                if committed:
                    return json.loads(committed[0])
                row = db.execute('SELECT revision FROM note_snapshots WHERE owner=?', (owner,)).fetchone()
                current = row[0] if row else ''
                if current != state['revision']:
                    raise Conflict('电脑快照已被另一同步更新，请重新核对。')
                keep = {record['source_key'] for record in records}
                previous = list(db.execute('SELECT id,source_key FROM documents WHERE source_key LIKE ?', ('phone:' + owner + ':%',)))
                results = [self.store.upsert(**record, _connection=db) for record in records]
                removed = 0
                if state['allow_deletions']:
                    for item in previous:
                        if item['source_key'] in keep:
                            continue
                        ids = [r[0] for r in db.execute('SELECT id FROM chunks WHERE document_id=?', (item['id'],))]
                        db.executemany('INSERT OR IGNORE INTO vector_deletes VALUES (?)', [(chunk_id,) for chunk_id in ids])
                        db.executemany('DELETE FROM chunks_fts WHERE id=?', [(chunk_id,) for chunk_id in ids])
                        db.execute('DELETE FROM documents WHERE id=?', (item['id'],))
                        removed += 1
                canonical = [list(row) for row in db.execute('SELECT source_key,version FROM documents WHERE source_key LIKE ? ORDER BY source_key', ('phone:' + owner + ':%',))]
                revision = digest(json.dumps(canonical, ensure_ascii=False))
                db.execute('INSERT OR REPLACE INTO note_snapshots VALUES (?,?)', (owner, revision))
                result = {'revision': revision, 'notes': len(records), 'changed': sum(r['changed'] for r in results),
                          'removed': removed, 'originals_verified': True}
                db.execute('INSERT INTO note_commits VALUES (?,?,?)', (session, owner, json.dumps(result)))
            state['committed'] = result
            self.save(folder, state)
            return result
