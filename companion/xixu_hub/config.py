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


CATALOG = json.loads((Path(__file__).resolve().parents[2] / 'shared' / 'provider-catalog.json').read_text('utf-8'))
PROVIDERS = {item['id']: item for item in CATALOG['providers']}


class Settings:
    def __init__(self, directory: Path):
        self.path = directory / 'settings.json'
        self.vault = Vault(directory)
        self.lock = threading.RLock()

    def read(self):
        with self.lock:
            data = json.loads(self.path.read_text('utf-8')) if self.path.exists() else {}
            return {'provider': 'qwen', 'model': 'qwen-plus', 'api': 'chat',
                    'base_url': PROVIDERS['qwen']['base_url'], 'max_output_tokens': 1800,
                    'capabilities': CATALOG['defaultCapabilities'].copy(), 'output_token_field': 'max_tokens', **data}

    def save(self, data):
        with self.lock:
            previous = self.read()
            profiles = previous.get('profiles', {}).copy()
            fields = ('provider', 'model', 'api', 'base_url', 'max_output_tokens', 'capabilities', 'output_token_field')
            profiles[previous['provider']] = {key: previous[key] for key in fields if key in previous}
            profiles[data['provider']] = {key: data[key] for key in fields if key in data}
            data = {**data, 'profiles': profiles}
            tmp = self.path.with_suffix('.tmp')
            tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), 'utf-8')
            tmp.replace(self.path)

    def public(self):
        data = self.read()
        fields = ('provider', 'model', 'api', 'base_url', 'max_output_tokens', 'capabilities', 'output_token_field', 'revision')
        public = {key: data[key] for key in fields if key in data}
        profiles = {name: {key: value[key] for key in fields if key in value} for name, value in data.get('profiles', {}).items()}
        return {**public, 'profiles': profiles, 'key_configured': bool(self.vault.get('model:' + data['provider'])), 'providers': PROVIDERS}
