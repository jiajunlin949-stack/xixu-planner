"""Immutable originals. Paths are derived only from validated SHA-256 digests."""
import hashlib
import os
import re
import tempfile
from pathlib import Path

MAX_FILE = 20 * 1024 * 1024
HASH = re.compile(r'^[a-f0-9]{64}$')


class Originals:
    def __init__(self, directory: Path):
        self.directory = directory
        directory.mkdir(parents=True, exist_ok=True)

    def path(self, key):
        if not isinstance(key, str) or not HASH.fullmatch(key):
            raise ValueError('原件编号无效。')
        return self.directory / key

    def put(self, content: bytes):
        if not content or len(content) > MAX_FILE:
            raise ValueError('单个原件须为 1 字节至 20 MiB。')
        key = hashlib.sha256(content).hexdigest()
        path = self.path(key)
        if path.exists():
            self.read(key)
            return key
        handle, name = tempfile.mkstemp(prefix='.writing-', dir=self.directory)
        try:
            with os.fdopen(handle, 'wb') as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            # Identical digest => identical bytes. Replacing a same-digest file
            # is harmless; files with other keys are never touched.
            os.replace(name, path)
        finally:
            if os.path.exists(name):
                os.unlink(name)
        self.read(key)
        return key

    def read(self, key):
        path = self.path(key)
        try:
            if path.stat().st_size > MAX_FILE:
                raise ValueError('原件超出支持范围。')
            content = path.read_bytes()
        except FileNotFoundError as exc:
            raise ValueError('缺少所引用的原文件或图片，未确认完整同步。') from exc
        if hashlib.sha256(content).hexdigest() != key:
            raise ValueError('原件校验失败，请保留源文件并重新导入。')
        return content
