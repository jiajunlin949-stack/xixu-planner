from __future__ import annotations

import hashlib
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def tokens(text: str) -> list[str]:
    words = []
    for part in re.findall(r'[\u3400-\u9fff]+|[a-zA-Z0-9_]+', text.lower()):
        if re.search(r'[\u3400-\u9fff]', part):
            words.extend(part[i:i + 2] for i in range(len(part) - 1))
            if len(part) == 1:
                words.append(part)
        else:
            words.append(part)
    return words


def split_text(text: str, size: int = 320, overlap: int = 48):
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            boundary = max(text.rfind(sep, start + size // 2, end) for sep in '\n。！？；')
            if boundary >= 0:
                end = boundary + 1
        if text[start:end].strip():
            yield start, end, text[start:end]
        if end == len(text):
            break
        start = max(start + 1, end - overlap)


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE,
                    title TEXT NOT NULL, text TEXT NOT NULL, version TEXT NOT NULL,
                    updated_at TEXT NOT NULL, indexed_version TEXT
                );
                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY, document_id TEXT NOT NULL,
                    version TEXT NOT NULL, start INTEGER NOT NULL, end INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS chunks_document ON chunks(document_id);
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, title, body);
                CREATE TABLE IF NOT EXISTS vector_deletes(id TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS conversations (
                    owner TEXT NOT NULL, id TEXT NOT NULL, messages TEXT NOT NULL,
                    updated_at TEXT NOT NULL, PRIMARY KEY(owner,id)
                );
                CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY, content TEXT NOT NULL, kind TEXT NOT NULL,
                    evidence TEXT NOT NULL, confirmed INTEGER NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sources (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, config TEXT NOT NULL,
                    enabled INTEGER NOT NULL, state TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE IF NOT EXISTS sync_items (
                    source_id TEXT NOT NULL, item_id TEXT NOT NULL, version TEXT NOT NULL,
                    document_id TEXT NOT NULL, PRIMARY KEY(source_id,item_id)
                );
                CREATE TABLE IF NOT EXISTS devices (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS pairing (
                    code_hash TEXT PRIMARY KEY, expires REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
                );
            ''')
            if 'metadata' not in {r['name'] for r in db.execute('PRAGMA table_info(documents)')}:
                db.execute("ALTER TABLE documents ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'")

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def upsert(self, source_key: str, title: str, text: str, metadata: dict | None = None, *, _connection=None) -> dict:
        import json
        if _connection is None:
            with self.connection() as db:
                return self.upsert(source_key, title, text, metadata, _connection=db)
        document_id = digest(source_key)
        version = digest('parser-v2/chunks-320-48\n' + text + '\n' + json.dumps(metadata or {}, sort_keys=True, ensure_ascii=False))
        if _connection is not None:
            db = _connection
            old = db.execute('SELECT version FROM documents WHERE id=?', (document_id,)).fetchone()
            if old and old['version'] == version:
                return {'document_id': document_id, 'changed': False, 'version': version}
            old_ids = [r['id'] for r in db.execute('SELECT id FROM chunks WHERE document_id=?', (document_id,))]
            db.executemany('INSERT OR IGNORE INTO vector_deletes VALUES (?)', [(i,) for i in old_ids])
            db.executemany('DELETE FROM chunks_fts WHERE id=?', [(i,) for i in old_ids])
            db.execute('DELETE FROM chunks WHERE document_id=?', (document_id,))
            db.execute('''INSERT INTO documents (id,source_key,title,text,version,updated_at,indexed_version,metadata)
                VALUES (?,?,?,?,?,?,NULL,?)
                ON CONFLICT(id) DO UPDATE SET title=excluded.title, text=excluded.text,
                version=excluded.version, updated_at=excluded.updated_at, indexed_version=NULL,metadata=excluded.metadata''',
                (document_id, source_key, title, text, version, now(), json.dumps(metadata or {}, ensure_ascii=False)))
            for start, end, body in split_text(text):
                chunk_id = digest(f'{document_id}:{version}:{start}:{end}')
                db.execute('INSERT INTO chunks VALUES (?,?,?,?,?,?)', (chunk_id, document_id, version, start, end, body))
                db.execute('INSERT INTO chunks_fts VALUES (?,?,?)', (chunk_id, ' '.join(tokens(title)), ' '.join(tokens(body))))
        return {'document_id': document_id, 'changed': True, 'version': version}

    def upsert_many(self, records):
        keys = [record['source_key'] for record in records]
        if len(keys) != len(set(keys)):
            raise ValueError('批次中有重复的资料编号，尚未写入。')
        with self.connection() as db:
            return [self.upsert(**record, _connection=db) for record in records]

    def documents(self):
        with self.connection() as db:
            return [dict(r) for r in db.execute('''SELECT d.id,d.title,d.source_key,d.version,d.updated_at,
                d.indexed_version,d.metadata,COUNT(c.id) chunks FROM documents d LEFT JOIN chunks c
                ON c.document_id=d.id GROUP BY d.id ORDER BY d.updated_at DESC''')]

    def stats(self):
        with self.connection() as db:
            row = db.execute('SELECT count(*) total,coalesce(sum(indexed_version=version),0) indexed_count FROM documents').fetchone()
            return {'documents': row['total'], 'indexed_documents': row['indexed_count'],
                    'chunks': db.execute('SELECT count(*) FROM chunks').fetchone()[0]}

    def document_page(self, limit=100, offset=0):
        with self.connection() as db:
            return [dict(r) for r in db.execute('''SELECT d.id,d.title,d.source_key,d.version,d.updated_at,
                d.indexed_version,d.metadata,(SELECT count(*) FROM chunks c WHERE c.document_id=d.id) chunks
                FROM documents d ORDER BY d.updated_at DESC LIMIT ? OFFSET ?''',(limit,offset))]

    def delete(self, document_id: str):
        with self.connection() as db:
            ids = [r['id'] for r in db.execute('SELECT id FROM chunks WHERE document_id=?', (document_id,))]
            db.executemany('INSERT OR IGNORE INTO vector_deletes VALUES (?)', [(i,) for i in ids])
            db.executemany('DELETE FROM chunks_fts WHERE id=?', [(i,) for i in ids])
            changed = db.execute('DELETE FROM documents WHERE id=?', (document_id,)).rowcount
        return bool(changed)

    def chunks(self, document_id: str):
        with self.connection() as db:
            return [dict(r) for r in db.execute('SELECT * FROM chunks WHERE document_id=? ORDER BY start', (document_id,))]

    def resolve(self, ids: list[str]):
        if not ids:
            return {}
        with self.connection() as db:
            rows = db.execute('''SELECT c.*,d.title,d.source_key,d.updated_at,d.metadata FROM chunks c
                JOIN documents d ON c.document_id=d.id AND c.version=d.version
                WHERE c.id IN (''' + ','.join('?' for _ in ids) + ')', ids)
            return {r['id']: dict(r) for r in rows}

    def lexical(self, query: str, limit: int = 30):
        query_tokens = list(dict.fromkeys(tokens(query)))[:100]
        if not query_tokens:
            return []
        expression = ' OR '.join('"' + term + '"' for term in query_tokens)
        with self.connection() as db:
            return [r['id'] for r in db.execute('''SELECT id FROM chunks_fts
                WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts,0,2,1) LIMIT ?''', (expression, limit))]

    def excerpt(self, document_id: str, version: str, start: int, end: int):
        with self.connection() as db:
            row = db.execute('SELECT * FROM documents WHERE id=?', (document_id,)).fetchone()
            if not row:
                raise KeyError(document_id)
            if row['version'] != version:
                raise ValueError('来源已经更新，请重新检索。')
            text = row['text']
            start, end = max(0, start), min(len(text), end)
            return {'title': row['title'], 'version': version, 'start': start, 'end': end, 'text': text[start:end]}

    def mark_indexed(self, document_id: str, version: str):
        with self.connection() as db:
            db.execute('UPDATE documents SET indexed_version=? WHERE id=? AND version=?', (version, document_id, version))

    def pending_deletes(self):
        with self.connection() as db:
            return [r['id'] for r in db.execute('SELECT id FROM vector_deletes LIMIT 256')]

    def ack_deletes(self, ids):
        with self.connection() as db:
            db.executemany('DELETE FROM vector_deletes WHERE id=?', [(i,) for i in ids])
