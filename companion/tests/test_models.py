import asyncio

import httpx
import pytest

from xixu_hub.models import ModelClient, ModelError


class FixtureVault:
    def get(self, name):
        return 'synthetic-test-key'


class FixtureSettings:
    vault = FixtureVault()

    def __init__(self, api):
        self.api = api

    def read(self):
        return {'provider': 'custom', 'model': 'synthetic-model', 'api': self.api,
                'base_url': 'https://model.example.invalid/v1', 'max_output_tokens': 1800,
                'capabilities': {'stream': True}}


@pytest.mark.parametrize('api,payload', [
    ('chat', {'choices': [{'finish_reason': 'stop', 'message': {'content': '合成回答'}}]}),
    ('responses', {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '合成回答'}]}]}),
    ('messages', {'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': '合成回答'}]}),
])
def test_complete_protocols_use_the_configured_endpoint(api, payload):
    def respond(request):
        expected = {'chat': '/v1/chat/completions', 'responses': '/v1/responses', 'messages': '/v1/messages'}[api]
        assert request.url.path == expected
        header = 'x-api-key' if api == 'messages' else 'authorization'
        assert 'synthetic-test-key' in request.headers[header]
        return httpx.Response(200, json=payload)

    model = ModelClient(FixtureSettings(api), httpx.MockTransport(respond))
    assert asyncio.run(model.complete([{'role': 'user', 'content': '合成问题'}])) == ('合成回答', {})


@pytest.mark.parametrize('payload', [
    {'status': 'incomplete', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': '只有半句'}]}]},
    [],
])
def test_incomplete_or_malformed_response_is_not_success(payload):
    model = ModelClient(FixtureSettings('responses'), httpx.MockTransport(lambda request: httpx.Response(200, json=payload)))
    with pytest.raises(ModelError):
        asyncio.run(model.complete([{'role': 'user', 'content': '合成问题'}]))


@pytest.mark.parametrize('api,events', [
    ('chat', [{'choices': [{'delta': {'content': '合成回答'}}]}, {'choices': [{'delta': {}, 'finish_reason': 'stop'}]}]),
    ('responses', [{'type': 'response.output_text.delta', 'delta': '合成回答'}, {'type': 'response.completed', 'response': {'status': 'completed'}}]),
    ('messages', [{'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': '合成回答'}}, {'type': 'message_stop'}]),
])
def test_stream_protocols_emit_a_complete_normalized_answer(api, events):
    import json
    data = ''.join('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n' for event in events)
    model = ModelClient(FixtureSettings(api), httpx.MockTransport(lambda request: httpx.Response(200, content=data.encode(), headers={'content-type': 'text/event-stream'})))

    async def collect():
        return [event async for event in model.stream([{'role': 'user', 'content': '合成问题'}])]

    result = asyncio.run(collect())
    assert ''.join(event.get('text', '') for event in result) == '合成回答'
    assert result[-1]['type'] == 'done'
