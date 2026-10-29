"""QQ / DingTalk export adapters, without logging in or guessing account data.

These adapters parse user-provided files. Receiving a bot event/export does not
grant access to the owner's entire account history or attachment bytes.
"""
import csv
import hashlib
import io
import json
import re
from collections import Counter
from pathlib import PurePosixPath

from .provenance import time_fields

MAX_MESSAGES = 20000
MAX_TEXT = 4_000_000


def decode_text(content):
    encodings = ['utf-16'] if content.startswith((b'\xff\xfe', b'\xfe\xff')) else ['utf-8-sig', 'gb18030']
    for encoding in encodings:
        try:
            text = content.decode(encoding)
            if '\0' in text:
                raise ValueError('聊天文件含有二进制内容，请导出为文字、CSV 或 JSON。')
            return text
        except UnicodeDecodeError:
            continue
    raise ValueError('无法完整读取聊天文件编码。')


def first(value, *keys, default=''):
    for key in keys:
        if key in value and value[key] is not None and value[key] != '':
            return value[key]
    return default


def message_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        result = first(value, 'content', 'text')
        if isinstance(result, str):
            return result
    raise ValueError('消息正文结构不支持；未跳过此消息继续导入。')


def json_messages(raw):
    try:
        value = json.loads(raw)
    except ValueError as exc:
        raise ValueError('聊天 JSON 无法解析。') from exc
    context = {}
    if isinstance(value, dict):
        context = {key: value[key] for key in ('conversation_id', 'conversation_name', 'account_id', 'is_group') if key in value}
        if value.get('t') in ('GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'MESSAGE_CREATE', 'AT_MESSAGE_CREATE', 'DIRECT_MESSAGE_CREATE') and isinstance(value.get('d'), dict):
            value = value['d']
        elif isinstance(value.get('data'), dict) and isinstance(value['data'].get('messages'), list):
            value = value['data']
        for key in ('messages', 'records', 'items'):
            if key in value:
                value = value[key]
                break
        else:
            # Also accept a single QQ/DingTalk event, explicitly labelled by the
            # platform selected in the import UI, not arbitrary account JSON.
            if 'content' in value or 'text' in value:
                value = [value]
    if not isinstance(value, list) or not value:
        raise ValueError('未找到 messages / records / items 消息列表。')
    return value, context


def qq_text(raw):
    header = re.compile(r'^(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}:\d{2})[ \t]+(.+?)[ \t]*$')
    messages, current, body, context = [], None, [], {}
    def flush():
        if current is not None:
            messages.append({**current, 'text': ''.join(body)})
    for line in raw.splitlines(keepends=True):
        match = header.match(line.rstrip('\r\n'))
        if match:
            flush()
            speaker = match[2]
            author = re.match(r'^(.*?)[(<]([^()<>]+)[)>]$', speaker)
            current = {'timestamp': match[1].replace('/', '-'), 'sender_name': author[1] if author else speaker,
                       'sender_id': author[2] if author else ''}
            body = []
        elif current is not None:
            body.append(line)
        elif line.startswith(('消息对象:', '消息对象：')):
            context['conversation_name'] = re.split('[:：]', line, 1)[1].strip()
        elif line.strip() and not (line.startswith(('消息记录', '消息分组', '导出时间')) or re.fullmatch(r'[=\-\s]+', line)):
            raise ValueError('QQ 文本消息头之前有未识别内容，请使用标准导出格式或 JSON。')
    flush()
    if not messages:
        raise ValueError('未找到“日期 时间 发言者”的 QQ 文本消息头。')
    return messages, context


def parse_chat(platform, name, content, *, conversation_name='', account_id=''):
    if platform not in ('qq', 'dingtalk', 'wechat'):
        raise ValueError('请选择 QQ、钉钉或微信聊天文件。')
    name = PurePosixPath(name.replace('\\', '/')).name
    if not name or len(name) > 200:
        raise ValueError('聊天文件名无效。')
    raw = decode_text(content)
    suffix = PurePosixPath(name).suffix.lower()
    if suffix == '.json':
        messages, context = json_messages(raw)
    elif suffix == '.csv':
        reader = csv.DictReader(io.StringIO(raw), strict=True)
        if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError('CSV 缺少列名或含重复列。')
        try:
            messages, context = list(reader), {}
        except csv.Error as exc:
            raise ValueError('CSV 引号或换行结构无效，未静默拼接消息。') from exc
    elif suffix == '.txt' and platform == 'qq':
        messages, context = qq_text(raw)
    else:
        raise ValueError('QQ 支持标准 TXT、JSON、CSV；钉钉/微信支持显式导出的 JSON、CSV，不读取加密数据库。')
    if not messages or len(messages) > MAX_MESSAGES:
        raise ValueError('每批须为 1 至 20000 条消息；超限不会截断导入。')
    records, warnings, identities, occurrences, total = [], set(), {}, Counter(), 0
    original_hash = hashlib.sha256(content).hexdigest()
    for index, item in enumerate(messages):
        if not isinstance(item, dict) or None in item:
            raise ValueError(f'第 {index + 1} 条消息结构不完整。')
        author = item.get('author') or {}
        if not isinstance(author, dict):
            raise ValueError('消息 author 须为对象。')
        text_value = first(item, 'text', 'content', '正文', '消息内容')
        if text_value == '' and first(item, 'msgtype', 'message_type', '消息类型', default='text') != 'text':
            text = '[非文字消息：原记录保留，媒体原件未提供]'
            warnings.add('包含非文字消息；原导出文件保留，但未提供的图片/语音不能恢复为媒体原件。')
        else:
            text = message_text(text_value)
            if not text:
                raise ValueError(f'第 {index + 1} 条消息缺少正文，未静默跳过。')
        attachments = item.get('attachments') or item.get('images')
        if attachments or re.search(r'\[(图片|语音|文件|表情|视频)\]', text):
            warnings.add('消息含附件引用或占位符；仅引用不代表附件字节已导入，未自动下载链接。')
        sender_id = str(first(item, 'sender_id', 'senderId', 'senderStaffId', '发送者ID', default=first(author, 'member_openid', 'user_openid', 'id')))
        sender_name = str(first(item, 'sender_name', 'senderNick', 'senderName', '发送者', default=first(author, 'username', 'name', default=sender_id)))
        conversation_id = str(first(item, 'conversation_id', 'conversationId', 'group_openid', 'channel_id', '会话ID', default=context.get('conversation_id') or ''))
        title = str(first(item, 'conversation_name', 'conversationTitle', '会话名称', default=conversation_name or context.get('conversation_name') or PurePosixPath(name).stem))
        when = first(item, 'sent_at', 'timestamp', 'createTime', 'sendTime', '发送时间')
        message_id = str(first(item, 'message_id', 'msgId', 'id', '消息ID'))
        metadata = {'source_type': platform, 'sender_id': sender_id, 'sender_name': sender_name,
                    'conversation_id': conversation_id, 'conversation_name': title,
                    'account_id': str(account_id or context.get('account_id') or ''),
                    'original_hash': original_hash, 'filename': name, 'export_index': index,
                    'origin': 'user_export', 'timestamp_original': when,
                    'attachment_references_only': bool(attachments)}
        metadata.update(time_fields(when))
        if not when:
            warnings.add('部分消息没有原始发送时间，保持未知，未以导入时间替代。')
        if not sender_name:
            warnings.add('部分消息缺少发言者，保持未知。')
        group = first(item, 'is_group', default=context.get('is_group'))
        if group is None and str(item.get('conversationType', '')) in ('1', '2'):
            group = str(item['conversationType']) == '2'
        if isinstance(group, str) and group.lower() in ('true', 'false', '1', '0'):
            group = group.lower() in ('true', '1')
        if isinstance(group, bool):
            metadata['is_group'] = group
        identity_scope = '\n'.join([platform, metadata['account_id'], conversation_id or title])
        if not message_id:
            basis = json.dumps([identity_scope, when, sender_id, sender_name, text], ensure_ascii=False)
            occurrence = occurrences[basis]
            occurrences[basis] += 1
            message_id = 'derived:' + hashlib.sha256((basis + '\n' + str(occurrence)).encode()).hexdigest()
            metadata['message_id_derived'] = True
        metadata['message_id'] = message_id
        source_key = 'chat:' + hashlib.sha256((identity_scope + '\n' + message_id).encode()).hexdigest()
        fingerprint = json.dumps([text, sender_id, sender_name, when], ensure_ascii=False)
        if source_key in identities:
            if identities[source_key] != fingerprint:
                raise ValueError('同一消息编号对应不同内容，未覆盖或导入；请分开核对导出来源。')
            raise ValueError('批次中有重复消息编号，请先核对原导出，未静默合并。')
        identities[source_key] = fingerprint
        total += len(text)
        if total > MAX_TEXT or len(text) > 50000:
            raise ValueError('聊天文字总量超过 400 万字符或单条超过 50000 字符，请分批，未截断导入。')
        records.append({'source_key': source_key, 'title': title + ' · ' + (sender_name or '未知发言者'), 'text': text, 'metadata': metadata})
    return {'records': records, 'warnings': sorted(warnings), 'messages': len(records), 'original_hash': original_hash,
            'notice': '仅导入所提供文件中的记录，不代表该账号的全部历史已同步。'}
