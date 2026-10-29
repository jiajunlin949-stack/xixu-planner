import argparse
import json
import os
import threading
import webbrowser
from pathlib import Path

from .app import create_app, owner_token
from .chat_exports import parse_chat
from .originals import Originals, MAX_FILE
from .store import Store


def main():
    parser = argparse.ArgumentParser(description='汐序个人电脑知识库：默认仅监听本机，不含任何私人资料。')
    parser.add_argument('--data', type=Path, default=Path(__file__).resolve().parents[1] / 'data')
    sub = parser.add_subparsers(dest='command', required=True)
    serve = sub.add_parser('serve')
    serve.add_argument('--mode', choices=['notes', 'extended'], default='extended')
    serve.add_argument('--backend', choices=['milvus', 'chroma'], default='milvus')
    serve.add_argument('--semantic', action='store_true', help='启用真实本地 Embedding；需先安装向量依赖，首次可能下载模型')
    serve.add_argument('--lan', action='store_true', help='显式启用手机 HTTPS 配对端口 8766，不修改防火墙')
    serve.add_argument('--open', action='store_true', help='在本机浏览器打开管理页；管理密钥不会打印到终端')
    imports = sub.add_parser('import-chat')
    imports.add_argument('--platform', required=True, choices=['qq', 'dingtalk', 'wechat'])
    imports.add_argument('--file', required=True, type=Path)
    imports.add_argument('--conversation-name', default='')
    imports.add_argument('--account-id', default='')
    imports.add_argument('--confirm', action='store_true', help='明确确认后才写入；默认只核对条数与警告')
    exports = sub.add_parser('backup')
    exports.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    if os.name != 'nt' and not os.getenv('XIXU_VAULT_KEY'):
        from cryptography.fernet import Fernet
        key = args.data / 'vault.key'
        if not key.exists():
            with key.open('xb') as stream:
                stream.write(Fernet.generate_key())
            key.chmod(0o600)
        os.environ['XIXU_VAULT_KEY'] = key.read_text().strip()
    if args.command == 'serve':
        import uvicorn
        token = owner_token(args.data)
        app = create_app(args.data, token=token, mode=args.mode, backend=args.backend, semantic=args.semantic)
        if args.lan:
            from .tls import ensure_tls
            tls = ensure_tls(args.data)
            phone = create_app(args.data, token=token, mode=args.mode, backend=args.backend, semantic=args.semantic, device_only=True)
            threading.Thread(target=uvicorn.run, kwargs={'app': phone, 'host': '0.0.0.0', 'port': 8766,
                'ssl_certfile': tls['cert'], 'ssl_keyfile': tls['key'], 'ssl_keyfile_password': tls['password'],
                'access_log': False}, daemon=True).start()
        if args.open:
            threading.Timer(1.5, lambda: webbrowser.open('http://127.0.0.1:8765/#' + token)).start()
        print('电脑管理页：http://127.0.0.1:8765/。管理密钥保存在本次 data 目录的 access.token；勿提交或转发。')
        uvicorn.run(app, host='127.0.0.1', port=8765, access_log=False)
        return
    store, originals = Store(args.data / 'knowledge.sqlite3'), Originals(args.data / 'originals')
    if args.command == 'backup':
        from .backup import backup
        print(json.dumps(backup(store, originals, args.output), ensure_ascii=False))
        return
    if not args.file.is_file() or args.file.stat().st_size > MAX_FILE:
        raise SystemExit('文件不存在或超过 20 MiB，未读取或导入。')
    content = args.file.read_bytes()
    parsed = parse_chat(args.platform, args.file.name, content, conversation_name=args.conversation_name, account_id=args.account_id)
    result = {key: value for key, value in parsed.items() if key != 'records'}
    if args.confirm:
        originals.put(content)
        written = store.upsert_many(parsed['records'])
        result.update(committed=True, changed=sum(item['changed'] for item in written))
    else:
        result.update(committed=False, notice='本次仅核对，未入库；确认格式和条数后加 --confirm。')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
