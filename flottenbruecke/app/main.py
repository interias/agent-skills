# Flottenbrücke (#28): the board of every deployment of the fleet driver and the way back for the
# answers of the person. Viewing is free in the LAN; answering needs the PIN from .env. The bridge
# steers nothing else: no start, stop or merge.

import hmac
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from .modelle import Antwort, Bericht
from .speicher import Speicher
from .tafel import HERKUNFT, tafel

STATIC = Path(__file__).parent / 'static'
FEHLVERSUCHE = 5
SPERRE_S = 300


@dataclass
class Einstellung:
    db: str = '/data/bruecke.db'
    pin: str = ''
    # optional: when set, report, fetch and acknowledge need the header X-Bruecke-Token
    token: str = ''
    tz: str = 'Europe/Berlin'
    uhr: object = field(default=lambda: datetime.now(timezone.utc))

    @classmethod
    def aus_umgebung(cls) -> 'Einstellung':
        return cls(db=os.environ.get('BRUECKE_DB', cls.db), pin=os.environ.get('BRUECKE_PIN', ''), token=os.environ.get('BRUECKE_TOKEN', ''), tz=os.environ.get('BRUECKE_TZ', cls.tz))


class Pinwache:
    """At most FEHLVERSUCHE wrong PINs per client, then SPERRE_S seconds nothing."""

    def __init__(self):
        self.fehler: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def pruefe(self, soll: str, ist: str | None, client: str) -> None:
        if not soll:
            raise HTTPException(403, 'Keine PIN gesetzt (BRUECKE_PIN in .env): Antworten ist abgeschaltet.')
        jetzt = time.monotonic()
        with self.lock:
            liste = [t for t in self.fehler.get(client, []) if jetzt - t < SPERRE_S]
            self.fehler[client] = liste
            if len(liste) >= FEHLVERSUCHE:
                raise HTTPException(429, 'Zu viele falsche PINs, bitte später wieder.')
            if ist is not None and hmac.compare_digest(soll.encode(), ist.encode()):
                self.fehler.pop(client, None)
                return
            liste.append(jetzt)
        raise HTTPException(401, 'PIN falsch.')


def erzeuge(e: Einstellung | None = None) -> FastAPI:
    e = e or Einstellung.aus_umgebung()
    tz = ZoneInfo(e.tz)
    speicher = Speicher(e.db)
    wache = Pinwache()
    app = FastAPI(title='Flottenbrücke', docs_url=None, redoc_url=None, openapi_url=None)

    def jetzt() -> datetime:
        return e.uhr()

    def stempel() -> str:
        return jetzt().isoformat(timespec='seconds')

    def treiber(token: str | None) -> None:
        if e.token and not (token and hmac.compare_digest(e.token.encode(), token.encode())):
            raise HTTPException(401, 'Treiber-Token fehlt oder falsch.')

    # ---- driver

    @app.post('/api/bericht')
    def bericht(b: Bericht, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        neu = speicher.bericht_speichern(b.forge, b.model_dump(), stempel())
        return {'ok': True, 'neu': neu}

    @app.get('/api/antworten')
    def abholen(forge: str, x_bruecke_token: str | None = Header(None)) -> list[dict]:
        treiber(x_bruecke_token)
        return [{'id': a['id'], 'epic': a['epic'], 'nr': a['nr'], 'seit': a['seit'], 'text': a['text'], 'zeit': a['zeit'], 'herkunft': HERKUNFT} for a in speicher.abholen(forge, stempel())]

    @app.post('/api/antworten/{id_}/quittung')
    def quittieren(id_: int, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        if not speicher.quittieren(id_, stempel()):
            raise HTTPException(404, 'Keine solche Antwort.')
        return {'ok': True}

    # ---- page

    @app.get('/api/tafel')
    def board() -> dict:
        return tafel(speicher.projekte(), speicher.stufen_seit(), speicher.antworten(), jetzt(), tz, bool(e.pin))

    @app.post('/api/pin', status_code=204)
    def pin(request: Request, x_bruecke_pin: str | None = Header(None)) -> Response:
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        return Response(status_code=204)

    @app.post('/api/antwort')
    def antworten(a: Antwort, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        p = speicher.projekt(a.forge)
        f = next((f for f in (p['bericht']['fragen'] if p else []) if f['epic'] == a.epic and f['nr'] == a.nr and f['seit'] == a.seit), None)
        if f is None:
            raise HTTPException(404, 'Diese Frage ist nicht offen.')
        if f.get('beantwortet'):
            raise HTTPException(409, 'Die Frage ist schon beantwortet.')
        gespeichert = speicher.antwort_setzen(a.forge, a.epic, a.nr, a.seit, a.text.strip(), stempel())
        if gespeichert is None:
            raise HTTPException(409, 'Der Treiber hat die Antwort schon abgeholt.')
        return {'ok': True, 'id': gespeichert['id']}

    @app.get('/healthz')
    def gesund() -> dict:
        return {'ok': True}

    @app.get('/')
    def seite() -> FileResponse:
        return FileResponse(STATIC / 'index.html', headers={'Cache-Control': 'no-cache'})

    app.mount('/static', StaticFiles(directory=STATIC), name='static')
    return app
