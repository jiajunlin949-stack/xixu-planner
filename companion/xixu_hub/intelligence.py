"""Deterministic, source-bound extraction and ranking. No model or write tools."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .store import tokens

SHANGHAI = timezone(timedelta(hours=8))
ALIASES = {'ddl': '截止 提交', 'deadline': '截止 提交', '作业': 'homework assignment',
           '汇报': 'presentation 展示', '改期': '延期 改为 调整', '开题': '开题 报告'}


def expand_query(query):
    return query + ' ' + ' '.join(extra for word, extra in ALIASES.items() if word in query.lower())


def rerank(query, rows, scores, limit=5, budget=5000):
    """Interpretable lexical rerank of RRF top-20, not a neural cross-encoder."""
    query_tokens = set(tokens(expand_query(query)))
    ranked = []
    for row in rows:
        body_tokens = set(tokens(row['title'] + ' ' + row['text']))
        overlap = len(query_tokens & body_tokens) / max(1, len(query_tokens))
        title = len(query_tokens & set(tokens(row['title']))) / max(1, len(query_tokens))
        literal = float(query.strip().lower() in (row['title'] + row['text']).lower())
        score = overlap * .6 + title * .2 + literal * .15 + min(1, scores.get(row['id'], 0) * 30) * .05
        ranked.append((score, row))
    ranked.sort(key=lambda item: (-item[0], -scores.get(item[1]['id'], 0), item[1]['id']))
    selected, per_doc, used = [], {}, 0
    for score, row in ranked:
        if per_doc.get(row['document_id'], 0) >= 2 or used + len(row['text']) > budget:
            continue
        selected.append({**row, 'rrf_score': scores.get(row['id'], 0), 'rerank_score': score})
        per_doc[row['document_id']] = per_doc.get(row['document_id'], 0) + 1
        used += len(row['text'])
        if len(selected) >= min(5, limit):
            break
    return selected


def source_time(metadata):
    raw = metadata.get('sent_at') or metadata.get('source_updated_at') or metadata.get('source_created_at') or ''
    try:
        moment = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        # A date-only source may anchor calendar expressions; no clock is invented.
        return raw, moment.replace(tzinfo=SHANGHAI) if moment.tzinfo is None else moment.astimezone(SHANGHAI)
    except (ValueError, TypeError, AttributeError):
        return '', None


def extract_deadline(line, metadata):
    raw, anchor = source_time(metadata)
    absolute = re.search(r'(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]?', line)
    try:
        if absolute:
            if not absolute[1] and anchor is None:
                return '', 'missing_original_year'
            date = datetime(int(absolute[1] or anchor.year), int(absolute[2]), int(absolute[3]), tzinfo=SHANGHAI)
            return date.date().isoformat(), ''
        if anchor is None:
            return '', 'missing_original_time'
        relative = re.search(r'大后天|今天|明天|后天', line)
        if relative:
            return (anchor + timedelta(days={'今天': 0, '明天': 1, '后天': 2, '大后天': 3}[relative[0]])).date().isoformat(), ''
        week = re.search(r'(下下|下|本|这)?周([一二三四五六日天])', line)
        if week:
            if not week[1]:
                return '', 'ambiguous_week'
            monday = anchor - timedelta(days=anchor.weekday())
            days = '一二三四五六日'.index('日' if week[2] == '天' else week[2])
            return (monday + timedelta(days=days + {'下下': 14, '下': 7, '本': 0, '这': 0}[week[1]])).date().isoformat(), ''
    except (ValueError, OverflowError):
        return '', 'invalid_date'
    return '', 'missing_date'


def commitments(record):
    metadata = record.get('metadata', {})
    text = record['text']
    result = []
    for match in re.finditer(r'[^\n。；！？]+[。；！？]?', text):
        line = match[0].strip()
        if len(line) > 2000:
            continue
        if not re.search(r'提交|截止|汇报|答辩|开会|考试|交.*(?:报告|开题|作业)|(?:号|日|天).*交', line):
            continue
        if re.search(r'取消|不用交|无需|不必|已提交|已完成|[?？]', line):
            continue
        if not re.search(r'\d{1,2}月\d{1,2}|今天|明天|后天|周[一二三四五六日天]', line):
            continue
        date, issue = extract_deadline(line, metadata)
        raw, _ = source_time(metadata)
        key = hashlib.sha256((record.get('source_key', '') + '\0' + str(match.start()) + '\0' + text).encode()).hexdigest()
        result.append({'id': key, 'title': line[:100], 'deadline': date, 'issue': issue,
                       'evidence': line, 'start': match.start(), 'end': match.end(), 'source_time': raw,
                       'actor': metadata.get('sender_name', ''), 'assignee_confirmed': False,
                       'original_hash': metadata.get('original_hash', ''), 'status': 'suggested'})
    return result


def temporal_evidence(sources):
    claims = []
    for index, source in enumerate(sources, 1):
        metadata = source.get('metadata', {})
        at, _ = source_time(metadata)
        for match in re.finditer(r'[^\n。；]+', source['text']):
            line = match[0]
            dates = re.findall(r'(?:(?:\d{4})年)?\d{1,2}月\d{1,2}[日号]?', line)
            field, values = 'date', dates
            if not values:
                detail = re.search(r'(地点|教室|考场|范围)\s*[:：]?\s*(.{1,100})', line)
                if detail:
                    field = 'scope' if detail[1] == '范围' else 'location'
                    values = [part.strip(' ，：:') for part in re.split(r'[，,]?\s*(?:现|现在|已经)?(?:改为|改到|调整为|更正为)', detail[2]) if part.strip(' ，：:')]
            if not values or not re.search(r'考试|截止|提交|改到|改为|延期|推迟|原定|范围|地点|教室|考场', line):
                continue
            subject = re.split(r'改到|改为|延期|推迟|原定|定于|时间|截止|范围|地点|教室|考场|\d{1,2}月', line)[0].strip(' ，：:')
            if len(subject) < 3:
                continue
            claims.append({'source_index': index, 'subject': subject, 'original_time': at,
                           'dates': dates, 'field': field, 'values': values, 'explicit_change': bool(re.search(r'改到|改为|延期|推迟', line)),
                           'evidence': line, 'status': 'needs_scope_confirmation'})
    # Never resolve authority or event identity from a later timestamp alone.
    return sorted(claims, key=lambda item: (item['subject'], item['original_time']))


class Suggestions:
    def __init__(self, store):
        self.store = store
        with store.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS commitment_suggestions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL)')

    def analyze(self, records):
        count = 0
        with self.store.connection() as db:
            for record in records:
                doc = db.execute('SELECT id,version FROM documents WHERE source_key=?', (record['source_key'],)).fetchone()
                if not doc:
                    continue
                db.execute("UPDATE commitment_suggestions SET status='source_changed' WHERE document_id=? AND version<>? AND status='suggested'", (doc['id'], doc['version']))
                for item in commitments(record):
                    cursor = db.execute('INSERT OR IGNORE INTO commitment_suggestions VALUES (?,?,?,?,?)', (item['id'], doc['id'], doc['version'], json.dumps(item, ensure_ascii=False), 'suggested'))
                    count += cursor.rowcount
        return count

    def pending(self, limit=100):
        with self.store.connection() as db:
            rows = db.execute("SELECT s.* FROM commitment_suggestions s JOIN documents d ON d.id=s.document_id AND d.version=s.version WHERE s.status='suggested' ORDER BY s.rowid DESC LIMIT ?", (min(limit, 100),)).fetchall()
            return [{**json.loads(row['payload']), 'document_id': row['document_id'], 'version': row['version']} for row in rows]


def tool_manifest():
    return json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'tool-schemas.json').read_text('utf-8'))
