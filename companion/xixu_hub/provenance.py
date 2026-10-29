"""Message provenance; original send time is never replaced with ingestion time."""
from datetime import datetime, timedelta, timezone
import json

LOCAL = timezone(timedelta(hours=8))
SCHEMA = 2


def time_fields(value):
    if value is None or value == '':
        return {}
    try:
        if isinstance(value, (int, float)) or str(value).replace('.', '', 1).isdigit():
            seconds = float(value)
            if seconds > 100_000_000_000:
                seconds /= 1000
            date = datetime.fromtimestamp(seconds, timezone.utc)
        else:
            date = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            if date.tzinfo is None:
                date = date.replace(tzinfo=LOCAL)
        if not 2000 <= date.year <= 2200:
            raise ValueError()
        local = date.astimezone(LOCAL)
        return {'sent_at_unix': int(date.timestamp()), 'sent_at': local.isoformat(timespec='seconds'),
                'sent_at_local': local.strftime('%Y-%m-%d %H:%M:%S') + ' UTC+08:00', 'timezone': 'Asia/Shanghai'}
    except (ValueError, TypeError, OverflowError, OSError) as exc:
        raise ValueError('原始发送时间无效，请填写真实日期时间；留空表示未知。') from exc


def manual_context(conversation_name='', sender_name='', sent_at=''):
    metadata = time_fields(sent_at.strip())
    if conversation_name.strip():
        metadata['conversation_name'] = conversation_name.strip()
    if sender_name.strip():
        metadata.update(sender_name=sender_name.strip(), sender=sender_name.strip())
    if metadata:
        metadata['context_origin'] = 'user_entered'
    return metadata


def contextual_text(text, metadata):
    if not any(k in metadata for k in ('conversation_name', 'sender_name', 'sent_at_local')):
        return text
    sender = metadata.get('sender_name') or metadata.get('sender_id') or '未知发言者'
    if metadata.get('sender_id') and metadata['sender_id'] != sender:
        sender += '（' + metadata['sender_id'] + '）'
    return ('会话：' + (metadata.get('conversation_name') or '未知会话') + '\n发送者：' + sender +
            '\n原始发送时间：' + (metadata.get('sent_at_local') or '未知') + '\n\n' + text)


def wechat_metadata(source_id, stream, message, owner=None):
    owner = owner or {}
    sender_id = str(message.get('sender_id') or message.get('sender') or '')
    if sender_id == '未知发言者':
        sender_id = ''
    sender_name = message.get('sender_name') or message.get('sender') or sender_id or '未知发言者'
    conversation_id = stream.get('conversation_id', '')
    result = {'source_type': 'wechat', 'source_id': source_id, 'stream': stream['id'],
              'message_id': str(message['id']), 'message_type': 'text', 'sender': sender_name,
              'server_message_id': str(message.get('server_message_id') or ''),
              'sender_id': sender_id, 'sender_name': sender_name,
              'conversation_id': conversation_id, 'conversation_name': stream.get('title') or '未知会话',
              'is_group': conversation_id.endswith('@chatroom') if conversation_id else None,
              'timestamp': message.get('timestamp'), 'provenance_schema': SCHEMA,
              'account_id': owner.get('account_id', ''), 'account_name': owner.get('account_name', '')}
    if result['account_id'] and sender_id:
        result['sender_is_self'] = sender_id == result['account_id']
    try:
        result.update(time_fields(message.get('timestamp')))
    except ValueError:
        result['timestamp_invalid'] = True
    return result


def vector_record(chunk, vector, document):
    metadata = json.loads(document['metadata']) if isinstance(document['metadata'], str) else document['metadata']
    result = {'id': chunk['id'], 'vector': vector, 'document_id': chunk['document_id'],
              'document_version': chunk['version'], 'text': chunk['text'], 'title': document['title'],
              'source_key': document['source_key'], 'source_type': metadata.get('source_type', 'file'),
              'start': chunk['start'], 'end': chunk['end'], 'ingested_at': document['updated_at'],
              'metadata_schema_version': SCHEMA}
    keys = ('sender_id', 'sender_name', 'sender_is_self', 'conversation_id', 'conversation_name', 'is_group',
            'sent_at', 'sent_at_local', 'sent_at_unix', 'timezone', 'account_id', 'account_name',
            'message_id', 'server_message_id', 'message_type', 'stream', 'source_id', 'context_origin', 'image_id', 'audio_id')
    for key in keys:
        if metadata.get(key) is not None:
            result[key] = metadata[key]
    return result
