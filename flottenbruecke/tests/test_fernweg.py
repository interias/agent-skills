"""#48 Fernzugriff (ADR-0006): the bridge serves a second entry, FERNPORT, which only the Tailscale add-on
reaches. Over it the bridge reads as in the LAN and, since ADR-0007, takes the person's writing routes with the same
device check; the services' routes, fetching and the machine's rights stay refused. The entry is the listening
socket, never the sender or a header."""
import json
import re
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app import start
from app.main import ABHOLEN, FERNPORT, PERSON_FERN, RECHNERPORT, Einstellung, erzeuge
from conftest import koppeln

BEISPIEL = Path(__file__).parent.parent / 'beispiel'
SEIT = '2026-11-20T13:52:30Z'
WIDERRUF = {'epic': 38, 'nr': 1, 'seit': '2026-11-20T14:18:02Z', 'text': 'Unter der nächsten Version, nicht unter Unreleased'}
PROBE = 'interias/flotte-probe'
PIN = {'X-Bruecke-Pin': '4711'}
HOLODECK = json.loads((BEISPIEL / 'holodeck.json').read_text(encoding='utf-8'))
NOTIZEN = json.loads((BEISPIEL / 'bericht-notizen.json').read_text(encoding='utf-8'))


@pytest.fixture
def app(tmp_path, uhr):
    return erzeuge(Einstellung(db=str(tmp_path / 'b.db'), pin='4711', uhr=uhr))


@pytest.fixture
def lan(app):
    c = TestClient(app)
    koppeln(c)
    return c


@pytest.fixture
def fern(app):
    # the same app on its second entry, as the Tailscale add-on reaches it
    return TestClient(app, base_url=f'http://testserver:{FERNPORT}')


@pytest.fixture
def gefuellt(lan, bericht):
    lan.post('/api/bericht', json=bericht)
    lan.post('/api/bericht', json=NOTIZEN)
    for h in HOLODECK:
        lan.post('/api/holodeck', json=h)
    # one answer and one action waiting for the driver, so the board shows both
    lan.post('/api/antwort', json={'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': SEIT, 'option': None, 'text': 'A'}, headers=PIN)
    lan.post('/api/handlung', json={'forge': PROBE, 'epic': 40, 'art': 'einreihen'}, headers=PIN)


def schreibende(app) -> list[tuple[str, str]]:
    """Every writing route the app registers, gathered at run time: a new endpoint is covered by itself."""
    return sorted((m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods if m not in ('GET', 'HEAD'))


def konkret(pfad: str) -> str:
    return re.sub(r'\{[^}]+\}', '1', pfad)


# ---- reading: the same as in the LAN


def test_fernweg_liest_alles_wie_im_lan(app, lan, fern, gefuellt):
    lesende = [r.path for r in app.routes if isinstance(r, APIRoute) and 'GET' in r.methods and r.path not in ABHOLEN]
    proto = HOLODECK[0]
    # Tag J: the history needs its query and a paired device; test_verlauf.py reads it over the remote entry
    assert '/api/verlauf' in lesende
    urls = [p for p in lesende if '{' not in p and p != '/api/verlauf'] + [f"/holodeck/{proto['forge']}/{proto['dateien'][0]['name']}"]
    # every script and style the page names, with its content hash
    urls += re.findall(r'"(/static/[^"]+)"', lan.get('/').text)
    assert {'/', '/api/tafel', '/healthz', '/sw.js'} <= set(urls)
    assert len([p for p in lesende if '{' in p]) == 1, 'a new reading route with parameters needs a URL here'
    vorher = lan.get('/api/tafel').json()
    for url in urls:
        a, b = lan.get(url), fern.get(url)
        assert (url, a.status_code, b.status_code) == (url, 200, 200)
        if url == '/api/tafel':
            ta, tb = a.json(), b.json()
            assert (ta.pop('nurAnsicht'), tb.pop('nurAnsicht')) == (False, False)
            # the paired device is the LAN client's; over the remote entry no device is asked about
            assert (ta.pop('geraet')['name'], tb.pop('geraet')) == ('Testgerät', None)
            # ADR-0007: the Bereitschaftsraum offers writing over the remote entry as well
            assert (ta['bereitschaftsraum'].pop('pin'), tb['bereitschaftsraum'].pop('pin')) == (True, True)
            assert tb == ta
        else:
            assert b.content == a.content, url
    # reading over the remote entry changes nothing: a GET with a side effect, outside ABHOLEN, shows up here
    assert lan.get('/api/tafel').json() == vorher


def test_tafel_ueber_den_fernweg_zeigt_offene_antwort_und_handlung(fern, gefuellt):
    t = fern.get('/api/tafel').json()
    # ADR-0007: no longer view only; the page acts there like in the LAN
    assert t['nurAnsicht'] is False
    assert t['pin'] is True
    assert any(x.get('handlung') for x in t['braucht'])


# ---- writing (ADR-0007): the person's routes as in the LAN, every other one refused


def test_ueber_den_fernweg_nur_die_wege_der_person(app, lan, fern, gefuellt):
    routen = schreibende(app)
    genannt = {('POST', p) for p in ('/api/antwort', '/api/handlung', '/api/pin', '/api/holodeck', '/api/bericht', '/api/antworten/{id_}/quittung', '/api/handlungen/{id_}/quittung', '/api/push', '/api/push/abmelden')}
    assert genannt <= set(routen)
    vorher = lan.get('/api/tafel').json()
    person = 0
    for methode, pfad in routen:
        r = fern.request(methode, konkret(pfad), json={}, headers={**PIN, 'X-Bruecke-Token': ''})
        if methode == 'POST' and PERSON_FERN.match(konkret(pfad)):
            # not refused by the entry: the device check (an unpaired one is 401) or the body decides
            person += 1
            assert 'Fernweg' not in r.text, pfad
        else:
            assert (methode, pfad, r.status_code) == (methode, pfad, 403)
            assert 'Fernweg' in r.json()['detail']
    assert person >= 10
    # nothing of the services and nothing of the machine is reachable that way
    for pfad in ('/api/bericht', '/api/holodeck', '/api/geraete/1/rechte', '/api/geraete/1/entkoppeln', '/api/notaus/loesen', '/api/werft'):
        assert not PERSON_FERN.match(pfad), pfad
    assert lan.get('/api/tafel').json() == vorher


@pytest.mark.parametrize('methode', ['PUT', 'PATCH', 'DELETE', 'OPTIONS'])
def test_andere_methoden_ueber_den_fernweg_abgelehnt(fern, methode):
    assert fern.request(methode, '/api/tafel').status_code == 403
    assert fern.request(methode, '/gibt-es-nicht').status_code == 403


def gueltige(bericht):
    """The writing requests the ticket names, each valid (the person's with a paired device, the services' with the token)."""
    proto = HOLODECK[0]
    return [
        ('/api/pin', None),
        ('/api/antwort', {'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': SEIT, 'option': None, 'text': 'B'}),
        ('/api/handlung', {'forge': PROBE, 'epic': 40, 'art': 'aufgeben'}),
        ('/api/handlung', {'forge': PROBE, 'epic': 38, 'art': 'widerruf', 'nr': WIDERRUF['nr'], 'seit': WIDERRUF['seit'], 'text': WIDERRUF['text']}),
        ('/api/holodeck', proto),
        ('/api/bericht', bericht),
        ('/api/antworten/1/quittung', None),
        ('/api/handlungen/1/quittung', None),
    ]


def test_ueber_den_fernweg_handelt_ein_dort_gekoppeltes_geraet_die_dienste_nicht(app, lan, fern, gefuellt, bericht):
    # the cookie belongs to the remote name, so the phone pairs there once; the right is given at the machine
    g = koppeln(fern, handeln=False, name='Handy unterwegs')
    r = fern.post('/api/handlung', json={'forge': PROBE, 'epic': 40, 'art': 'aufgeben'})
    assert r.status_code == 403 and r.headers['x-bruecke-grund'] == 'recht'
    am = TestClient(app, base_url=f'http://localhost:{RECHNERPORT}')
    assert am.post(f"/api/geraete/{g['id']}/rechte", json={'antworten': True, 'handeln': True}, headers=PIN).status_code == 200
    # and never over the remote entry itself
    assert fern.post(f"/api/geraete/{g['id']}/rechte", json={'antworten': True, 'handeln': True}, headers=PIN).status_code == 403
    for pfad, body in gueltige(bericht):
        r = fern.post(pfad, json=body, headers=PIN if pfad == '/api/pin' else {'X-Bruecke-Token': ''})
        if PERSON_FERN.match(pfad):
            assert r.status_code in (200, 204), (pfad, r.status_code, r.text)
        else:
            assert r.status_code == 403, pfad


def test_im_lan_gehen_dieselben_anfragen(lan, gefuellt, bericht):
    for pfad, body in gueltige(bericht):
        if pfad.endswith('/quittung'):
            lan.get('/api/antworten', params={'forge': PROBE})
            lan.get('/api/handlungen', params={'forge': PROBE})
        r = lan.post(pfad, json=body, headers=PIN)
        assert r.status_code in (200, 204), (pfad, r.status_code, r.text)


def test_abholen_ueber_den_fernweg_abgelehnt(lan, fern, gefuellt):
    # fetching marks answers and actions as fetched (a GET that writes): only the driver, only in the LAN
    for pfad in ABHOLEN:
        assert fern.get(pfad, params={'forge': PROBE}).status_code == 403
    # nothing was marked: the person can still change the answer
    r = lan.post('/api/antwort', json={'forge': PROBE, 'epic': 39, 'nr': 1, 'seit': SEIT, 'option': None, 'text': 'B'}, headers=PIN)
    assert r.status_code == 200


def test_unterscheidung_haengt_am_eingang_nicht_an_absender_oder_kopf(app):
    # a client in the LAN that claims to come from the tailnet stays in the LAN
    lan = TestClient(app, client=('100.64.0.7', 41641))
    koppeln(lan)
    koepfe = {**PIN, 'Host': f'flottenbruecke.example.ts.net:{FERNPORT}', 'X-Forwarded-For': '100.64.0.7', 'X-Forwarded-Host': 'flottenbruecke.example.ts.net', 'Forwarded': 'for=100.64.0.7'}
    assert lan.post('/api/pin', headers=koepfe).status_code == 204
    assert lan.get('/api/tafel', headers=koepfe).json()['nurAnsicht'] is False
    # and the remote entry refuses the services' routes from any sender, even one that looks like the machine
    fern = TestClient(app, base_url=f'http://testserver:{FERNPORT}', client=('127.0.0.1', 50000))
    assert fern.post('/api/bericht', json={}).status_code == 403
    assert fern.post('/api/notaus/loesen', headers=PIN).status_code == 403


# ---- the two entries in the container


def test_start_oeffnet_lan_und_fernweg():
    lan_o, fern_o, rechner_o = start.eingaenge({})
    assert (lan_o['port'], fern_o['port'], rechner_o['port']) == (start.PORT, FERNPORT, RECHNERPORT)
    assert len({start.PORT, FERNPORT, RECHNERPORT}) == 3
    assert 'factory' not in lan_o and 'factory' not in fern_o and 'factory' not in rechner_o


def test_fernweg_bleibt_http_wenn_das_lan_https_spricht():
    # Tailscale ends TLS itself and talks plain HTTP to the remote entry inside the compose network; the machine's own
    # entry stays plain HTTP too (#46)
    lan_o, fern_o, rechner_o = start.eingaenge({'BRUECKE_ZERT': '/zert/a.pem', 'BRUECKE_ZERT_SCHLUESSEL': '/zert/a-key.pem'})
    assert lan_o['ssl_certfile'] == '/zert/a.pem'
    assert 'ssl_certfile' not in fern_o and 'ssl_keyfile' not in fern_o
    assert rechner_o['port'] == RECHNERPORT
    assert 'ssl_certfile' not in rechner_o and 'ssl_keyfile' not in rechner_o


def test_compose_veroeffentlicht_den_fernweg_nicht():
    # only the Tailscale service reaches the remote entry, over the compose network; no port of the machine leads to it.
    # The machine's own entry (#46) is published on 127.0.0.1 only.
    text = (Path(__file__).parent.parent / 'compose.yaml').read_text(encoding='utf-8')
    veroeffentlicht = re.findall(r'^\s+- "([^"]*):(\d+)"\s*$', text, re.M)
    assert [p for _, p in veroeffentlicht] == ['8000', '8002']
    assert str(FERNPORT) not in [p for _, p in veroeffentlicht]
    assert [v for v, p in veroeffentlicht if p == str(RECHNERPORT)] == ['127.0.0.1:${BRUECKE_RECHNER_PORT:-4748}']
