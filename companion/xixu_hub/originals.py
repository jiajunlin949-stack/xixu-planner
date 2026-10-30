"""Immutable originals. Paths are derived only from validated SHA-256 digests."""
import hashlib
import os
import re
import tempfile
from pathlib import Path

MAX_FILE = 2 ** 53 - 1  # Same exact integer range as the phone streaming protocol.
MAX_CHAT_FILE = 20 * 1024 * 1024  # Chat parsing is a separate memory-bounded operation.
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
            raise ValueError('原件为空或字节数超出可精确表示范围。')
        key = hashlib.sha256(content).hexdigest()
        path = self.path(key)
        if path.exists():
            self.verify(key)
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
        self.verify(key)
        return key

    def verify(self, key):
        path = self.path(key)
        try:
            expected = path.stat().st_size
            if not 1 <= expected <= MAX_FILE:
                raise ValueError('原件大小无效。')
            digest, size = hashlib.sha256(), 0
            with path.open('rb') as stream:
                while content := stream.read(256 * 1024):
                    digest.update(content)
                    size += len(content)
            if size != expected or digest.hexdigest() != key:
                raise ValueError('原件校验失败，请保留源文件并重新导入。')
            return size
        except FileNotFoundError as exc:
            raise ValueError('缺少所引用的原文件或图片。') from exc

    def put_file(self, source, expected_hash=''):
        source = Path(source)
        size = source.stat().st_size
        if not 1 <= size <= MAX_FILE:
            raise ValueError('原件大小无效。')
        digest = hashlib.sha256()
        with source.open('rb') as stream:
            while part := stream.read(256 * 1024):
                digest.update(part)
        key = digest.hexdigest()
        if expected_hash and key != expected_hash:
            raise ValueError('原件 SHA-256 不一致。')
        destination = self.path(key)
        if destination.exists():
            self.verify(key)
            return key
        fd, temporary = tempfile.mkstemp(prefix='.writing-', dir=self.directory)
        try:
            copied, second = 0, hashlib.sha256()
            with source.open('rb') as incoming, os.fdopen(fd, 'wb') as outgoing:
                while part := incoming.read(256 * 1024):
                    outgoing.write(part)
                    copied += len(part)
                    second.update(part)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            if copied != size or second.hexdigest() != key:
                raise ValueError('复制期间原件发生变化，未发布。')
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        self.verify(key)
        return key

    def read(self, key):
        self.verify(key)
        return self.path(key).read_bytes()
