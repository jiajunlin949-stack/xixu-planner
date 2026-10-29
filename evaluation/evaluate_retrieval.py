"""Opt-in synthetic lexical/RRF/rerank evaluation; never reads the owner's DB."""
import argparse
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'companion'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    if not args.run:
        parser.error('需要明确 --run；此脚本不会由构建或 CI 自动运行')
    from xixu_hub.store import Store
    from xixu_hub.vectors import Retriever
    fixture = json.loads((Path(__file__).with_name('retrieval-fixture.json')).read_text('utf-8'))
    results = []
    with tempfile.TemporaryDirectory(prefix='xixu-synthetic-eval-') as directory:
        base = Path(directory)
        store = Store(base / 'synthetic.sqlite3')
        store.upsert_many([{'source_key': item['id'], 'title': item['title'], 'text': item['text'], 'metadata': {'source_type': 'synthetic', 'sent_at': item['sent_at']}} for item in fixture['documents']])
        retriever = Retriever(store, base / 'models', enabled=False, backend='chroma')
        for case in fixture['queries']:
            sources = retriever.search(case['query'], 5)['results']
            ranked = list(dict.fromkeys(item['source_key'] for item in sources))
            relevant = set(case['relevant'])
            first = next((index for index, key in enumerate(ranked, 1) if key in relevant), None)
            valid = sum(bool(store.excerpt(item['document_id'], item['version'], item['start'], item['end'])['text'] == item['text']) for item in sources)
            results.append({'id': case['id'], 'retrieved': ranked, 'relevant': case['relevant'], 'recall_at_5': len(relevant & set(ranked)) / len(relevant), 'reciprocal_rank': 1 / first if first else 0, 'valid_source_count': valid, 'source_count': len(sources)})
    count = len(results)
    citations = sum(item['source_count'] for item in results)
    report = {'suite': 'synthetic-retrieval-v1', 'cases': count, 'semantic_enabled': False,
              'recall_at_5': sum(item['recall_at_5'] for item in results) / count,
              'mrr': sum(item['reciprocal_rank'] for item in results) / count,
              'source_version_integrity': sum(item['valid_source_count'] for item in results) / citations if citations else None,
              'answer_citation_support_accuracy': None, 'results': results,
              'limits': 'No model answers, dense embeddings, real personal corpus, devices or human relevance judgments. Source version integrity is not answer citation correctness.'}
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
