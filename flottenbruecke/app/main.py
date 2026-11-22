# Flottenbrücke (#28): the board of every deployment of the fleet driver and the way back for the
# answers of the person. Viewing is free in the LAN; answering needs the PIN from .env. Besides the
# answers the bridge carries actions to the driver, which carries them out: requeue or give up a
# blocked epic, revoke a decision of the admiral, change a setting of the driver (#59), take a released
# epic in, pause or continue an epic and set its priority (#61), and set how an epic merges (#112): the
# bridge only tightens, merge.ps1 stays the hard limit. No merge of its own, no abort. The Holodeck (#44)
# shows the prototypes each driver sends, sealed off from the bridge.

import hashlib
import hmac
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles

from .modelle import Antwort, Bericht, Handlung, Holodeck, einstellung_pruefen
from .speicher import Speicher
from .tafel import HERKUNFT, tafel

STATIC = Path(__file__).parent / 'static'
FEHLVERSUCHE = 5
SPERRE_S = 300

# A prototype runs in an opaque origin (sandbox without allow-same-origin): it can neither read the
# bridge's localStorage (the PIN) nor its cookies nor the answers of its API. Static resources from
# https: may load (fonts, scripts from CDNs), connections may not.
HOLODECK_KOEPFE = {
    'Content-Security-Policy': '; '.join([
        'sandbox allow-scripts',
        "default-src 'none'",
        "script-src https: 'unsafe-inline' 'unsafe-eval'",
        "style-src https: 'unsafe-inline'",
        'img-src https: data: blob:',
        'font-src https: data:',
        'media-src https: data: blob:',
        "connect-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
        "frame-ancestors 'self'",
    ]),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-cache',
}


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
        # the contract: beispiel/antworten.json
        return [{'id': a['id'], 'epic': a['epic'], 'nr': a['nr'], 'seit': a['seit'], 'option': a['option'], 'text': a['text'] or None, 'zeit': a['zeit'], 'herkunft': HERKUNFT} for a in speicher.abholen(forge, stempel())]

    @app.post('/api/antworten/{id_}/quittung')
    def quittieren(id_: int, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        if not speicher.quittieren(id_, stempel()):
            raise HTTPException(404, 'Keine solche Antwort.')
        return {'ok': True}

    @app.get('/api/handlungen')
    def handlungen_abholen(forge: str, x_bruecke_token: str | None = Header(None)) -> list[dict]:
        treiber(x_bruecke_token)
        return [{'id': h['id'], 'epic': h['epic'], 'art': h['art'], 'nr': h['nr'], 'seit': h['seit'], 'text': h['text'], 'zeit': h['zeit'], 'herkunft': HERKUNFT} for h in speicher.handlungen_abholen(forge, stempel())]

    @app.post('/api/handlungen/{id_}/quittung')
    def handlung_quittieren(id_: int, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        if not speicher.handlung_quittieren(id_, stempel()):
            raise HTTPException(404, 'Keine solche Handlung.')
        return {'ok': True}

    @app.post('/api/holodeck')
    def holodeck(h: Holodeck, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        speicher.prototypen_setzen(h.forge, [d.model_dump() for d in h.dateien])
        return {'ok': True, 'dateien': len(h.dateien)}

    # ---- page

    @app.get('/api/tafel')
    def board() -> dict:
        return tafel(speicher.projekte(), speicher.stufen_seit(), speicher.antworten(), jetzt(), tz, bool(e.pin), speicher.handlungen(), speicher.prototypen())

    # a prototype only from the store: any name or project it does not hold is 404, never a file
    @app.get('/holodeck/{besitzer}/{repo}/{name}')
    def prototyp(besitzer: str, repo: str, name: str) -> HTMLResponse:
        inhalt = speicher.prototyp(f'{besitzer}/{repo}', name)
        if inhalt is None:
            raise HTTPException(404, 'Keinen solchen Prototyp.')
        return HTMLResponse(inhalt, headers=HOLODECK_KOEPFE)

    @app.post('/api/handlung')
    def handeln(h: Handlung, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        p = speicher.projekt(h.forge)
        b = p['bericht'] if p else {}
        ep = next((x for x in b.get('epics', []) if x['nr'] == h.epic), None)
        if h.art == 'einstellen':
            # belongs to the project: the bridge checks against the limits of the report, the driver checks again
            liste = b.get('einstellungen')
            if not liste:
                raise HTTPException(409, 'Dieser Treiber meldet keine Einstellungen.')
            z = json.loads(h.text)
            # what the other settings have or are about to get: Gelb must stay under Rot while one of them is queued
            andere = {x['name']: x['wert'] for x in liste}
            for o in speicher.handlungen(h.forge):
                if o['art'] == 'einstellen' and not o['quittiert']:
                    d = json.loads(o['text'])
                    andere[d['name']] = d['wert']
            grund = einstellung_pruefen(liste, z['name'], z['wert'], andere)
            if grund:
                raise HTTPException(422, grund)
        elif h.art == 'aufnehmen':
            # the driver checks ready_label and epic_label against the forge again
            if h.epic not in [f['nr'] for f in b.get('freigegeben', [])]:
                raise HTTPException(409, 'Das Epic ist nicht freigegeben oder schon im Einsatz.')
        elif ep is None:
            raise HTTPException(404, 'Dieses Epic kennt die Brücke nicht.')
        elif h.art in ('pausieren', 'fortsetzen', 'prioritaet', 'merge'):
            if ep['stufe'] in ('gemergt', 'fertig') or ep.get('aufgegebenAm') or not ep.get('imEinsatz', True):
                raise HTTPException(409, 'Das Epic ist nicht im Einsatz.')
            if h.art == 'merge' and not ep.get('merge'):
                raise HTTPException(409, 'Dieser Treiber kennt den Schalter fürs Andocken nicht (älterer Stand).')
            # #112: the bridge only tightens: automatisch only where the driver offers it (adapter merge: nach_gate)
            projekt = next((x for x in b.get('einstellungen') or [] if x['name'] == 'merge'), None)
            if h.art == 'merge' and h.text == 'automatisch' and 'automatisch' not in ((projekt or {}).get('werte') or []):
                raise HTTPException(409, (projekt or {}).get('hinweis') or 'Automatisch andocken bietet dieser Treiber nicht an.')
            if h.art == 'pausieren' and ep.get('pausiert'):
                raise HTTPException(409, 'Das Epic ist schon pausiert.')
            if h.art == 'fortsetzen' and not ep.get('pausiert'):
                raise HTTPException(409, 'Das Epic ist nicht pausiert.')
        elif h.art == 'widerruf':
            d = next((d for d in b.get('entscheidungen', []) if d['epic'] == h.epic and d['nr'] == h.nr and d['zeit'] == h.seit), None)
            if d is None:
                raise HTTPException(404, 'Diese Entscheidung kennt die Brücke nicht.')
            if ep['stufe'] in ('gemergt', 'fertig') or d.get('widerrufen'):
                raise HTTPException(409, 'Nach dem Merge oder ein zweites Mal geht kein Widerruf mehr über die Brücke.')
        elif ep['stufe'] not in ('blockiert', 'abgebrochen') or ep.get('aufgegebenAm'):
            raise HTTPException(409, 'Das Epic ist nicht blockiert.')
        gespeichert = speicher.handlung_setzen(h.forge, h.epic, h.art, h.nr, h.seit, h.text, stempel())
        if gespeichert is None:
            raise HTTPException(409, 'Der Treiber hat die Handlung schon abgeholt.')
        return {'ok': True, 'id': gespeichert['id']}

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
        if a.option:
            wahl = a.option.split(', ')
            fremd = [b for b in wahl if b not in [o['buchstabe'] for o in f.get('optionen', [])]]
            if fremd:
                raise HTTPException(422, f"Option {', '.join(fremd)} gibt es bei dieser Frage nicht.")
            if len(wahl) != len(set(wahl)) or (len(wahl) > 1 and not f.get('mehrfach')):
                raise HTTPException(422, 'Bei dieser Frage gilt genau eine Option.')
        gespeichert = speicher.antwort_setzen(a.forge, a.epic, a.nr, a.seit, a.option, a.text, stempel())
        if gespeichert is None:
            raise HTTPException(409, 'Der Treiber hat die Antwort schon abgeholt.')
        return {'ok': True, 'id': gespeichert['id']}

    @app.get('/healthz')
    def gesund() -> dict:
        return {'ok': True}

    # every script and style the page names (app, shell, areas) gets a content hash in its URL, so a
    # browser that cached an older version (a phone after an update) loads the new one instead of
    # mixing old script with new markup
    seite_html = (STATIC / 'index.html').read_text(encoding='utf-8')
    dateien = re.findall(r'/static/([\w/.-]+\.(?:css|js))"', seite_html)
    stand = hashlib.sha256(b''.join((STATIC / n).read_bytes() for n in dateien)).hexdigest()[:12]
    for n in dateien:
        seite_html = seite_html.replace(f'/static/{n}"', f'/static/{n}?v={stand}"')

    @app.get('/')
    def seite() -> HTMLResponse:
        return HTMLResponse(seite_html, headers={'Cache-Control': 'no-cache'})

    @app.get('/favicon.ico')
    def favicon() -> FileResponse:
        return FileResponse(STATIC / 'icon-32.png', media_type='image/png')

    app.mount('/static', StaticFiles(directory=STATIC), name='static')
    return app
