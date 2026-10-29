"""Local bounded diagnostics. Never stores prompts, source text or credentials."""
import time
import uuid
from datetime import datetime, timezone


class Telemetry:
    def __init__(self, store):
        self.store = store
        with store.connection() as db:
            db.execute('CREATE TABLE IF NOT EXISTS request_traces (id TEXT PRIMARY KEY, at TEXT NOT NULL, route TEXT NOT NULL, elapsed_ms INTEGER NOT NULL, sources INTEGER NOT NULL, confirmed INTEGER NOT NULL, outcome TEXT NOT NULL)')

    def record(self, route, started, sources=0, confirmed=False, outcome='completed'):
        with self.store.connection() as db:
            db.execute('INSERT INTO request_traces VALUES (?,?,?,?,?,?,?)', (uuid.uuid4().hex, datetime.now(timezone.utc).isoformat(), route, max(0, int((time.monotonic() - started) * 1000)), int(sources), int(confirmed), outcome))
            db.execute('DELETE FROM request_traces WHERE rowid NOT IN (SELECT rowid FROM request_traces ORDER BY rowid DESC LIMIT 300)')

    def recent(self):
        with self.store.connection() as db:
            return [dict(row) for row in db.execute('SELECT * FROM request_traces ORDER BY rowid DESC LIMIT 300')]
