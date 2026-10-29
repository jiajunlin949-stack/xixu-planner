"""Owner settings and OS-protected secrets, never returned through the API."""
import base64
import json
import os
import threading
from pathlib import Path

_VAULT_LOCKS = {}
_VAULT_REGISTRY_LOCK = threading.Lock()


class Vault:
    def __init__(self, directory: Path):
        self.path = directory / 'secrets.encrypted.json'
        with _VAULT_REGISTRY_LOCK:
            self.lock = _VAULT_LOCKS.setdefault(str(self.path.resolve()), threading.RLock())

    def get(self, name: str) -> str:
        with self.lock:
            values = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
            value = values.get(name)
            if not value:
                return ''
            raw = base64.b64decode(value)
            if os.name == 'nt':
                import win32crypt
                return win32crypt.CryptUnprotectData(raw, None, None, None, 0)[1].decode()
            from cryptography.fernet import Fernet
            return Fernet(os.environ['XIXU_VAULT_KEY'].encode()).decrypt(raw).decode()

    def set(self, name: str, value: str):
        with self.lock:
            values = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
            if value:
                if os.name == 'nt':
                    import win32crypt
                    encrypted = win32crypt.CryptProtectData(value.encode(), 'Personal Knowledge Hub', None, None, None, 0)
                else:
                    from cryptography.fernet import Fernet
                    encrypted = Fernet(os.environ['XIXU_VAULT_KEY'].encode()).encrypt(value.encode())
                values[name] = base64.b64encode(encrypted).decode()
            else:
                values.pop(name, None)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(values), encoding='utf-8')
            tmp.replace(self.path)


PROVIDERS = {
    'qwen': {'label': '通义千问', 'base_url': 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'model': 'qwen-plus', 'api': 'chat'},
    'deepseek': {'label': 'DeepSeek', 'base_url': 'https://api.deepseek.com', 'model': 'deepseek-flash', 'api': 'chat'},
    'kimi': {'label': 'Kimi', 'base_url': 'https://api.moonshot.cn/v1', 'model': '', 'api': 'chat'},
    'openai': {'label': 'OpenAI', 'base_url': 'https://api.openai.com/v1', 'model': '', 'api': 'responses'},
    'custom': {'label': '其他兼容接口', 'base_url': '', 'model': '', 'api': 'chat'},
}


class Settings:
    def __init__(self, directory: Path):
        self.path = directory / 'settings.json'
        self.vault = Vault(directory)
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            data = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
            return {'provider': 'qwen', 'model': 'qwen-plus', 'api': 'chat',
                    'base_url': PROVIDERS['qwen']['base_url'], 'max_output_tokens': 1800, **data}

    def save(self, data):
        with self.lock:
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), 'utf-8')
            tmp.replace(self.path)

    def public(self):
        data = self.read()
        return {**data, 'key_configured': bool(self.vault.get('model:' + data['provider'])), 'providers': PROVIDERS}
