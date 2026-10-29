import ipaddress
import json
import re
from urllib.parse import urlsplit

import httpx

from .config import Settings


class ModelError(Exception):
    pass


def validate_endpoint(base_url: str) -> str:
    url = urlsplit(base_url)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError('模型地址必须是完整 HTTPS 地址，不能包含账号、查询参数或片段。')
    if url.hostname.lower() in ('localhost', 'metadata.google.internal') or url.hostname.endswith('.local'):
        raise ValueError('云模型地址不能指向本机或内部服务。')
    try:
        address = ipaddress.ip_address(url.hostname)
        if not address.is_global:
            raise ValueError('模型地址不能使用内部 IP。')
    except ValueError as exc:
        if '内部 IP' in str(exc):
            raise
    return base_url.rstrip('/')


class ModelClient:
    def __init__(self, settings: Settings, transport=None):
        self.settings = settings
        self.transport = transport

    async def complete(self, messages, *, max_tokens=None):
        config = self.settings.read()
        key = self.settings.vault.get('model:' + config['provider'])
        if not key or not config.get('model'):
            raise ModelError('请在本机“模型设置”填写 API Key 和模型名称，再测试连接。')
        base = validate_endpoint(config['base_url'])
        output_limit = max_tokens or config['max_output_tokens']
        if config['api'] == 'responses':
            payload = {'model': config['model'], 'input': messages, 'store': False, 'max_output_tokens': output_limit}
            route = '/responses'
        else:
            payload = {'model': config['model'], 'messages': messages, 'stream': False, 'max_tokens': output_limit}
            route = '/chat/completions'
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=False, transport=self.transport) as client:
                response = await client.post(base + route, headers={'Authorization': 'Bearer ' + key}, json=payload)
            if response.status_code >= 300:
                # Never return provider response bodies: they may echo credentials or source text.
                raise ModelError(f'模型服务返回 HTTP {response.status_code}，请检查模型、密钥、地区与额度。')
            data = response.json()
            if config['api'] == 'responses':
                text = ''.join(c.get('text', '') for item in data.get('output', [])
                               if item.get('type') == 'message' for c in item.get('content', [])
                               if c.get('type') == 'output_text')
            else:
                text = data['choices'][0]['message']['content']
            if not isinstance(text, str) or not text.strip():
                raise ModelError('模型没有返回可显示的正文。')
            return text, data.get('usage', {})
        except ModelError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            raise ModelError('模型请求未完成，请检查网络和接口配置。') from exc


def parse_answer(text: str, source_count: int):
    candidate = text.strip()
    if candidate.startswith('```'):
        candidate = candidate.split('\n', 1)[-1].rsplit('```', 1)[0].strip()
    try:
        value = json.loads(candidate)
        answer = value.get('answer')
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError()
        citations = list(dict.fromkeys(i for i in value.get('citations', [])
                                      if type(i) is int and 1 <= i <= source_count))
        answer = re.sub(r'\[(\d+)\]', lambda m: m[0] if 1 <= int(m[1]) <= source_count else '[引用无效]', answer)
        return answer[:16000], citations
    except (ValueError, TypeError, AttributeError):
        return text[:16000], []
