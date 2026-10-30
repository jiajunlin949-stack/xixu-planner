"""Consistent local backup of canonical records and referenced original bytes."""
import hashlib
import json
import os
import tempfile
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile


def backup(store, originals, destination):
    destination = Path(destination)
    if destination.exists():
        raise ValueError('备份目标已存在，未覆盖，请使用新文件名。')
    destination.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.xixu-backup-', suffix='.zip', dir=destination.parent)
    os.close(handle)
    try:
        # Hold a SQLite read snapshot while recording document data. Original
        # blobs are immutable and never garbage-collected behind this snapshot.
        with store.connection() as db:
            db.execute('BEGIN')
            rows = [dict(row) for row in db.execute('SELECT id,source_key,title,text,version,updated_at,metadata FROM documents ORDER BY id')]
        assets = set()
        for row in rows:
            row['metadata'] = json.loads(row['metadata'])
            assets.update(row['metadata'].get('asset_hashes', []))
            if row['metadata'].get('original_hash'):
                assets.add(row['metadata']['original_hash'])
        manifest = {'format': 'xixu-companion-backup', 'version': 1, 'documents': rows, 'originals': []}
        with ZipFile(temporary, 'w', compression=ZIP_STORED, allowZip64=True) as archive:
            for key in sorted(assets):
                size = originals.verify(key)
                archive.write(originals.path(key), 'originals/' + key)
                manifest['originals'].append({'sha256': key, 'bytes': size})
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2).encode())
        # Reopen and independently check manifest/bytes before publishing.
        with ZipFile(temporary) as archive:
            for item in manifest['originals']:
                digest, size = hashlib.sha256(), 0
                with archive.open('originals/' + item['sha256']) as stream:
                    while content := stream.read(256 * 1024):
                        size += len(content)
                        digest.update(content)
                if size != item['bytes'] or digest.hexdigest() != item['sha256']:
                    raise ValueError('备份原件校验失败，未发布备份文件。')
        # Same-directory hard-link publication is atomic and refuses an existing
        # destination; a failed write never leaves a completed-looking backup.
        with open(temporary, 'rb+') as stream:
            os.fsync(stream.fileno())
        os.link(temporary, destination)
        return {'documents': len(rows), 'originals': len(assets), 'file': str(destination)}
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
