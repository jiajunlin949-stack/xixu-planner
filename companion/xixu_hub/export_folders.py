"""Opt-in background imports from explicitly selected local export folders.

This does not read application databases, credentials, or account history APIs.
Deleting an export file never deletes previously imported messages.
"""
import asyncio
import hashlib
import json
import threading
import time
import uuid
from pathlib import Path

from .chat_exports import parse_chat
from .originals import MAX_FILE


class ExportFolders:
    def __init__(self, store, originals, retriever):
        self.store, self.originals, self.retriever = store, originals, retriever
        self.lock = threading.Lock()

    @staticmethod
    def validate_folder(value):
        path = Path(value).expanduser()
        if not path.is_absolute() or str(path).startswith('\\\\') or path.is_symlink() or path.is_junction():
            raise ValueError('请选择明确授权的本机导出文件夹，不支持网络共享、符号链接或联接。')
        try:
            path = path.resolve(strict=True)
        except OSError as exc:
            raise ValueError('导出文件夹不存在或不可访问。') from exc
        if not path.is_dir():
            raise ValueError('路径不是文件夹。')
        return path

    def add(self, platform, path, conversation_name='', account_id=''):
        if platform not in ('qq', 'dingtalk', 'wechat'):
            raise ValueError('聊天平台不支持。')
        folder = self.validate_folder(path)
        identifier = uuid.uuid4().hex
        config = {'platform': platform, 'path': str(folder), 'conversation_name': conversation_name, 'account_id': account_id}
        with self.store.connection() as db:
            existing = list(db.execute("SELECT config FROM sources WHERE kind='export-folder' AND enabled=1"))
            if any(json.loads(row[0]) == config for row in existing):
                raise ValueError('这个导出文件夹已经启用。')
            db.execute('INSERT INTO sources(id,kind,config,enabled,state) VALUES (?,?,?,1,?)',
                       (identifier, 'export-folder', json.dumps(config, ensure_ascii=False), '{}'))
        return identifier

    def list(self):
        with self.store.connection() as db:
            rows = [dict(row) for row in db.execute("SELECT * FROM sources WHERE kind='export-folder'")]
        return [{**row, 'config': json.loads(row['config']), 'state': json.loads(row['state']), 'enabled': bool(row['enabled'])} for row in rows]

    def disable(self, identifier):
        with self.store.connection() as db:
            db.execute("UPDATE sources SET enabled=0 WHERE id=? AND kind='export-folder'", (identifier,))
        return {'disabled': True, 'imported_records_retained': True}

    def sync(self, identifier):
        if not self.lock.acquire(blocking=False):
            return {'status': 'running'}
        try:
            with self.store.connection() as db:
                row = db.execute("SELECT * FROM sources WHERE id=? AND kind='export-folder' AND enabled=1", (identifier,)).fetchone()
            if not row:
                return {'status': 'disabled'}
            config, state = json.loads(row['config']), json.loads(row['state'])
            seen, changed, errors, warnings = dict(state.get('fingerprints', {})), 0, 0, set()
            folder = self.validate_folder(config['path'])
            files = sorted(folder.iterdir())
            if len(files) > 1000:
                raise ValueError('导出目录超过 1000 个条目，请使用专用导出目录。')
            for file in files:
                if file.name.startswith('.') or file.suffix.lower() not in ('.json', '.csv', '.txt'):
                    continue
                if file.is_symlink() or file.is_junction() or not file.is_file() or not file.resolve().is_relative_to(folder):
                    continue
                if file.suffix.lower() == '.txt' and config['platform'] != 'qq':
                    continue
                before = file.stat()
                if before.st_size > MAX_FILE or time.time() - before.st_mtime < 3:
                    warnings.add('存在过大或仍在写入的文件，本轮未读取，将继续核对。')
                    continue
                try:
                    content = file.read_bytes()
                    after = file.stat()
                    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                        continue
                    fingerprint = hashlib.sha256(content).hexdigest()
                    if seen.get(file.name) == fingerprint:
                        continue
                    parsed = parse_chat(config['platform'], file.name, content,
                                        conversation_name=config['conversation_name'], account_id=config['account_id'])
                    self.originals.put(content)
                    results = self.store.upsert_many(parsed['records'])
                    changed += sum(item['changed'] for item in results)
                    warnings.update(parsed['warnings'])
                    seen[file.name] = fingerprint
                except (ValueError, OSError):
                    # Keep the prior document/index; no failed parse implies a
                    # source deletion, and no raw message/secret enters logs.
                    errors += 1
            result = {'status': 'ok', 'changed': changed, 'unparsed_files': errors, 'warnings': sorted(warnings),
                      'last_checked': time.time(), 'fingerprints': seen}
            with self.store.connection() as db:
                db.execute('UPDATE sources SET state=? WHERE id=?', (json.dumps(result, ensure_ascii=False), identifier))
            if changed:
                self.retriever.sync()
            return {key: value for key, value in result.items() if key != 'fingerprints'}
        except (ValueError, OSError):
            result = {'status': 'error', 'error': '导出目录暂不可读或超限，已有消息和原件继续保留。', 'last_checked': time.time()}
            with self.store.connection() as db:
                db.execute('UPDATE sources SET state=? WHERE id=?', (json.dumps(result), identifier))
            return result
        finally:
            self.lock.release()

    async def loop(self):
        while True:
            for source in self.list():
                if source['enabled']:
                    await asyncio.to_thread(self.sync, source['id'])
            await asyncio.sleep(30)
