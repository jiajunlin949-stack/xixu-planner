import os
from pathlib import Path
from uuid import uuid4


def pytest_configure(config):
    if config.option.basetemp is None:
        parent = Path(__file__).resolve().parents[1] / 'data' / 'test-runs'
        parent.mkdir(parents=True, exist_ok=True)
        config.option.basetemp = str(parent / ('run-' + uuid4().hex))
    if os.name != 'nt' and not os.getenv('XIXU_VAULT_KEY'):
        from cryptography.fernet import Fernet
        os.environ['XIXU_VAULT_KEY'] = Fernet.generate_key().decode()
