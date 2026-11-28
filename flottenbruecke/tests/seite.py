"""A bridge of its own for tests and pictures that need a browser (#246): the app in a uvicorn thread on a free port of
127.0.0.1 (LAN entry and the entry of the machine), filled with the example data from beispiel/. Never the running fleet.

    python -m tests.seite 4797     # serves on 4797 (LAN) and 4798 (machine) until Ctrl+C, data under %TEMP%
"""
import json
import socket
import sys
import tempfile
import threading
import time
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn

from app import main

BEISPIEL = Path(__file__).parent.parent / 'beispiel'
PIN = '4711'
# the clock of the example data: reports are fresh, nothing is stale
JETZT = datetime(2026, 11, 20, 14, 31, 10, tzinfo=timezone.utc)


def frei() -> int:
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def _post(basis: str, pfad: str, body, kopf: dict | None = None) -> dict:
    r = urllib.request.Request(basis + pfad, json.dumps(body).encode(), {'Content-Type': 'application/json', **(kopf or {})})
    with urllib.request.urlopen(r) as a:
        return json.loads(a.read() or b'null')


def _get(basis: str, pfad: str):
    with urllib.request.urlopen(basis + pfad) as a:
        return json.loads(a.read())


def fuellen(basis: str) -> None:
    """The example data as the README sends it, plus the condensed history and a chat with a question and a draft."""
    lies = lambda n: json.loads((BEISPIEL / n).read_text(encoding='utf-8'))  # noqa: E731
    for n in ('bericht.json', 'bericht-notizen.json', 'bericht-spec.json'):
        _post(basis, '/api/bericht', lies(n))
    _post(basis, '/api/werft', lies('werft.json'))
    for b in lies('holodeck.json'):
        _post(basis, '/api/holodeck', b)
    for v in lies('verlauf.json'):
        _post(basis, '/api/verlauf', v)


def chat_fuellen(basis: str, cookie: str) -> None:
    """A chat as a paired device begins it and the service on STATION-A answers it (beispiel/chat.json)."""
    c = json.loads((BEISPIEL / 'chat.json').read_text(encoding='utf-8'))
    _get(basis, '/api/chat/nachrichten?rechner=STATION-A&konten=1,2')
    erste = c['nachrichten'][0]
    _post(basis, '/api/chat', {'forge': erste['forge'], 'konto': erste['konto'], 'modell': None, 'text': erste['text']}, {'Cookie': cookie, 'Origin': basis})
    for n in _get(basis, '/api/chat/nachrichten?rechner=STATION-A&konten=1,2'):
        _post(basis, f"/api/chat/nachrichten/{n['id']}/quittung", {'rechner': 'STATION-A'})
        _post(basis, f"/api/chat/nachrichten/{n['id']}/antwort", {**c['antworten'][0], 'entwurf': c['nachrichten'][1]['entwurf']})


def koppeln(basis: str, name: str = 'Testgerät') -> str:
    """Pairs a device; returns its cookie as a Cookie header value."""
    r = urllib.request.Request(basis + '/api/geraete/koppeln', json.dumps({'name': name}).encode(), {'Content-Type': 'application/json', 'X-Bruecke-Pin': PIN})
    with urllib.request.urlopen(r) as a:
        roh = a.headers['Set-Cookie']
    return roh.split(';', 1)[0]


@contextmanager
def bruecke(lan: int | None = None, rechner: int | None = None, ordner: str | None = None):
    """Yields (LAN base URL, machine base URL); the machine entry is a port of its own instead of RECHNERPORT."""
    lan = lan or frei()
    rechner = rechner or frei()
    ordner = ordner or tempfile.mkdtemp(prefix='bruecke-klartext-')
    alt, main.RECHNERPORT = main.RECHNERPORT, rechner
    app = main.erzeuge(main.Einstellung(db=str(Path(ordner) / 'b.db'), pin=PIN, uhr=lambda: JETZT))
    server = [uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=p, log_level='warning')) for p in (lan, rechner)]
    faeden = [threading.Thread(target=s.run, daemon=True) for s in server]
    for f in faeden:
        f.start()
    while not all(s.started for s in server):
        time.sleep(0.05)
    try:
        yield f'http://localhost:{lan}', f'http://localhost:{rechner}'
    finally:
        for s in server:
            s.should_exit = True
        for f in faeden:
            f.join(5)
        main.RECHNERPORT = alt


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4797
    with bruecke(port, port + 1) as (basis, am_rechner):
        fuellen(basis)
        chat_fuellen(basis, koppeln(basis, 'Bildgerät'))
        print(f'Brücke auf {basis}, am Rechner {am_rechner}; Ctrl+C beendet', flush=True)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass
