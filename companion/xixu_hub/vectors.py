"""Replaceable vector indexes; SQLite remains authoritative for every hit."""
import hashlib
import json
import math
import os
import threading
from pathlib import Path
from typing import Protocol

from .provenance import vector_record

MODEL = 'BAAI/bge-small-zh-v1.5'
DIMENSION = 512
COLLECTION = 'xixu_bge_small_zh_v1_512'


class VectorStore(Protocol):
    key: str
    def upsert(self, records: list[dict]): ...
    def delete(self, ids: list[str]): ...
    def search(self, vector: list[float], limit: int) -> list[str]: ...


def validate_vector(vector):
    if len(vector) != DIMENSION or any(not math.isfinite(float(x)) for x in vector):
        raise ValueError('向量维度或数值与当前模型不匹配，未写入。')


class MilvusStore:
    def __init__(self, uri=None, client=None, collection=COLLECTION):
        self.uri = uri or os.getenv('XIXU_MILVUS_URI', 'http://127.0.0.1:19530')
        self.collection = collection
        self.key = 'milvus:' + hashlib.sha256((self.uri + '/' + collection).encode()).hexdigest()[:16]
        self.client = client
        self.ready = False

    def connect(self):
        if self.client is None:
            from pymilvus import MilvusClient
            self.client = MilvusClient(uri=self.uri, timeout=8)
        if not self.ready:
            if not self.client.has_collection(self.collection):
                self.client.create_collection(self.collection, dimension=DIMENSION, id_type='string', max_length=64,
                                              metric_type='COSINE', consistency_level='Strong')
            self.ready = True

    def upsert(self, records):
        for row in records:
            validate_vector(row['vector'])
        self.connect()
        if records:
            self.client.upsert(self.collection, data=records)

    def delete(self, ids):
        self.connect()
        if ids:
            self.client.delete(self.collection, ids=ids)

    def search(self, vector, limit):
        validate_vector(vector)
        self.connect()
        result = self.client.search(self.collection, data=[vector], limit=limit,
                                    search_params={'metric_type': 'COSINE'}, timeout=8)
        return [hit['id'] for hit in result[0]]


class ChromaStore:
    """Optional computer-side local index; never presented as phone-native Chroma."""
    def __init__(self, path: Path, client=None):
        self.path, self.client, self.collection = path, client, None
        self.key = 'chroma:' + hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:16]

    def connect(self):
        if self.client is None:
            import chromadb
            from chromadb.config import Settings
            self.client = chromadb.PersistentClient(path=str(self.path), settings=Settings(anonymized_telemetry=False))
        if self.collection is None:
            self.collection = self.client.get_or_create_collection(COLLECTION, embedding_function=None,
                                                                   metadata={'hnsw:space': 'cosine'})

    def upsert(self, records):
        for row in records:
            validate_vector(row['vector'])
        self.connect()
        if records:
            self.collection.upsert(ids=[r['id'] for r in records], embeddings=[r['vector'] for r in records],
                                   metadatas=[{k: v for k, v in r.items() if k not in ('id', 'vector', 'text') and isinstance(v, (str, int, float, bool))} for r in records],
                                   documents=[r['text'] for r in records])

    def delete(self, ids):
        self.connect()
        if ids:
            self.collection.delete(ids=ids)

    def search(self, vector, limit):
        validate_vector(vector)
        self.connect()
        count = self.collection.count()
        if not count:
            return []
        return self.collection.query(query_embeddings=[vector], n_results=min(count, limit), include=[])['ids'][0]


class Retriever:
    def __init__(self, store, cache: Path, enabled=False, backend='milvus', vector_store=None, model=None):
        if backend not in ('milvus', 'chroma'):
            raise ValueError('向量库应为 milvus 或 chroma。')
        self.store, self.cache, self.enabled, self.backend = store, cache, enabled, backend
        self.index = vector_store or (MilvusStore() if backend == 'milvus' else ChromaStore(store.path.parent / 'chroma'))
        self.model, self.last_error, self.lock = model, '', threading.RLock()
        from .reranking import Reranker
        self.reranker = Reranker()
        with store.connection() as db:
            # State is scoped to the actual backend, not a global indexed bit:
            # switching Chroma/Milvus cannot silently skip a new empty index.
            db.executescript('''
                CREATE TABLE IF NOT EXISTS vector_state(backend TEXT,document_id TEXT,version TEXT,
                    PRIMARY KEY(backend,document_id));
                CREATE TABLE IF NOT EXISTS vector_ids(backend TEXT,id TEXT,PRIMARY KEY(backend,id));
            ''')

    def load_model(self):
        if self.model is None:
            from fastembed import TextEmbedding
            self.model = TextEmbedding(MODEL, cache_dir=str(self.cache), threads=2)

    def sync(self):
        if not self.enabled:
            return {'enabled': False, 'indexed_documents': 0, 'backend': self.backend}
        with self.lock:
            try:
                self.load_model()
                with self.store.connection() as db:
                    db.execute('DELETE FROM vector_state WHERE backend=? AND document_id NOT IN (SELECT id FROM documents)', (self.index.key,))
                    previous = {r[0] for r in db.execute('SELECT id FROM vector_ids WHERE backend=?', (self.index.key,))}
                    current = {r[0] for r in db.execute('SELECT id FROM chunks')}
                    versions = dict(db.execute('SELECT document_id,version FROM vector_state WHERE backend=?', (self.index.key,)))
                obsolete = sorted(previous - current)
                for offset in range(0, len(obsolete), 256):
                    batch = obsolete[offset:offset + 256]
                    self.index.delete(batch)
                    with self.store.connection() as db:
                        db.executemany('DELETE FROM vector_ids WHERE backend=? AND id=?', [(self.index.key, item) for item in batch])
                count = 0
                for doc in self.store.documents():
                    if versions.get(doc['id']) == doc['version']:
                        continue
                    chunks = self.store.chunks(doc['id'])
                    if any(c['version'] != doc['version'] for c in chunks):
                        continue
                    for offset in range(0, len(chunks), 32):
                        batch = chunks[offset:offset + 32]
                        embeddings = list(self.model.passage_embed([c['text'] for c in batch]))
                        rows = [vector_record(c, v.tolist() if hasattr(v, 'tolist') else list(v), doc)
                                for c, v in zip(batch, embeddings, strict=True)]
                        self.index.upsert(rows)
                        with self.store.connection() as db:
                            db.executemany('INSERT OR IGNORE INTO vector_ids VALUES (?,?)', [(self.index.key, c['id']) for c in batch])
                    with self.store.connection() as db:
                        db.execute('INSERT OR REPLACE INTO vector_state VALUES (?,?,?)', (self.index.key, doc['id'], doc['version']))
                    count += 1
                self.last_error = ''
                return {'enabled': True, 'backend': self.backend, 'indexed_documents': count}
            except Exception:
                self.last_error = '向量索引尚未就绪，请检查所选数据库和本地 Embedding 模型；原文仍保留，可继续文字检索。'
                return {'enabled': True, 'backend': self.backend, 'error': self.last_error}

    def search(self, query, limit=5):
        from .intelligence import expand_query, temporal_evidence
        lexical, dense, semantic_ok = self.store.lexical(expand_query(query)), [], False
        if self.enabled:
            with self.lock:
                try:
                    self.load_model()
                    vector = next(self.model.query_embed(query))
                    vector = vector.tolist() if hasattr(vector, 'tolist') else list(vector)
                    dense = self.index.search(vector, 30)
                    semantic_ok, self.last_error = True, ''
                except Exception:
                    self.last_error = '本次语义检索不可用，已使用文字检索。'
        scores = {}
        for ranking in [lexical, dense]:
            for rank, chunk_id in enumerate(dict.fromkeys(ranking), 1):
                scores[chunk_id] = scores.get(chunk_id, 0) + 1 / (60 + rank)
        ordered_ids = sorted(scores, key=lambda key: (-scores[key], key))
        rows = self.store.resolve(ordered_ids)
        candidate_ids, candidate_docs = [], {}
        for key in ordered_ids:
            row = rows.get(key)
            if not row or candidate_docs.get(row['document_id'], 0) >= 4:
                continue
            candidate_ids.append(key)
            candidate_docs[row['document_id']] = candidate_docs.get(row['document_id'], 0) + 1
            if len(candidate_ids) == 20:
                break
        ranked, ranking_state = self.reranker.rank(query, [rows[key] for key in candidate_ids if key in rows], scores, limit)
        selected = []
        for row in ranked:
            metadata = json.loads(row['metadata'])
            public_metadata = {key: metadata[key] for key in ('source_type', 'sender_id', 'sender_name', 'conversation_id', 'conversation_name', 'sent_at', 'sent_at_local', 'sent_at_unix', 'is_group', 'original_hash', 'note_id', 'source_created_at', 'source_updated_at', 'source_imported_at') if key in metadata}
            selected.append({**row, 'score': row['rerank_score'], 'metadata': public_metadata,
                             'source_type': metadata.get('source_type', 'file'), 'record_type': 'external'})
        return {'results': selected, 'strategy': ('rrf-' if semantic_ok else 'lexical-') + ranking_state['backend'],
                'ranking': {'fused_candidates': len(candidate_ids), 'selected': len(selected), 'reranker': ranking_state['backend'], 'scores_are_probabilities': False, 'configured': ranking_state['configured']},
                'temporal': temporal_evidence(selected),
                'semantic_available': semantic_ok, 'backend': self.backend, 'warning': ' '.join(filter(None, [self.last_error, ranking_state['warning']])),
                'answer_generated': False}
