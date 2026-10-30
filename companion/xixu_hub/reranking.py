"""Optional, local-only CrossEncoder. No model download or remote inference."""
import math
import os
import threading
from pathlib import Path

from .intelligence import rerank as lexical_rerank


class Reranker:
    def __init__(self, model_path=None):
        configured = model_path or os.getenv('XIXU_RERANKER_PATH', '')
        self.path = Path(configured).expanduser().resolve() if configured else None
        self.model = None
        self.lock = threading.RLock()
        self.warning = ''

    def public(self):
        return {'configured': self.path is not None, 'loaded': self.model is not None,
                'backend': 'local-cross-encoder' if self.model is not None else 'token-coverage-title-v1',
                'warning': self.warning, 'downloads_models': False}

    def rank(self, query, rows, scores, limit=5, budget=5000):
        candidates = rows[:20]
        if not candidates or self.path is None:
            return lexical_rerank(query, candidates, scores, limit, budget), self.public()
        with self.lock:
            try:
                if self.model is None:
                    if not self.path.is_dir() or not (self.path / 'config.json').is_file():
                        raise ValueError('local model is missing')
                    from sentence_transformers import CrossEncoder
                    self.model = CrossEncoder(str(self.path), device='cpu', max_length=512,
                                              local_files_only=True, trust_remote_code=False,
                                              token=False, model_kwargs={'use_safetensors': True})
                # The score is only a ranking signal, never a calibrated probability.
                pairs = [(query, row['title'] + '\n' + row['text']) for row in candidates]
                values = self.model.predict(pairs, batch_size=4, show_progress_bar=False, convert_to_numpy=True)
                values = [float(value) for value in values]
                if len(values) != len(candidates) or not all(math.isfinite(value) for value in values):
                    raise ValueError('reranker must return one finite score for each pair')
                ordered = sorted(zip(candidates, values), key=lambda item: (-item[1], -scores.get(item[0]['id'], 0), item[0]['id']))
                selected, remaining, per_document = [], budget, {}
                for row, value in ordered:
                    if len(selected) >= limit:
                        break
                    if per_document.get(row['document_id'], 0) >= 2 or len(row['text']) > remaining:
                        continue
                    selected.append({**row, 'rrf_score': scores.get(row['id'], 0), 'rerank_score': value})
                    remaining -= len(row['text'])
                    per_document[row['document_id']] = per_document.get(row['document_id'], 0) + 1
                self.warning = ''
                return selected, self.public()
            except Exception:
                self.warning = '本地语义精排未就绪，已回退到词项精排；请核对可选依赖与本地 safetensors 模型。未发送资料或下载模型。'
                state = {**self.public(), 'backend': 'token-coverage-title-v1', 'available_for_request': False}
                return lexical_rerank(query, candidates, scores, limit, budget), state
