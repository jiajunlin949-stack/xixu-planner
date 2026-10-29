import hashlib
import secrets
import time
import uuid


def hashed(token):
    return hashlib.sha256(token.encode()).hexdigest()


class Devices:
    def __init__(self, store, owner_token):
        self.store, self.owner_token = store, owner_token

    def authenticate(self, value):
        if secrets.compare_digest(value, 'Bearer ' + self.owner_token):
            return {'id': 'owner', 'role': 'owner'}
        if not value.startswith('Bearer '):
            return None
        with self.store.connection() as db:
            row = db.execute('SELECT id FROM devices WHERE token_hash=? AND revoked=0', (hashed(value[7:]),)).fetchone()
        return {'id': row['id'], 'role': 'device'} if row else None

    def code(self):
        code = ''.join(secrets.choice('0123456789') for _ in range(8))
        expires = time.time() + 300
        with self.store.connection() as db:
            db.execute('DELETE FROM pairing')
            db.execute('INSERT INTO pairing VALUES (?,?,0)', (hashed(code), expires))
        return code, expires

    def pair(self, code, name):
        with self.store.connection() as db:
            # One short-lived code, globally capped attempts; no per-IP bypass.
            row = db.execute('SELECT * FROM pairing LIMIT 1').fetchone()
            if not row or row['expires'] < time.time() or row['attempts'] >= 5:
                return None
            db.execute('UPDATE pairing SET attempts=attempts+1')
            if not secrets.compare_digest(row['code_hash'], hashed(code)):
                return None
            token = secrets.token_urlsafe(36)
            device_id = uuid.uuid4().hex
            db.execute('INSERT INTO devices VALUES (?,?,?,?,0)', (device_id, name, hashed(token), str(time.time())))
            db.execute('DELETE FROM pairing')
        return {'device_id': device_id, 'token': token, 'permissions': ['search', 'chat', 'source_excerpt']}
