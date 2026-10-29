"""App-scoped LAN CA. Never install a root certificate into the Windows store."""
import datetime as dt
import ipaddress
import json
import secrets
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

from .config import Settings


VIRTUAL_MARKERS = (
    'vethernet', 'hyper-v', 'vmware', 'virtualbox', 'vbox', 'docker', 'wsl',
    'tap-', 'tap_', 'tap adapter', 'tun', 'wintun', 'wireguard', 'openvpn',
    'zerotier', 'tailscale', 'radmin', 'clash', 'mihomo', 'sing-box', 'singbox',
    'npcap', 'loopback', 'bluetooth', '蓝牙', '虚拟',
)


def _virtual(name: str) -> bool:
    lowered = name.lower()
    return any(marker in lowered for marker in VIRTUAL_MARKERS)


def _primary_address():
    # A UDP connect sends no packet; it only asks the routing table which local
    # address would be used for the default route.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.settimeout(0.3)
            probe.connect(('223.5.5.5', 53))
            return probe.getsockname()[0]
    except OSError:
        return None


def addresses():
    """Phone-facing LAN addresses: real adapters first, virtual ones dropped."""
    import psutil
    stats = psutil.net_if_stats()
    physical, fallback = [], []
    for name, entries in psutil.net_if_addrs().items():
        if name in stats and not stats[name].isup:
            continue
        for entry in entries:
            if entry.family != socket.AF_INET:
                continue
            try:
                address = ipaddress.ip_address(entry.address)
            except ValueError:
                continue
            if not address.is_private or address.is_link_local or address.is_unspecified:
                continue
            fallback.append(str(address))
            if not _virtual(name):
                physical.append(str(address))
    # A machine whose only adapter is a VPN should still get a usable list,
    # so an empty physical set falls back to everything we saw.
    usable = sorted(set(physical or fallback))
    primary = _primary_address()
    if primary in usable:
        usable.remove(primary)
        usable.insert(0, primary)
    return ['127.0.0.1'] + usable


def ensure_tls(directory: Path):
    folder = directory / 'tls'
    folder.mkdir(parents=True, exist_ok=True)
    settings = Settings(directory)
    password = settings.vault.get('tls-password')
    if not password:
        password = secrets.token_urlsafe(36)
        settings.vault.set('tls-password', password)
    encryption = serialization.BestAvailableEncryption(password.encode())
    ca_path, ca_key_path = folder / 'ca.pem', folder / 'ca-encrypted.key'
    now = dt.datetime.now(dt.timezone.utc)
    if ca_path.exists() and ca_key_path.exists():
        ca = x509.load_pem_x509_certificate(ca_path.read_bytes())
        ca_key = serialization.load_pem_private_key(ca_key_path.read_bytes(), password.encode())
    else:
        ca_key = ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Personal Knowledge Hub Local CA')])
        ca = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(ca_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=5))
              .not_valid_after(now+dt.timedelta(days=1825)).add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.KeyUsage(digital_signature=True, content_commitment=False, key_encipherment=False,
                   data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
                   encipher_only=False, decipher_only=False), critical=True).sign(ca_key, hashes.SHA256()))
        ca_key_path.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption))
        ca_path.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    ips = addresses()
    cert_path, key_path, config_path = folder/'server.pem', folder/'server-encrypted.key', folder/'addresses.json'
    renew = not all(p.exists() for p in (cert_path, key_path, config_path))
    if not renew:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        renew = json.loads(config_path.read_text()) != ips or cert.not_valid_after_utc < now + dt.timedelta(days=7)
    if renew:
        key = ec.generate_private_key(ec.SECP256R1())
        subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, socket.gethostname()[:60])])
        cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(ca.subject).public_key(key.public_key())
                .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=5))
                .not_valid_after(now+dt.timedelta(days=365))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address(i)) for i in ips]), critical=False)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .sign(ca_key, hashes.SHA256()))
        cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption))
        config_path.write_text(json.dumps(ips), encoding='utf-8')
    return {'cert': str(cert_path), 'key': str(key_path), 'password': password, 'addresses': ips,
            'ca': ca.public_bytes(serialization.Encoding.PEM).decode()}


def pairing_bundle(directory, code):
    folder = Path(directory)/'tls'
    if not (folder/'ca.pem').exists():
        return None
    ips = json.loads((folder/'addresses.json').read_text())
    return {'version': 1, 'servers': [f'https://{i}:8766' for i in ips if i != '127.0.0.1'],
            'ca': (folder/'ca.pem').read_text(), 'code': code}
