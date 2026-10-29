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

    def request_parts(self, messages, max_tokens=None, stream=False):
        config = self.settings.read()
        key = self.settings.vault.get('model:' + config['provider'])
        if not key or not config.get('model'):
            raise ModelError('请在本机“模型设置”填写 API Key 和模型名称。')
        base = validate_endpoint(config['base_url'])
        output_limit = max_tokens or config['max_output_tokens']
        headers = {'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}
        if config['api'] == 'responses':
            payload = {'model': config['model'], 'input': messages, 'store': False, 'stream': stream, 'max_output_tokens': output_limit}
            route = '/responses'
        elif config['api'] == 'messages':
            headers = {'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json'}
            payload = {'model': config['model'], 'messages': [item for item in messages if item['role'] != 'system'], 'system': '\n'.join(item['content'] for item in messages if item['role'] == 'system'), 'stream': stream, 'max_tokens': output_limit}
            route = '/messages'
        else:
            payload = {'model': config['model'], 'messages': messages, 'stream': stream, config.get('output_token_field', 'max_tokens'): output_limit}
            route = '/chat/completions'
        return config, base + route, headers, payload

    async def complete(self, messages, *, max_tokens=None):
        config, url, headers, payload = self.request_parts(messages, max_tokens)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=False, transport=self.transport) as client:
                response = await client.post(url, headers=headers, json=payload)
            if response.status_code >= 300:
                # Never return provider response bodies: they may echo credentials or source text.
                raise ModelError(f'模型服务返回 HTTP {response.status_code}，请检查模型、密钥、地区与额度。')
            data = response.json()
            if config['api'] == 'responses':
                if data.get('status') not in (None, 'completed'):
                    raise ModelError('回答没有完整结束，请核对后重试。')
                text = ''.join(c.get('text', '') for item in data.get('output', [])
                               if item.get('type') == 'message' for c in item.get('content', [])
                               if c.get('type') == 'output_text')
            elif config['api'] == 'messages':
                if data.get('stop_reason') not in ('end_turn', 'stop_sequence'):
                    raise ModelError('回答没有完整结束，请核对后重试。')
                text = ''.join(item.get('text', '') for item in data.get('content', []) if item.get('type') == 'text')
            else:
                if data['choices'][0].get('finish_reason') not in (None, 'stop'):
                    raise ModelError('回答被截断或未完成，尚未执行任何操作。')
                text = data['choices'][0]['message']['content']
            if not isinstance(text, str) or not text.strip():
                raise ModelError('模型没有返回可显示的正文。')
            return text, data.get('usage', {})
        except ModelError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            raise ModelError('模型请求未完成，请检查网络和接口配置。') from exc

    async def stream(self, messages):
        """Normalized deltas; closing the generator closes the upstream request."""
        config, url, headers, payload = self.request_parts(messages, stream=True)
        if not config.get('capabilities', {}).get('stream', True):
            text, usage = await self.complete(messages)
            yield {'type': 'delta', 'text': text}
            yield {'type': 'done', 'usage': usage}
            return
        finished, total, usage, data_lines = False, 0, {}, []
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=False, transport=self.transport) as client:
                async with client.stream('POST', url, headers=headers, json=payload) as response:
                    if response.status_code >= 300:
                        raise ModelError(f'模型服务返回 HTTP {response.status_code}。')
                    async for line in response.aiter_lines():
                        if len(line) > 131072:
                            raise ModelError('流式片段超过容量，已停止。')
                        if line.startswith('data:'):
                            data_lines.append(line[5:].lstrip())
                            if sum(map(len, data_lines)) > 262144:
                                raise ModelError('流式事件超过容量。')
                            continue
                        if line or not data_lines:
                            continue
                        raw, data_lines = '\n'.join(data_lines), []
                        if raw == '[DONE]':
                            if config['api'] != 'chat' or not finished:
                                raise ModelError('模型未提供完整结束标记。')
                            break
                        event = json.loads(raw)
                        delta = ''
                        if event.get('error') or event.get('type') in ('error', 'response.failed', 'response.incomplete'):
                            raise ModelError('流式回答未完成，未执行任何操作。')
                        if config['api'] == 'responses':
                            if event.get('type') == 'response.output_text.delta':
                                delta = event.get('delta', '')
                            elif event.get('type') == 'response.completed':
                                finished = event.get('response', {}).get('status') == 'completed'
                                usage = event.get('response', {}).get('usage', {})
                        elif config['api'] == 'messages':
                            if event.get('type') == 'content_block_delta' and event.get('delta', {}).get('type') == 'text_delta':
                                delta = event['delta'].get('text', '')
                            if event.get('type') == 'message_delta' and event.get('delta', {}).get('stop_reason') not in (None, 'end_turn', 'stop_sequence'):
                                raise ModelError('回答达到长度限制或需要不支持的工具。')
                            if event.get('type') == 'message_stop':
                                finished = True
                        else:
                            for choice in event.get('choices', []):
                                delta += choice.get('delta', {}).get('content') or ''
                                reason = choice.get('finish_reason')
                                if reason and reason != 'stop':
                                    raise ModelError('回答被截断或需要不支持的工具。')
                                finished = finished or reason == 'stop'
                            usage = event.get('usage') or usage
                        total += len(delta)
                        if total > 64000:
                            raise ModelError('回答超过本地容量，已停止。')
                        if delta:
                            yield {'type': 'delta', 'text': delta}
            if not finished or data_lines or total == 0:
                raise ModelError('网络结束前回答尚未完整，请重试。')
            yield {'type': 'done', 'usage': usage}
        except ModelError:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
            raise ModelError('流式请求中断，请检查网络与接口配置。') from exc


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
