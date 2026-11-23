# Start of the bridge in the container: plain HTTP as before; HTTPS in the LAN (#37) when
# BRUECKE_ZERT and BRUECKE_ZERT_SCHLUESSEL name a certificate and its key (mkcert), as the phone's
# Web-Push needs. `python -m app.start --gesund` is the health check for either.

import os
import ssl
import sys
import urllib.request

PORT = 8000


def zertifikat(env) -> tuple[str, str] | None:
    zert, schluessel = env.get('BRUECKE_ZERT', ''), env.get('BRUECKE_ZERT_SCHLUESSEL', '')
    if bool(zert) != bool(schluessel):
        raise SystemExit('BRUECKE_ZERT und BRUECKE_ZERT_SCHLUESSEL gehören zusammen: beide setzen (HTTPS) oder beide leer lassen (HTTP).')
    return (zert, schluessel) if zert else None


def optionen(env) -> dict:
    o = {'host': '0.0.0.0', 'port': PORT, 'factory': True, 'server_header': False}
    z = zertifikat(env)
    return {**o, 'ssl_certfile': z[0], 'ssl_keyfile': z[1]} if z else o


def adresse(env) -> str:
    return f"{'https' if zertifikat(env) else 'http'}://127.0.0.1:{PORT}/healthz"


if __name__ == '__main__':
    if '--gesund' in sys.argv:
        # the certificate names the machine in the LAN, not 127.0.0.1: here only whether it answers
        urllib.request.urlopen(adresse(os.environ), timeout=2, context=ssl._create_unverified_context())
    else:
        import uvicorn

        uvicorn.run('app.main:erzeuge', **optionen(os.environ))
