"""Explicit public-web searches. Private RAG context is never accepted here."""
import html
import ipaddress
import json
import re
import threading
from urllib.parse import urlsplit

import httpx

from .privacy import redact


DESTINATION = 'https://api.search.brave.com/res/v1/web/search'


def public_web_url(value):
    try:
        value = str(value or '')
        parsed = urlsplit(value)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or len(value) > 4096:
            return ''
        if parsed.port is not None and parsed.port not in (80, 443):
            return ''
        host = parsed.hostname.lower().rstrip('.')
        if host == 'localhost' or host.endswith(('.local', '.internal')) or '.' not in host:
            return ''
        try:
            ipaddress.ip_address(host)
            return ''
        except ValueError:
            return parsed.geturl()
    except ValueError:
        return ''


class WebSearch:
    def __init__(self, directory, vault, redactor=redact):
        self.redact = redactor
        self.path, self.vault = directory / 'web-search.json', vault
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            return json.loads(self.path.read_text('utf-8')) if self.path.exists() else {'enabled': False}

    def public(self):
        return {'enabled': bool(self.read().get('enabled')), 'provider': 'Brave Search',
                'destination': DESTINATION, 'key_configured': bool(self.vault.get('tool:brave-search'))}

    def save(self, enabled, api_key=None, clear_key=False):
        with self.lock:
            if clear_key:
                self.vault.set('tool:brave-search', '')
            elif api_key is not None and api_key.strip():
                key = api_key.strip()
                if not 8 <= len(key) <= 500 or any(char.isspace() for char in key):
                    raise ValueError('搜索密钥格式无效。')
                self.vault.set('tool:brave-search', key)
            temporary = self.path.with_suffix('.tmp')
            temporary.write_text(json.dumps({'enabled': bool(enabled)}), encoding='utf-8')
            temporary.replace(self.path)
        return self.public()

    async def search(self, query, limit=5):
        settings = self.public()
        if not settings['enabled'] or not settings['key_configured']:
            raise ValueError('请在电脑管理页启用联网搜索并保存搜索服务密钥。')
        query = self.redact(query).strip()
        if not query or len(query) > 2000:
            raise ValueError('请核对本次公开搜索词。')
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=8), follow_redirects=False) as client:
                async with client.stream('GET', DESTINATION, params={'q': query, 'count': min(max(limit, 1), 8)},
                                         headers={'Accept': 'application/json', 'X-Subscription-Token': self.vault.get('tool:brave-search')}) as response:
                    response.raise_for_status()
                    chunks, size = [], 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > 2 * 1024 * 1024:
                            raise ValueError('搜索服务响应过大，本次未截断返回。')
                        chunks.append(chunk)
                    value = json.loads(b''.join(chunks))
        except (httpx.HTTPError, json.JSONDecodeError) as exc:
            raise ValueError('联网搜索未完成，请核对网络、搜索密钥和服务额度。') from exc
        results, seen = [], set()
        clean = lambda text: html.unescape(re.sub(r'<[^>]*>', '', str(text)))
        for row in value.get('web', {}).get('results', []):
            url = public_web_url(row.get('url', ''))
            if not url or url in seen:
                continue
            seen.add(url)
            results.append({'title': clean(row.get('title', '网页'))[:200], 'url': url,
                            'text': clean(row.get('description', ''))[:1800]})
            if len(results) >= limit:
                break
        return {'results': results, 'query': query, 'provider': 'Brave Search',
                'content_scope': 'search_snippets', 'private_context_sent': False}
