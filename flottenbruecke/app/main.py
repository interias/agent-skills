# Flottenbrücke (#28): the board of every deployment of the fleet driver and the way back for the
# answers of the person. Viewing is free in the LAN; answering needs the PIN from .env. Besides the
# answers the bridge carries actions to the driver, which carries them out: requeue or give up a
# blocked epic, revoke a decision of the admiral, change a setting of the driver (#59), take a released
# epic in, pause or continue an epic and set its priority (#61), and set how an epic merges (#112): the
# bridge only tightens, merge.ps1 stays the hard limit. No merge of its own, no abort. The Holodeck (#44)
# shows the prototypes each driver sends, sealed off from the bridge. The Werft of each machine (#90)
# reports its stand and fetches what the person asks: pull a stack, release a working migration, settings.
# With a VAPID key (#37) each new
# event of "Braucht dich" goes as a Web-Push to the devices that subscribed with the PIN. #154: it shows the stand of
# itself (BRUECKE_COMMIT, BRUECKE_DATUM, build arguments of its image) and of each driver, and carries the update
# the person asks for to the driver, which halts, installs, rebuilds the bridge and starts itself again. #48 (ADR-0006):
# a second entry, FERNPORT, which only the optional Tailscale add-on reaches, is view only: the page and every reading
# endpoint as in the LAN, every request that writes refused, whatever PIN it carries.
# The Bereitschaftsraum (#85, agent-skills/ADR-0004) is the chat: the person writes with the PIN, the service
# `flotte chat` fetches, acknowledges and answers with the token; the bridge never starts claude and stores no credentials.

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

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .meldung import Push, ereignisse, inhalt
from .modelle import CHAT_KONTO, KONTO_HANDLUNGEN, Antwort, Bericht, ChatAnlegen, ChatAntwort, ChatBeginn, ChatEinstellung, ChatQuittung, ChatText, Handlung, Holodeck, PushAbmeldung, PushAbo, WerftBericht, WerftHandlung, einstellung_pruefen
from .speicher import Speicher
from .tafel import HERKUNFT, bereitschaftsraum, tafel

STATIC = Path(__file__).parent / 'static'
FEHLVERSUCHE = 5
SPERRE_S = 300
# #48: the remote entry in the container (app/start.py), never published on the machine; the Tailscale add-on proxies to it
FERNPORT = 8001
# GETs that write: fetching marks answers and actions as fetched, the chat service's fetch remembers its machine and
# accounts (#85). Only driver, Werft and chat service fetch, and only in the LAN.
ABHOLEN = ('/api/antworten', '/api/handlungen', '/api/werft/handlungen', '/api/chat/nachrichten')

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
    # #37 Web-Push: off without the VAPID key; the contact goes to the push service as `sub`
    vapid: str = ''
    vapid_kontakt: str = 'mailto:flottenbruecke@localhost'
    # replaces pywebpush.webpush (tests: the push service as a stand-in)
    push_senden: object = None
    # #154: commit and date of the image, build arguments filled when the driver (or a person) builds it
    commit: str = ''
    datum: str = ''

    @classmethod
    def aus_umgebung(cls) -> 'Einstellung':
        return cls(db=os.environ.get('BRUECKE_DB', cls.db), pin=os.environ.get('BRUECKE_PIN', ''), token=os.environ.get('BRUECKE_TOKEN', ''), tz=os.environ.get('BRUECKE_TZ', cls.tz), vapid=os.environ.get('BRUECKE_VAPID_SCHLUESSEL', ''), vapid_kontakt=os.environ.get('BRUECKE_VAPID_KONTAKT') or cls.vapid_kontakt, commit=os.environ.get('BRUECKE_COMMIT', ''), datum=os.environ.get('BRUECKE_DATUM', ''))


def fernweg(request: Request) -> bool:
    """The entry is the socket the request came in on (uvicorn: its local address), not a sender or a header a client sets."""
    server = request.scope.get('server')
    return bool(server) and server[1] == FERNPORT


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
    push = Push(e.vapid, e.vapid_kontakt, e.push_senden) if e.vapid else None
    app = FastAPI(title='Flottenbrücke', docs_url=None, redoc_url=None, openapi_url=None)

    # #48: over the remote entry only viewing; a principle, not a list of endpoints, so every later one is covered
    @app.middleware('http')
    async def nur_ansicht(request: Request, weiter):
        if fernweg(request) and (request.method not in ('GET', 'HEAD') or request.url.path in ABHOLEN):
            return JSONResponse({'detail': 'Über den Fernweg nur Ansicht: Antworten und Handlungen gehen nur im LAN.'}, status_code=403)
        return await weiter(request)

    def jetzt() -> datetime:
        return e.uhr()

    def stempel() -> str:
        return jetzt().isoformat(timespec='seconds')

    def treiber(token: str | None) -> None:
        if e.token and not (token and hmac.compare_digest(e.token.encode(), token.encode())):
            raise HTTPException(401, 'Treiber-Token fehlt oder falsch.')

    # ---- driver

    @app.post('/api/bericht')
    def bericht(b: Bericht, hinterher: BackgroundTasks, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        neu = speicher.bericht_speichern(b.forge, b.model_dump(), stempel())
        # #37: each event of "Braucht dich" once, also without push (switched on later, nothing old rings);
        # the new ones of this report as one push, after the answer to the driver
        alle = ereignisse(speicher.projekt(b.forge), speicher.stufen_seit(), jetzt(), tz)
        frisch = speicher.neu_gemeldet(b.forge, [x['schluessel'] for x in alle])
        if push and frisch:
            hinterher.add_task(push.verschicke, speicher, inhalt([x for x in alle if x['schluessel'] in frisch]))
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

    # ---- Werft (#90, agent-skills/ADR-0005): like the driver it only calls; the bridge commands nothing

    @app.post('/api/werft')
    def werft_bericht(b: WerftBericht, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        speicher.werft_speichern(b.model_dump(), stempel())
        return {'ok': True}

    @app.get('/api/werft/handlungen')
    def werft_abholen(rechner: str, x_bruecke_token: str | None = Header(None)) -> list[dict]:
        treiber(x_bruecke_token)
        # the contract: beispiel/werft-handlungen.json
        return [{'id': h['id'], 'forge': h['forge'], 'stack': h['stack'], 'art': h['art'], 'text': h['text'], 'zeit': h['zeit'], 'herkunft': HERKUNFT} for h in speicher.werft_handlungen_abholen(rechner, stempel())]

    @app.post('/api/werft/handlungen/{id_}/quittung')
    def werft_quittieren(id_: int, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        if not speicher.werft_handlung_quittieren(id_, stempel()):
            raise HTTPException(404, 'Keine solche Handlung.')
        return {'ok': True}

    # ---- page

    @app.get('/api/tafel')
    def board(request: Request) -> dict:
        # push: the public VAPID key when Web-Push is on (#37), else None
        # bruecke (#154): the stand of this bridge's image, None when it was built without the build arguments
        # nurAnsicht (#48): over the remote entry; the page then offers neither actions nor the PIN
        projekte = speicher.projekte()
        t = {**tafel(projekte, speicher.stufen_seit(), speicher.antworten(), jetzt(), tz, bool(e.pin), speicher.handlungen(), speicher.prototypen(), speicher.werft(), speicher.werft_handlungen()), 'push': push.oeffentlich if push else None, 'bruecke': {'commit': e.commit or None, 'datum': e.datum or None}, 'nurAnsicht': fernweg(request)}
        # over the remote entry the Bereitschaftsraum offers no writing either (#48)
        t['bereitschaftsraum'] = bereitschaftsraum(speicher.chats(), speicher.chat_nachrichten(), speicher.chat_rechner(), [p['forge'] for p in projekte], bool(e.pin) and not fernweg(request))
        return t

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
        if h.art == 'triage':
            return triage_starten(h)
        if h.art == 'einspielen':
            return einspielen_starten(h)
        p = speicher.projekt(h.forge)
        b = p['bericht'] if p else {}
        ep = next((x for x in b.get('epics', []) if x['nr'] == h.epic), None)
        triage = b.get('triage') or {}
        if h.art == 'triage-antwort':
            # #116: a critical question of the triage still open in the report; the driver checks again and comments at the ticket
            f = next((f for f in triage.get('fragen', []) if f['ticket'] == h.epic and f['nr'] == h.nr and f['seit'] == h.seit), None)
            if f is None:
                raise HTTPException(404, 'Diese Frage ist nicht offen.')
            option = json.loads(h.text)['option']
            if option and option not in [o['buchstabe'] for o in f.get('optionen', [])]:
                raise HTTPException(422, f'Option {option} gibt es bei dieser Frage nicht.')
        elif h.art == 'triage-widerruf':
            d = next((d for d in triage.get('entscheidungen', []) if d['nr'] == h.epic and d['zeit'] == h.seit), None)
            if d is None:
                raise HTTPException(404, 'Diese Entscheidung des Triage-Laufs kennt die Brücke nicht.')
            if d.get('widerrufen'):
                raise HTTPException(409, 'Diese Entscheidung ist schon widerrufen.')
        elif h.art == 'schnitt-widerruf':
            # #148: a mission of the last cut plan in the report; the driver comments first, then loosens and closes
            m = next((m for m in (triage.get('schnittplan') or {}).get('missionen', []) if m['nr'] == h.epic), None)
            if m is None:
                raise HTTPException(404, 'Diese Mission steht nicht im Schnittplan des letzten Triage-Laufs.')
            if m.get('widerrufen'):
                raise HTTPException(409, 'Diese Mission ist schon widerrufen.')
            if not m.get('neu') and not m.get('kinder'):
                raise HTTPException(409, 'An dieser Mission hat der Triage-Lauf nichts angehängt.')
        elif h.art in KONTO_HANDLUNGEN:
            # #95: only accounts the driver reports; the driver checks against konten.json again
            liste = b.get('kontenListe')
            if liste is None:
                raise HTTPException(409, 'Dieser Treiber meldet keine Konten.')
            if h.art != 'konto_anlegen' and h.epic not in [k['nr'] for k in liste]:
                raise HTTPException(404, 'Dieses Konto meldet der Treiber nicht.')
        elif h.art == 'einstellen':
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
                raise HTTPException(409, 'Die Mission ist nicht freigegeben oder schon im Einsatz.')
        elif ep is None:
            raise HTTPException(404, 'Diese Mission kennt die Brücke nicht.')
        elif h.art in ('pausieren', 'fortsetzen', 'prioritaet', 'merge'):
            if ep['stufe'] in ('gemergt', 'fertig') or ep.get('aufgegebenAm') or not ep.get('imEinsatz', True):
                raise HTTPException(409, 'Die Mission ist nicht im Einsatz.')
            if h.art == 'merge' and not ep.get('merge'):
                raise HTTPException(409, 'Dieser Treiber kennt den Schalter fürs Andocken nicht (älterer Stand).')
            # #112: the bridge only tightens: automatisch only where the driver offers it (adapter merge: nach_gate)
            projekt = next((x for x in b.get('einstellungen') or [] if x['name'] == 'merge'), None)
            if h.art == 'merge' and h.text == 'automatisch' and 'automatisch' not in ((projekt or {}).get('werte') or []):
                raise HTTPException(409, (projekt or {}).get('hinweis') or 'Automatisch andocken bietet dieser Treiber nicht an.')
            if h.art == 'pausieren' and ep.get('pausiert'):
                raise HTTPException(409, 'Die Mission ist schon pausiert.')
            if h.art == 'fortsetzen' and not ep.get('pausiert'):
                raise HTTPException(409, 'Die Mission ist nicht pausiert.')
        elif h.art == 'widerruf':
            d = next((d for d in b.get('entscheidungen', []) if d['epic'] == h.epic and d['nr'] == h.nr and d['zeit'] == h.seit), None)
            if d is None:
                raise HTTPException(404, 'Diese Entscheidung kennt die Brücke nicht.')
            if ep['stufe'] in ('gemergt', 'fertig') or d.get('widerrufen'):
                raise HTTPException(409, 'Nach dem Andocken oder ein zweites Mal geht kein Widerruf mehr über die Brücke.')
        elif ep['stufe'] not in ('blockiert', 'abgebrochen') or ep.get('aufgegebenAm'):
            raise HTTPException(409, 'Die Mission ist nicht blockiert.')
        gespeichert = speicher.handlung_setzen(h.forge, h.epic, h.art, h.nr, h.seit, h.text, stempel())
        if gespeichert is None:
            raise HTTPException(409, 'Der Treiber hat die Handlung schon abgeholt.')
        return {'ok': True, 'id': gespeichert['id']}

    def triage_starten(h: Handlung) -> dict:
        """#116: one triage action per project, or (forge `alle`) one for each project whose driver reports a triage state and runs none."""
        if h.forge == 'alle':
            ziele = [p['forge'] for p in speicher.projekte() if p['bericht'].get('triage') and not p['bericht']['triage'].get('laeuft')]
            if not ziele:
                raise HTTPException(409, 'Kein Treiber kann gerade einen Triage-Lauf starten.')
        else:
            p = speicher.projekt(h.forge)
            if p is None:
                raise HTTPException(404, 'Dieses Projekt kennt die Brücke nicht.')
            if not p['bericht'].get('triage'):
                raise HTTPException(409, 'Dieser Treiber kennt den Triage-Lauf nicht (älterer Stand).')
            if p['bericht']['triage'].get('laeuft'):
                raise HTTPException(409, 'Ein Triage-Lauf läuft schon.')
            ziele = [h.forge]
        ids = []
        for forge in ziele:
            gespeichert = speicher.handlung_setzen(forge, 0, 'triage', None, None, None, stempel())
            # fetched already: that one starts the run, nothing more to do here
            if gespeichert is not None:
                ids.append(gespeichert['id'])
        if not ids:
            raise HTTPException(409, 'Der Treiber hat die Handlung schon abgeholt.')
        return {'ok': True, 'id': ids[0], 'ids': ids}

    def einspielen_starten(h: Handlung) -> dict:
        """#154: one update per driver, or (forge `alle`) one for each driver that reports its stand and is not halting
        for one already. The text is the commit of this bridge's image: the driver builds it only when flottenbruecke/
        changed since."""
        kann = lambda b: b.get('version') and not b['version'].get('einspielen')
        if h.forge == 'alle':
            ziele = [p['forge'] for p in speicher.projekte() if kann(p['bericht'])]
            if not ziele:
                raise HTTPException(409, 'Kein Treiber kann gerade einspielen.')
        else:
            p = speicher.projekt(h.forge)
            if p is None:
                raise HTTPException(404, 'Dieses Projekt kennt die Brücke nicht.')
            if not p['bericht'].get('version'):
                raise HTTPException(409, 'Dieser Treiber meldet keinen Stand (älterer Stand): einspielen von Hand.')
            if p['bericht']['version'].get('einspielen'):
                raise HTTPException(409, 'Der Treiber hält schon zum Einspielen an.')
            ziele = [h.forge]
        text = json.dumps({'bruecke': e.commit or None})
        ids = []
        for forge in ziele:
            gespeichert = speicher.handlung_setzen(forge, 0, 'einspielen', None, None, text, stempel())
            if gespeichert is not None:
                ids.append(gespeichert['id'])
        if not ids:
            raise HTTPException(409, 'Der Treiber hat die Handlung schon abgeholt.')
        return {'ok': True, 'id': ids[0], 'ids': ids}

    @app.post('/api/werft/handlung')
    def werft_handeln(h: WerftHandlung, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        """#90: only with the PIN, checked against the last report of that machine's Werft; the Werft checks again."""
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        w = next((x for x in speicher.werft() if x['rechner'] == h.rechner), None)
        repo = next((r for r in (w['bericht']['repos'] if w else []) if r['forge'] == h.forge), None)
        if repo is None:
            raise HTTPException(404, 'Dieses Repository meldet keine Werft auf diesem Rechner.')
        st = next((s for s in repo['stacks'] if s['name'] == h.stack), None)
        if h.stack is not None and st is None:
            raise HTTPException(404, 'Diesen Stack kennt die Werft nicht.')
        if h.art != 'einstellen' and not repo['an']:
            raise HTTPException(409, 'Die Werft ist für dieses Repository aus.')
        if h.art != 'einstellen' and not st['an']:
            raise HTTPException(409, 'Dieser Stack ist aus.')
        if h.art == 'migration_freigeben':
            # bound to the migration the person saw: a newer backup or commit needs its own release
            a = st.get('arbeit')
            if not a or a['zustand'] != 'wartet':
                raise HTTPException(409, 'Die Arbeits-Migration dieses Stacks wartet nicht auf eine Freigabe.')
            if json.loads(h.text) != {k: a[k] for k in ('commit', 'sicherung', 'pruefsumme')}:
                raise HTTPException(409, 'Die wartende Arbeits-Migration hat sich geändert: bitte neu ansehen.')
        gespeichert = speicher.werft_handlung_setzen(h.rechner, h.forge, h.stack, h.art, h.text, stempel())
        if gespeichert is None:
            raise HTTPException(409, 'Die Werft hat die Handlung schon abgeholt.')
        return {'ok': True, 'id': gespeichert['id']}

    # ---- Bereitschaftsraum (#85): the chat service (token), SCHNITTSTELLE.md section 8

    @app.get('/api/chat/nachrichten')
    def chat_holen(rechner: str, konten: str = '', x_bruecke_token: str | None = Header(None)) -> list[dict]:
        treiber(x_bruecke_token)
        liste = [k for k in konten.split(',') if k]
        if not rechner.strip() or len(rechner) > 200 or not all(re.fullmatch(CHAT_KONTO, k) for k in liste):
            raise HTTPException(422, 'rechner und konten (Kurznamen aus Ziffern, durch Komma getrennt)')
        # the accounts each machine has: the choice per chat
        speicher.chat_rechner_merken(rechner, liste, stempel())
        return [{'id': n['id'], 'chat': n['chat'], 'forge': n['forge'], 'art': n['art'], 'konto': n['konto'], 'modell': n['modell'], 'text': n['text'], 'entwurf': n['entwurf'], 'starten': bool(n['starten']), 'sitzung': n['sitzung'], 'zeit': n['zeit']} for n in speicher.chat_offene(rechner, liste)]

    @app.post('/api/chat/nachrichten/{id_}/quittung')
    def chat_quittieren(id_: int, q: ChatQuittung, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        grund = speicher.chat_quittieren(id_, q.rechner, stempel())
        if grund == 'unbekannt':
            raise HTTPException(404, 'Keine solche Nachricht.')
        if grund:
            raise HTTPException(409, grund)
        return {'ok': True}

    @app.post('/api/chat/nachrichten/{id_}/antwort')
    def chat_antwort(id_: int, a: ChatAntwort, x_bruecke_token: str | None = Header(None)) -> dict:
        treiber(x_bruecke_token)
        if not speicher.chat_antworten(id_, a.model_dump(), stempel()):
            raise HTTPException(404, 'Keine solche Nachricht.')
        return {'ok': True}

    # ---- Bereitschaftsraum: what the person does, each with the PIN

    def chat_pin(request: Request, pin: str | None) -> None:
        wache.pruefe(e.pin, pin, request.client.host if request.client else '?')

    def konto_bekannt(konto: str) -> None:
        if not any(konto in r['konten'] for r in speicher.chat_rechner()):
            raise HTTPException(409, f'Kein Rechner meldet Konto {konto}.')

    def offener_chat(id_: int) -> dict:
        c = speicher.chat(id_)
        if c is None:
            raise HTTPException(404, 'Keinen solchen Chat.')
        return c

    @app.post('/api/chat')
    def chat_beginnen(b: ChatBeginn, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        chat_pin(request, x_bruecke_pin)
        konto_bekannt(b.konto)
        return {'ok': True, **speicher.chat_beginnen(b.forge, b.konto, b.modell, b.text, stempel())}

    @app.post('/api/chat/{id_}/nachricht')
    def chat_schreiben(id_: int, t: ChatText, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        chat_pin(request, x_bruecke_pin)
        offener_chat(id_)
        neu = speicher.chat_schreiben(id_, t.text, stempel())
        if neu is None:
            raise HTTPException(409, 'Der Chat ist nicht mehr offen.')
        return {'ok': True, 'id': neu}

    @app.post('/api/chat/{id_}/einstellung')
    def chat_einstellen(id_: int, w: ChatEinstellung, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        chat_pin(request, x_bruecke_pin)
        c = offener_chat(id_)
        if w.konto != c['konto']:
            konto_bekannt(w.konto)
        grund = speicher.chat_einstellen(id_, w.konto, w.modell, stempel())
        if grund:
            raise HTTPException(409, grund)
        return {'ok': True}

    # creating is a release (SCHNITTSTELLE.md): the draft is the stored one of the chat's latest answer, never the form's
    @app.post('/api/chat/{id_}/anlegen')
    def chat_anlegen(id_: int, a: ChatAnlegen, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        chat_pin(request, x_bruecke_pin)
        offener_chat(id_)
        neu = speicher.chat_anlegen(id_, a.von, a.starten, stempel())
        if isinstance(neu, str):
            raise HTTPException(409, neu)
        return {'ok': True, 'id': neu}

    @app.post('/api/chat/{id_}/verwerfen')
    def chat_verwerfen(id_: int, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        chat_pin(request, x_bruecke_pin)
        offener_chat(id_)
        if not speicher.chat_verwerfen(id_, stempel()):
            raise HTTPException(409, 'Der Chat ist nicht mehr offen.')
        return {'ok': True}

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

    # ---- Web-Push (#37): a device subscribes and unsubscribes only with the PIN

    @app.post('/api/push')
    def abonnieren(a: PushAbo, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        if not push:
            raise HTTPException(409, 'Web-Push ist aus: kein VAPID-Schlüssel (BRUECKE_VAPID_SCHLUESSEL in .env).')
        speicher.abo_setzen(a.endpoint, a.keys.p256dh, a.keys.auth, stempel())
        return {'ok': True}

    @app.post('/api/push/abmelden')
    def abmelden(a: PushAbmeldung, request: Request, x_bruecke_pin: str | None = Header(None)) -> dict:
        wache.pruefe(e.pin, x_bruecke_pin, request.client.host if request.client else '?')
        return {'ok': True, 'geloescht': speicher.abo_loeschen(a.endpoint)}

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

    # the service worker from the root: its scope is the whole page (#37)
    @app.get('/sw.js')
    def service_worker() -> FileResponse:
        return FileResponse(STATIC / 'sw.js', media_type='text/javascript', headers={'Cache-Control': 'no-cache'})

    @app.get('/favicon.ico')
    def favicon() -> FileResponse:
        return FileResponse(STATIC / 'icon-32.png', media_type='image/png')

    app.mount('/static', StaticFiles(directory=STATIC), name='static')
    return app
